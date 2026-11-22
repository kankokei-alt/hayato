import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { load, save } from "./storage.js";

/** ハヤトが使う自前ツール（iPhoneの中で実行するもの）。 */
export interface HayatoTool {
  name: string;
  /** 画面に出す「〜中」の表示 */
  label: string;
  description: string;
  schema: z.ZodObject;
  run: (input: any) => Promise<string> | string;
}

function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  label: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string> | string;
}): HayatoTool {
  return tool;
}

/** Claude API に渡すツール定義へ変換する。 */
export function toApiTool(tool: HayatoTool): Anthropic.Beta.BetaTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    // ストリーミングでツール入力を逐次受け取る。入力は実行前に zod で検証する（agent.ts）。
    eager_input_streaming: true,
  };
}

// ---------- メモとタスク（iPhoneの中に保存） ----------

export interface Note {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}
export interface Task {
  id: string;
  title: string;
  due?: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}
export interface MemoryData {
  notes: Note[];
  tasks: Task[];
}

const KEY = "memory";

export function loadMemory(): MemoryData {
  const m = load<Partial<MemoryData>>(KEY, {});
  return { notes: m.notes ?? [], tasks: m.tasks ?? [] };
}

function saveMemory(m: MemoryData): void {
  if (!save(KEY, m)) throw new Error("iPhoneに保存できませんでした（空き容量やプライベートブラウズを確認）。");
}

/** バックアップから読み込む（設定画面で使う） */
export function importMemory(data: unknown): MemoryData {
  const parsed = z
    .object({
      notes: z.array(z.object({ id: z.string(), text: z.string(), tags: z.array(z.string()), createdAt: z.string() })),
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          due: z.string().optional(),
          done: z.boolean(),
          createdAt: z.string(),
          doneAt: z.string().optional(),
        }),
      ),
    })
    .parse(data);
  saveMemory(parsed);
  return parsed;
}

const shortId = () => (crypto.randomUUID?.() ?? Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 8);

function fmtTask(t: Task): string {
  return `[${t.id}] ${t.done ? "（完了）" : ""}${t.title}${t.due ? ` / 期限: ${t.due}` : ""}`;
}

export const localTools: HayatoTool[] = [
  defineTool({
    name: "add_note",
    label: "メモを記録中",
    description:
      "持ち主に頼まれたこと、覚えておくべき事実・好み・アイデアをメモに保存する。後で search_notes で探せる。",
    schema: z.object({
      text: z.string().min(1).describe("メモの本文。後で読んで分かるように具体的に書く"),
      tags: z.array(z.string()).optional().describe("分類用のタグ（例: 仕事, 買い物, 好み）"),
    }),
    run: ({ text, tags }) => {
      const m = loadMemory();
      const note: Note = { id: shortId(), text, tags: tags ?? [], createdAt: new Date().toISOString() };
      m.notes.push(note);
      saveMemory(m);
      return `メモを保存しました（id: ${note.id}）`;
    },
  }),
  defineTool({
    name: "search_notes",
    label: "メモを検索中",
    description:
      "保存済みのメモをキーワードで探す。キーワードを空にすると最近のメモを返す。過去の会話や持ち主の好みを思い出すときに使う。",
    schema: z.object({
      query: z.string().describe("探したい言葉（スペース区切りで AND 検索）。空文字なら最近のメモ"),
      limit: z.number().int().min(1).max(50).optional().describe("最大件数（既定 10）"),
    }),
    run: ({ query, limit }) => {
      const m = loadMemory();
      const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = m.notes
        .filter((n) => {
          const hay = `${n.text} ${n.tags.join(" ")}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .slice(-(limit ?? 10))
        .reverse();
      if (hits.length === 0) return "該当するメモはありません。";
      return hits
        .map((n) => `[${n.id}] ${n.createdAt.slice(0, 10)} ${n.text}${n.tags.length ? ` #${n.tags.join(" #")}` : ""}`)
        .join("\n");
    },
  }),
  defineTool({
    name: "delete_note",
    label: "メモを削除中",
    description: "id を指定してメモを削除する。持ち主が削除を望んだときだけ使う。",
    schema: z.object({ id: z.string().describe("search_notes で得た id") }),
    run: ({ id }) => {
      const m = loadMemory();
      const before = m.notes.length;
      m.notes = m.notes.filter((n) => n.id !== id);
      if (m.notes.length === before) return `id ${id} のメモは見つかりません。`;
      saveMemory(m);
      return `メモ ${id} を削除しました。`;
    },
  }),
  defineTool({
    name: "add_task",
    label: "タスクを登録中",
    description: "やることリストにタスクを追加する。",
    schema: z.object({
      title: z.string().min(1).describe("タスクの内容"),
      due: z.string().optional().describe("期限（YYYY-MM-DD または YYYY-MM-DDTHH:mm）。なければ省略"),
    }),
    run: ({ title, due }) => {
      const m = loadMemory();
      const task: Task = { id: shortId(), title, due, done: false, createdAt: new Date().toISOString() };
      m.tasks.push(task);
      saveMemory(m);
      return `タスクを追加しました: ${fmtTask(task)}`;
    },
  }),
  defineTool({
    name: "list_tasks",
    label: "タスクを確認中",
    description: "やることリストを返す。既定では未完了のみ。",
    schema: z.object({
      include_done: z.boolean().optional().describe("完了済みも含めるなら true"),
    }),
    run: ({ include_done }) => {
      const tasks = loadMemory().tasks.filter((t) => include_done || !t.done);
      if (tasks.length === 0) return include_done ? "タスクはありません。" : "未完了のタスクはありません。";
      return tasks.map(fmtTask).join("\n");
    },
  }),
  defineTool({
    name: "complete_task",
    label: "タスクを完了に更新中",
    description: "id を指定してタスクを完了にする。",
    schema: z.object({ id: z.string().describe("list_tasks で得た id") }),
    run: ({ id }) => {
      const m = loadMemory();
      const task = m.tasks.find((t) => t.id === id);
      if (!task) return `id ${id} のタスクは見つかりません。`;
      task.done = true;
      task.doneAt = new Date().toISOString();
      saveMemory(m);
      return `完了にしました: ${task.title}`;
    },
  }),
];
