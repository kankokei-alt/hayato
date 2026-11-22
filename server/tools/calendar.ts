import { promises as fs } from "node:fs";
import path from "node:path";
import { google, type calendar_v3 } from "googleapis";
import { z } from "zod";
import { defineTool } from "./types.js";

// Google カレンダー連携。OAuth クライアントを .env に設定し、/auth/google で一度ログインすると使える。
const DATA_DIR = path.resolve(process.env.HAYATO_DATA_DIR ?? "data");
const TOKEN_FILE = path.join(DATA_DIR, "google-token.json");
export const TIME_ZONE = process.env.HAYATO_TIMEZONE ?? "Asia/Tokyo";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

export function calendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function oauthClient() {
  const port = process.env.PORT ?? "3000";
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
  );
}

export function googleAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
}

export async function handleGoogleCallback(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function calendarConnected(): Promise<boolean> {
  try {
    await fs.access(TOKEN_FILE);
    return true;
  } catch {
    return false;
  }
}

async function calendarApi(): Promise<calendar_v3.Calendar> {
  if (!calendarConfigured()) {
    throw new Error("Googleカレンダーが未設定です（.env の GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。");
  }
  let tokens;
  try {
    tokens = JSON.parse(await fs.readFile(TOKEN_FILE, "utf8"));
  } catch {
    throw new Error("Googleカレンダーにまだログインしていません。画面の設定から「Googleカレンダーを接続」を押してください。");
  }
  const client = oauthClient();
  client.setCredentials(tokens);
  // アクセストークンが更新されたら保存し直す
  client.on("tokens", (fresh) => {
    const merged = { ...tokens, ...fresh };
    fs.writeFile(TOKEN_FILE, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600 }).catch(() => {});
  });
  return google.calendar({ version: "v3", auth: client });
}

/** "2026-11-25" や "2026-11-25T15:00" を RFC3339 に。タイムゾーンが無ければ設定のタイムゾーンとみなす。 */
function toRfc3339(value: string, endOfDay = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += endOfDay ? "T23:59:59" : "T00:00:00";
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).toISOString();
  // タイムゾーン無しの日時を TIME_ZONE の壁時計時刻として解釈する
  const asUtc = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  const offsetMin = tzOffsetMinutes(asUtc);
  return new Date(asUtc.getTime() - offsetMin * 60_000).toISOString();
}

function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((local - at.getTime()) / 60_000);
}

function fmtEvent(e: calendar_v3.Schema$Event): string {
  const fmt = (d?: calendar_v3.Schema$EventDateTime) => {
    if (!d) return "?";
    if (d.date) return `${d.date}（終日）`;
    return new Date(d.dateTime!).toLocaleString("ja-JP", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
  };
  const loc = e.location ? ` @${e.location}` : "";
  return `[${e.id}] ${fmt(e.start)} 〜 ${fmt(e.end)} ${e.summary ?? "（無題）"}${loc}`;
}

export const calendarTools = [
  defineTool({
    name: "list_calendar_events",
    label: "カレンダーを確認中",
    description: "Googleカレンダー（メインのカレンダー）の予定を期間で取得する。キーワードで絞り込める。",
    schema: z.object({
      time_min: z.string().describe("開始日時。YYYY-MM-DD または YYYY-MM-DDTHH:mm（タイムゾーン省略時は持ち主の地域時間）"),
      time_max: z.string().describe("終了日時。同じ形式"),
      query: z.string().optional().describe("タイトルなどで絞り込むキーワード"),
    }),
    run: async ({ time_min, time_max, query }) => {
      const api = await calendarApi();
      const res = await api.events.list({
        calendarId: "primary",
        timeMin: toRfc3339(time_min),
        timeMax: toRfc3339(time_max, true),
        q: query,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
        timeZone: TIME_ZONE,
      });
      const items = res.data.items ?? [];
      if (items.length === 0) return "その期間に予定はありません。";
      return items.map(fmtEvent).join("\n");
    },
  }),
  defineTool({
    name: "create_calendar_event",
    label: "予定を登録中",
    description: "Googleカレンダー（メイン）に予定を作成する。登録前に日時とタイトルを持ち主に確認しておくこと。",
    schema: z.object({
      title: z.string().min(1).describe("予定のタイトル"),
      start: z.string().describe("開始。時刻ありは YYYY-MM-DDTHH:mm、終日は YYYY-MM-DD"),
      end: z.string().optional().describe("終了。省略時は時刻ありなら1時間後、終日ならその日のみ"),
      location: z.string().optional(),
      description: z.string().optional(),
    }),
    run: async ({ title, start, end, location, description }) => {
      const api = await calendarApi();
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
      let startObj: calendar_v3.Schema$EventDateTime;
      let endObj: calendar_v3.Schema$EventDateTime;
      if (allDay) {
        const endDate = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : start;
        const next = new Date(`${endDate}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1); // Google の終日予定は終了日を含まない
        startObj = { date: start };
        endObj = { date: next.toISOString().slice(0, 10) };
      } else {
        const s = toRfc3339(start);
        const e = end ? toRfc3339(end) : new Date(new Date(s).getTime() + 3_600_000).toISOString();
        startObj = { dateTime: s, timeZone: TIME_ZONE };
        endObj = { dateTime: e, timeZone: TIME_ZONE };
      }
      const res = await api.events.insert({
        calendarId: "primary",
        requestBody: { summary: title, location, description, start: startObj, end: endObj },
      });
      return `予定を登録しました: ${fmtEvent(res.data)}`;
    },
  }),
  defineTool({
    name: "delete_calendar_event",
    label: "予定を削除中",
    description: "id を指定して予定を削除する。かならず事前に持ち主の明確な同意を得ること。",
    schema: z.object({ event_id: z.string().describe("list_calendar_events で得た id") }),
    run: async ({ event_id }) => {
      const api = await calendarApi();
      await api.events.delete({ calendarId: "primary", eventId: event_id });
      return `予定 ${event_id} を削除しました。`;
    },
  }),
];
