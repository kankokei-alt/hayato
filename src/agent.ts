// ハヤトの頭脳: iPhoneから直接 Claude API を呼び、ツールを使いながら返答をストリーミングする。
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt } from "./persona.js";
import { localTools, toApiTool, loadMemory, importMemory } from "./tools.js";
import { load, save, remove } from "./storage.js";

export { ASSISTANT_NAME } from "./persona.js";
export { loadMemory, importMemory };

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 10;
const MAX_HISTORY_MESSAGES = 60;
const MAX_HISTORY_CHARS = 1_500_000; // iPhoneの保存領域を圧迫しないよう、会話履歴の保存サイズを抑える

export type Effort = "low" | "medium" | "high";

export interface AgentSettings {
  apiKey: string;
  userCallName: string;
  effort: Effort;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "done" }
  | { type: "error"; message: string; kind: "auth" | "network" | "other" };

const toolsByName = new Map(localTools.map((t) => [t.name, t]));
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";

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

let settings: AgentSettings = { apiKey: "", userCallName: "", effort: "low" };
let client: Anthropic | null = null;
let history: Anthropic.Beta.BetaMessageParam[] = load("history", []);

export function configure(next: AgentSettings): void {
  if (next.apiKey !== settings.apiKey) client = null;
  settings = next;
}

function getClient(): Anthropic {
  if (!settings.apiKey) throw new MissingKeyError();
  // ブラウザから直接呼ぶ設定。キーはこのiPhoneの中にだけ保存され、Anthropic 以外には送られない
  client ??= new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  return client;
}

class MissingKeyError extends Error {}

export function resetConversation(): void {
  history = [];
  remove("history");
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
function trimHistory(): void {
  const isPlainUser = (m: Anthropic.Beta.BetaMessageParam) =>
    m.role === "user" && (typeof m.content === "string" || !m.content.some((b) => b.type === "tool_result"));
  const dropOldest = () => {
    let cut = 1;
    while (cut < history.length && !isPlainUser(history[cut])) cut++;
    history.splice(0, cut);
  };
  while (history.length > MAX_HISTORY_MESSAGES) dropOldest();
  while (history.length > 2 && JSON.stringify(history).length > MAX_HISTORY_CHARS) dropOldest();
}

function persistHistory(): void {
  trimHistory();
  if (!save("history", history)) remove("history"); // 保存できなくても会話は続けられる
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
export async function runTurn(userText: string, emit: (ev: AgentEvent) => void, signal: AbortSignal): Promise<void> {
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
    const anthropic = getClient();
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = anthropic.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          system: systemPrompt(settings.userCallName),
          tools: apiTools,
          messages: history,
          output_config: { effort: settings.effort },
          cache_control: { type: "ephemeral" },
          // 安全分類器で断られた場合、サーバー側で適切なモデルに自動で引き継ぐ
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      stream.on("text", (delta) => emit({ type: "text", text: delta }));
      stream.on("streamEvent", (event) => {
        if (event.type !== "content_block_start") return;
        const block = event.content_block;
        if (block.type === "tool_use") {
          emit({ type: "tool", name: block.name, label: toolsByName.get(block.name)?.label ?? "処理中" });
        } else if (block.type === "server_tool_use") {
          emit({ type: "tool", name: block.name, label: serverToolLabel(block.name) });
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
      history.push({ role: "user", content: await Promise.all(toolUses.map(executeTool)) });
    }
    persistHistory();
    emit({ type: "done" });
  } catch (err) {
    history.splice(rollbackTo); // 失敗したターンは履歴に残さない
    if (signal.aborted) return;
    emit(describeError(err));
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

function describeError(err: unknown): Extract<AgentEvent, { type: "error" }> {
  const e = (message: string, kind: "auth" | "network" | "other" = "other") => ({ type: "error" as const, message, kind });
  if (err instanceof MissingKeyError) return e("APIキーが入っていません。右上の設定から入力してください", "auth");
  if (err instanceof Anthropic.AuthenticationError) return e("APIキーが正しくないようです。設定で入れ直してください", "auth");
  if (err instanceof Anthropic.PermissionDeniedError) return e("このAPIキーでは使えないようです。Anthropicのコンソールで権限を確認してください", "auth");
  if (err instanceof Anthropic.RateLimitError) return e("混み合っているようです。少し待ってからもう一度どうぞ");
  if (err instanceof Anthropic.APIConnectionError) return e("インターネットにつながらないようです。電波を確認してください", "network");
  if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) {
    return e("APIの残高が足りないようです。Anthropicのコンソールでクレジットを確認してください");
  }
  if (err instanceof Anthropic.APIError) return e(`Claude APIでエラーが起きました（${err.status}）`);
  console.error(err);
  return e("内部でエラーが起きました");
}
