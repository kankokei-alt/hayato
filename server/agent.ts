import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./persona.js";
import { memoryTools } from "./tools/memory.js";
import { calendarTools, TIME_ZONE } from "./tools/calendar.js";
import { toApiTool, type HayatoTool } from "./tools/types.js";

const client = new Anthropic();

const MODEL = process.env.HAYATO_MODEL ?? "claude-opus-5-5";
// 音声会話は待ち時間が短いほうが自然なので既定は low。じっくり考えさせたいなら .env で medium / high に。
const EFFORT = (process.env.HAYATO_EFFORT ?? "low") as Anthropic.Beta.BetaOutputConfig["effort"];
const MAX_TOOL_ROUNDS = 10;
const MAX_HISTORY_MESSAGES = 80;

const localTools: HayatoTool[] = [...memoryTools, ...calendarTools];
const toolsByName = new Map(localTools.map((t) => [t.name, t]));

// ツール一覧は毎回同じ順序・同じ内容で送る（プロンプトキャッシュを効かせるため）
const apiTools: Anthropic.Beta.BetaToolUnion[] = [
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
    user_location: { type: "approximate", country: "JP", timezone: TIME_ZONE },
  },
  ...localTools.map(toApiTool),
];

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "done" }
  | { type: "error"; message: string };

const conversations = new Map<string, Anthropic.Beta.BetaMessageParam[]>();

export function resetConversation(id: string): void {
  conversations.delete(id);
}

function nowLabel(): string {
  return new Date().toLocaleString("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 会話が長くなりすぎたら、古いやり取りをユーザー発話の切れ目で落とす。 */
function trimHistory(history: Anthropic.Beta.BetaMessageParam[]): void {
  if (history.length <= MAX_HISTORY_MESSAGES) return;
  let cut = history.length - MAX_HISTORY_MESSAGES;
  // tool_result だけの user メッセージから始まらないよう、普通の発話まで進める
  while (cut < history.length) {
    const m = history[cut];
    const isPlainUser =
      m.role === "user" &&
      (typeof m.content === "string" || !m.content.some((b) => b.type === "tool_result"));
    if (isPlainUser) break;
    cut++;
  }
  history.splice(0, cut);
}

function serverToolLabel(name: string): string {
  if (name === "web_search") return "Webを検索中";
  if (name === "web_fetch") return "ページを読み込み中";
  return "処理中";
}

/**
 * ユーザーの発話を1ターン処理する。返答テキストは emit でストリーミングされる。
 * Claude がツールを使う限りループし、最終的な返答が出たら done を送る。
 */
export async function runTurn(
  conversationId: string,
  userText: string,
  emit: (ev: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const history = conversations.get(conversationId) ?? [];
  conversations.set(conversationId, history);
  const rollbackTo = history.length;

  history.push({
    role: "user",
    content: [
      { type: "text", text: `[現在日時: ${nowLabel()}（${TIME_ZONE}）]` },
      { type: "text", text: userText },
    ],
  });

  let jsonRetries = 0;
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          system: SYSTEM_PROMPT,
          tools: apiTools,
          messages: history,
          output_config: { effort: EFFORT },
          cache_control: { type: "ephemeral" },
          // 安全分類器で断られた場合、サーバー側で適切なモデルに自動で引き継ぐ
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      stream.on("text", (delta) => emit({ type: "text", text: delta }));
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            emit({ type: "tool", name: block.name, label: toolsByName.get(block.name)?.label ?? "処理中" });
          } else if (block.type === "server_tool_use") {
            emit({ type: "tool", name: block.name, label: serverToolLabel(block.name) });
          }
        }
      });

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // ツール入力のJSONが壊れていた・接続が切れた場合は2回まで同じターンをやり直す。APIエラーはそのまま投げる
        if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
        continue;
      }

      if (message.stop_reason === "refusal") {
        emit({ type: "text", text: "申し訳ありません。その件はお手伝いできません。" });
        history.splice(rollbackTo);
        break;
      }

      history.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "pause_turn") continue; // サーバー側ツールの続きを再開
      if (message.stop_reason !== "tool_use") break; // end_turn など: 返答完了

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;

      const results = await Promise.all(toolUses.map(executeTool));
      history.push({ role: "user", content: results });
    }
    trimHistory(history);
    emit({ type: "done" });
  } catch (err) {
    history.splice(rollbackTo); // 失敗したターンは履歴に残さない
    if (signal.aborted) return;
    emit({ type: "error", message: describeError(err) });
  }
}

async function executeTool(block: Anthropic.Beta.BetaToolUseBlock): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const tool = toolsByName.get(block.name);
  if (!tool) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `不明なツールです: ${block.name}` };
  }
  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(block.input), issues: parsed.error.issues }),
    };
  }
  try {
    return { type: "tool_result", tool_use_id: block.id, content: await tool.run(parsed.data) };
  } catch (err) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: err instanceof Error ? err.message : String(err),
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude APIキーが無効です。.env の ANTHROPIC_API_KEY を確認してください。";
  if (err instanceof Anthropic.RateLimitError) return "混み合っているようです。少し待ってからもう一度話しかけてください。";
  if (err instanceof Anthropic.APIConnectionError) return "Claude APIに接続できませんでした。ネットワークを確認してください。";
  if (err instanceof Anthropic.APIError) return `Claude APIでエラーが起きました（${err.status}）: ${err.message}`;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return "Claude APIキーが設定されていません。サーバーの .env に ANTHROPIC_API_KEY を書いてください。";
  }
  console.error(err);
  return "内部でエラーが起きました。";
}
