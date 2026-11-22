import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "./types.js";

// メモとタスクは data/memory.json に保存する（このファイルは git に含めない）。
const DATA_DIR = path.resolve(process.env.HAYATO_DATA_DIR ?? "data");
const FILE = path.join(DATA_DIR, "memory.json");

interface Note {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}
interface Task {
  id: string;
  title: string;
  due?: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}
interface Store {
  notes: Note[];
  tasks: Task[];
}

let cache: Store | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<Store>;
    cache = { notes: parsed.notes ?? [], tasks: parsed.tasks ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cache = { notes: [], tasks: [] };
  }
  return cache;
}

async function save(store: Store): Promise<void> {
  // 書き込みを直列化して、同時に呼ばれてもファイルが壊れないようにする
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, FILE);
  });
  return writing;
}

const shortId = () => randomUUID().slice(0, 8);

function fmtTask(t: Task): string {
  return `[${t.id}] ${t.done ? "（完了）" : ""}${t.title}${t.due ? ` / 期限: ${t.due}` : ""}`;
}

export const memoryTools = [
  defineTool({
    name: "add_note",
    label: "メモを記録中",
    description:
      "持ち主に頼まれたこと、覚えておくべき事実・好み・アイデアをメモに保存する。後で search_notes で探せる。",
    schema: z.object({
      text: z.string().min(1).describe("メモの本文。後で読んで分かるように具体的に書く"),
      tags: z.array(z.string()).optional().describe("分類用のタグ（例: 仕事, 買い物, 好み）"),
    }),
    run: async ({ text, tags }) => {
      const store = await load();
      const note: Note = { id: shortId(), text, tags: tags ?? [], createdAt: new Date().toISOString() };
      store.notes.push(note);
      await save(store);
      return `メモを保存しました（id: ${note.id}）`;
    },
  }),
  defineTool({
    name: "search_notes",
    label: "メモを検索中",
    description:
      "保存済みのメモをキーワードで探す。キーワードを空にすると最近のメモを返す。過去の会話や持ち主の好みを思い出すときに使う。",
    schema: z.object({
      query: z.string().describe("探したい言葉。空文字なら最近のメモ"),
      limit: z.number().int().min(1).max(50).optional().describe("最大件数（既定 10）"),
    }),
    run: async ({ query, limit }) => {
      const store = await load();
      const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = store.notes
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
    run: async ({ id }) => {
      const store = await load();
      const before = store.notes.length;
      store.notes = store.notes.filter((n) => n.id !== id);
      if (store.notes.length === before) return `id ${id} のメモは見つかりません。`;
      await save(store);
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
    run: async ({ title, due }) => {
      const store = await load();
      const task: Task = { id: shortId(), title, due, done: false, createdAt: new Date().toISOString() };
      store.tasks.push(task);
      await save(store);
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
    run: async ({ include_done }) => {
      const store = await load();
      const tasks = store.tasks.filter((t) => include_done || !t.done);
      if (tasks.length === 0) return include_done ? "タスクはありません。" : "未完了のタスクはありません。";
      return tasks.map(fmtTask).join("\n");
    },
  }),
  defineTool({
    name: "complete_task",
    label: "タスクを完了に更新中",
    description: "id を指定してタスクを完了にする。",
    schema: z.object({ id: z.string().describe("list_tasks で得た id") }),
    run: async ({ id }) => {
      const store = await load();
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return `id ${id} のタスクは見つかりません。`;
      task.done = true;
      task.doneAt = new Date().toISOString();
      await save(store);
      return `完了にしました: ${task.title}`;
    },
  }),
];
