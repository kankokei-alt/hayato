import "dotenv/config";
import path from "node:path";
import { timingSafeEqual, createHash, randomBytes } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { runTurn, resetConversation, type AgentEvent } from "./agent.js";
import { ASSISTANT_NAME } from "./persona.js";
import { calendarConfigured, calendarConnected, googleAuthUrl, handleGoogleCallback } from "./tools/calendar.js";

const PORT = Number(process.env.PORT ?? 3000);
const PASSCODE = process.env.HAYATO_PASSCODE ?? "";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.resolve("public"), { extensions: ["html"] }));

function passcodeOk(given: unknown): boolean {
  if (!PASSCODE) return true; // 未設定なら認証なし（自分のPCだけで使う場合）
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(PASSCODE).digest();
  return timingSafeEqual(a, b);
}

function requirePasscode(req: Request, res: Response, next: NextFunction) {
  if (passcodeOk(req.get("x-hayato-passcode"))) return next();
  res.status(401).json({ error: "passcode" });
}

app.get("/api/status", requirePasscode, async (_req, res) => {
  res.json({
    name: ASSISTANT_NAME,
    calendar: { configured: calendarConfigured(), connected: await calendarConnected() },
  });
});

// 認証が必要かどうかだけは誰でも確認できる（ログイン画面を出すため）
app.get("/api/auth-required", (_req, res) => {
  res.json({ required: Boolean(PASSCODE) });
});

app.post("/api/reset", requirePasscode, (req, res) => {
  const id = String(req.body?.conversationId ?? "");
  if (id) resetConversation(id);
  res.json({ ok: true });
});

app.post("/api/chat", requirePasscode, async (req, res) => {
  const conversationId = String(req.body?.conversationId ?? "").slice(0, 100);
  const text = String(req.body?.text ?? "").trim().slice(0, 4000);
  if (!conversationId || !text) {
    res.status(400).json({ error: "conversationId と text が必要です" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const emit = (ev: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  await runTurn(conversationId, text, emit, controller.signal);
  res.end();
});

// --- Google カレンダーの OAuth ---
const oauthStates = new Set<string>();

app.get("/auth/google", (req, res) => {
  if (!passcodeOk(req.query.passcode)) {
    res.status(401).send("パスコードが違います");
    return;
  }
  if (!calendarConfigured()) {
    res.status(400).send(".env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。");
    return;
  }
  const state = randomBytes(16).toString("hex");
  oauthStates.add(state);
  setTimeout(() => oauthStates.delete(state), 10 * 60_000);
  res.redirect(googleAuthUrl(state));
});

app.get("/auth/google/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !oauthStates.delete(state)) {
    res.status(400).send("認可コードが無いか、期限切れです。もう一度接続し直してください。");
    return;
  }
  try {
    await handleGoogleCallback(code);
    res.send(`<meta charset="utf-8"><p>Googleカレンダーを接続しました。このタブを閉じて${ASSISTANT_NAME}に戻ってください。</p><p><a href="/">戻る</a></p>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Googleカレンダーの接続に失敗しました。サーバーのログを確認してください。");
  }
});

app.listen(PORT, () => {
  console.log(`${ASSISTANT_NAME} 起動: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("警告: ANTHROPIC_API_KEY が設定されていません（.env を確認）");
  }
  if (!PASSCODE) console.warn("注意: HAYATO_PASSCODE 未設定。インターネットに公開する場合は必ず設定してください。");
});
