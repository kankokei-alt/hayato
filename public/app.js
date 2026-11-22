// ハヤト クライアント: 音声認識 → サーバー（Claude）→ 音声合成 の流れと、中央コアのアニメーション。

const $ = (id) => document.getElementById(id);
const els = {
  core: $("core"), stateLabel: $("stateLabel"), activity: $("activity"),
  youText: $("youText"), hayatoText: $("hayatoText"),
  mic: $("micBtn"), autoListen: $("autoListen"),
  textForm: $("textForm"), textInput: $("textInput"),
  log: $("log"), logBody: $("logBody"), logToggle: $("logToggle"), resetBtn: $("resetBtn"),
  settings: $("settings"), settingsBtn: $("settingsBtn"), passcode: $("passcode"),
  voiceSelect: $("voiceSelect"), rate: $("rate"), rateOut: $("rateOut"),
  pitch: $("pitch"), pitchOut: $("pitchOut"), testVoice: $("testVoice"),
  calStatus: $("calStatus"), calConnect: $("calConnect"), brandName: $("brandName"),
};

// ---------- 端末ごとの設定（localStorage は使えないこともあるので必ず try で囲む） ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`hayato.${key}`); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hayato.${key}`, JSON.stringify(value)); } catch { /* 保存できなくても動作は続ける */ }
  },
};

const settings = {
  passcode: store.get("passcode", ""),
  voiceURI: store.get("voiceURI", ""),
  rate: store.get("rate", 1.1),
  pitch: store.get("pitch", 0.9),
  autoListen: store.get("autoListen", false),
};
let conversationId = store.get("conversationId", null) || newConversationId();
function newConversationId() {
  const id = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2));
  store.set("conversationId", id);
  return id;
}

// ---------- 状態 ----------
const STATE_TEXT = {
  idle: "STANDBY", listening: "LISTENING", thinking: "ANALYZING", speaking: "SPEAKING", error: "ERROR",
};
let state = "idle";
function setState(next, activity) {
  state = next;
  document.body.dataset.state = next;
  els.stateLabel.textContent = STATE_TEXT[next];
  if (activity !== undefined) els.activity.textContent = activity;
}

// ---------- 音声合成（読み上げ） ----------
const synth = window.speechSynthesis;
let voices = [];
let speakQueue = [];
let speaking = false;
let speechLevel = 0; // コアのアニメーション用

function pickDefaultVoice() {
  const ja = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  // 男性的で落ち着いた声を優先。端末によって名前が違うので候補を順に探す
  const prefer = ["Otoya", "Hattori", "Ichiro", "Keita", "Daichi", "Male", "男性", "Google 日本語"];
  for (const name of prefer) {
    const hit = ja.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return ja[0] ?? voices[0];
}

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  els.voiceSelect.innerHTML = "";
  const ja = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  const list = ja.length ? ja : voices;
  for (const v of list) {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = `${v.name}${v.localService ? "" : "（オンライン）"}`;
    els.voiceSelect.append(opt);
  }
  const chosen = list.find((v) => v.voiceURI === settings.voiceURI) ?? pickDefaultVoice();
  if (chosen) els.voiceSelect.value = chosen.voiceURI;
}
if (synth) {
  loadVoices();
  synth.addEventListener?.("voiceschanged", loadVoices);
}

function currentVoice() {
  return voices.find((v) => v.voiceURI === els.voiceSelect.value) ?? pickDefaultVoice();
}

/** 読み上げに向かない記号を取り除く */
function cleanForSpeech(text) {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|~]/g, "")
    .replace(/^\s*[-・]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function enqueueSpeech(text) {
  const t = cleanForSpeech(text);
  if (!t || !synth) return;
  speakQueue.push(t);
  if (!speaking) speakNext();
}

function speakNext() {
  const text = speakQueue.shift();
  if (!text) {
    speaking = false;
    if (!streamDone) setState("thinking"); // ツール実行中などで返答の続きを待っている
    maybeFinishSpeaking();
    return;
  }
  speaking = true;
  setState("speaking");
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "ja-JP"; }
  u.rate = Number(els.rate.value);
  u.pitch = Number(els.pitch.value);
  u.onboundary = () => { speechLevel = 1; };
  u.onend = () => speakNext();
  u.onerror = () => speakNext();
  synth.speak(u);
}

function stopSpeaking() {
  speakQueue = [];
  speaking = false;
  synth?.cancel();
}

// 返答の受信が終わり、読み上げも終わったら待機に戻る（連続会話なら聞き取り再開）
let streamDone = true;
function maybeFinishSpeaking() {
  if (!streamDone || speaking) return;
  if (state === "error") return;
  setState("idle", "マイクをタップ");
  if (els.autoListen.checked && recognition) setTimeout(() => { if (state === "idle") startListening(); }, 350);
}

// iOS は最初のタップで一度 speak しないと、後から読み上げられない
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked || !synth) return;
  audioUnlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  synth.speak(u);
}

// ---------- 音声認識 ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let finalTranscript = "";
if (Recognition) {
  recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalTranscript += r[0].transcript;
      else interim += r[0].transcript;
    }
    els.youText.textContent = finalTranscript + interim;
    speechLevel = 0.8;
  };
  recognition.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    const msg = e.error === "not-allowed" ? "マイクの使用が許可されていません" : `音声認識エラー: ${e.error}`;
    setState("error", msg);
  };
  recognition.onend = () => {
    if (state !== "listening") return;
    const text = finalTranscript.trim();
    if (text) send(text);
    else setState("idle", "聞き取れませんでした。もう一度どうぞ");
  };
} else {
  els.activity.textContent = "このブラウザは音声認識に未対応です。文字で話しかけてください";
}

function startListening() {
  if (!recognition) return;
  stopSpeaking();
  finalTranscript = "";
  els.youText.textContent = "";
  setState("listening", "お話しください");
  try { recognition.start(); } catch { /* 既に開始済み */ }
}

function stopListening() {
  try { recognition?.stop(); } catch { /* noop */ }
}

// ---------- サーバーとの通信 ----------
let currentRequest = null;

async function send(text) {
  currentRequest?.abort();
  stopSpeaking();
  const controller = new AbortController();
  currentRequest = controller;
  streamDone = false;

  els.youText.textContent = text;
  els.hayatoText.textContent = "";
  addLog("user", text);
  setState("thinking", "分析中…");

  let reply = "";
  let pending = ""; // まだ読み上げていない文の断片
  let bubble = null; // ログ上の今の返答の吹き出し（ツール実行をはさむと新しい吹き出しにする）

  const flushSentences = (force = false) => {
    // 句点・感嘆符・改行で区切って、文ごとに読み上げを始める（全文を待たないので応答が速く感じる）
    const re = /[^。！？!?\n]*[。！？!?\n]+/g;
    let m, last = 0;
    while ((m = re.exec(pending))) { enqueueSpeech(m[0]); last = re.lastIndex; }
    pending = pending.slice(last);
    if (force && pending.trim()) { enqueueSpeech(pending); pending = ""; }
  };

  try {
    const res = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hayato-passcode": els.passcode.value },
      body: JSON.stringify({ conversationId, text }),
      signal: controller.signal,
    });
    if (res.status === 401) throw new Error("パスコードが違います。右上の設定から入力してください");
    if (!res.ok || !res.body) throw new Error(`サーバーエラー（${res.status}）`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!chunk.startsWith("data: ")) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.type === "text") {
          reply += ev.text;
          pending += ev.text;
          els.hayatoText.textContent = reply;
          bubble ??= addLog("assistant", "");
          bubble.textContent += ev.text;
          flushSentences();
        } else if (ev.type === "tool") {
          flushSentences(true);
          if (!speaking) setState("thinking");
          els.activity.textContent = `${ev.label}…`;
          addLog("tool", `▸ ${ev.label}`);
          bubble = null;
          // ツールの前後の文が続けて表示されるよう区切りを入れる
          if (reply && !/\s$/.test(reply)) reply += " ";
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
    }
    flushSentences(true);
  } catch (err) {
    if (controller.signal.aborted) return;
    stopSpeaking();
    setState("error", err.message);
    addLog("error", err.message);
    enqueueSpeech(err.message);
  } finally {
    if (currentRequest === controller) currentRequest = null;
    streamDone = true;
    if (!speaking && state !== "error") maybeFinishSpeaking();
    else if (state === "error") setTimeout(() => { if (state === "error" && !speaking) setState("idle"); }, 4000);
  }
}

function addLog(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  els.logBody.append(div);
  els.logBody.scrollTop = els.logBody.scrollHeight;
  return div;
}

// ---------- 操作 ----------
els.mic.addEventListener("click", () => {
  unlockAudio();
  if (!recognition) { els.textInput.focus(); return; }
  if (state === "listening") { stopListening(); return; }
  // 考え中・話し中にタップしたら割り込んで聞き取りへ
  currentRequest?.abort();
  currentRequest = null;
  streamDone = true;
  startListening();
});

els.textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  const text = els.textInput.value.trim();
  if (!text) return;
  els.textInput.value = "";
  els.textInput.blur();
  send(text);
});

els.autoListen.checked = settings.autoListen;
els.autoListen.addEventListener("change", () => store.set("autoListen", els.autoListen.checked));

els.logToggle.addEventListener("click", () => {
  els.log.hidden = !els.log.hidden;
  els.logToggle.setAttribute("aria-pressed", String(!els.log.hidden));
});

els.resetBtn.addEventListener("click", async () => {
  currentRequest?.abort();
  stopSpeaking();
  const old = conversationId;
  conversationId = newConversationId();
  els.logBody.innerHTML = "";
  els.youText.textContent = "";
  els.hayatoText.textContent = "";
  setState("idle", "新しい会話を始めました");
  fetch("api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hayato-passcode": els.passcode.value },
    body: JSON.stringify({ conversationId: old }),
  }).catch(() => {});
});

// 設定ダイアログ
els.passcode.value = settings.passcode;
els.rate.value = settings.rate; els.rateOut.textContent = settings.rate;
els.pitch.value = settings.pitch; els.pitchOut.textContent = settings.pitch;
els.settingsBtn.addEventListener("click", () => { refreshStatus(); els.settings.showModal(); });
els.passcode.addEventListener("change", () => { store.set("passcode", els.passcode.value); refreshStatus(); });
els.voiceSelect.addEventListener("change", () => store.set("voiceURI", els.voiceSelect.value));
els.rate.addEventListener("input", () => { els.rateOut.textContent = els.rate.value; store.set("rate", Number(els.rate.value)); });
els.pitch.addEventListener("input", () => { els.pitchOut.textContent = els.pitch.value; store.set("pitch", Number(els.pitch.value)); });
els.testVoice.addEventListener("click", () => {
  unlockAudio();
  stopSpeaking();
  enqueueSpeech("準備はできています。いつでもどうぞ。");
});
els.calConnect.addEventListener("click", () => {
  location.href = `auth/google?passcode=${encodeURIComponent(els.passcode.value)}`;
});

async function refreshStatus() {
  try {
    const res = await fetch("api/status", { headers: { "x-hayato-passcode": els.passcode.value } });
    if (res.status === 401) {
      els.calStatus.textContent = "パスコードを入力してください";
      return false;
    }
    const s = await res.json();
    if (s.name) els.brandName.textContent = s.name === "ハヤト" ? "HAYATO" : s.name;
    els.calStatus.textContent = !s.calendar.configured ? "サーバー側で未設定" : s.calendar.connected ? "接続済み" : "未接続";
    els.calConnect.hidden = !s.calendar.configured;
    els.calConnect.textContent = s.calendar.connected ? "接続し直す" : "接続する";
    return true;
  } catch {
    els.calStatus.textContent = "サーバーに接続できません";
    return false;
  }
}

// 初回: パスコードが必要なのに未入力なら設定を開く
(async () => {
  const ok = await refreshStatus();
  if (!ok) {
    try {
      const r = await (await fetch("api/auth-required")).json();
      if (r.required) { els.activity.textContent = "右上の設定でパスコードを入力してください"; els.settings.showModal(); }
    } catch { /* noop */ }
  }
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- 中央コアのアニメーション ----------
const ctx = els.core.getContext("2d");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COLORS = {
  idle: [70, 216, 255], listening: [70, 216, 255], thinking: [255, 181, 71], speaking: [140, 255, 200], error: [255, 107, 107],
};
let color = [...COLORS.idle];
let energy = 0;
const BARS = 72;
const bars = new Float32Array(BARS);

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const r = els.core.getBoundingClientRect();
  els.core.width = r.width * dpr;
  els.core.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

function frame(t) {
  const w = els.core.clientWidth, h = els.core.clientHeight;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
  const time = reduceMotion ? 0 : t / 1000;

  // 色と勢いを状態に合わせてなめらかに変える
  const target = COLORS[state];
  for (let i = 0; i < 3; i++) color[i] += (target[i] - color[i]) * 0.08;
  const targetEnergy = { idle: 0.15, listening: 0.55, thinking: 0.7, speaking: 0.9, error: 0.3 }[state];
  energy += (targetEnergy - energy) * 0.05;
  speechLevel *= 0.92;
  const rgb = (a) => `rgba(${color[0] | 0}, ${color[1] | 0}, ${color[2] | 0}, ${a})`;

  ctx.clearRect(0, 0, w, h);

  // 外周の目盛りリング
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.05);
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 10 === 0;
    ctx.strokeStyle = rgb(long ? 0.55 : 0.18);
    ctx.lineWidth = long ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
    ctx.lineTo(Math.cos(a) * R * (long ? 0.88 : 0.91), Math.sin(a) * R * (long ? 0.88 : 0.91));
    ctx.stroke();
  }
  ctx.restore();

  // 分割された回転リング（考え中は速く回る）
  const spin = state === "thinking" ? 1.6 : 0.25;
  for (let k = 0; k < 3; k++) {
    const rr = R * (0.8 - k * 0.07);
    const segs = 3 + k * 2;
    ctx.strokeStyle = rgb(0.5 - k * 0.12);
    ctx.lineWidth = 2 - k * 0.4;
    for (let s = 0; s < segs; s++) {
      const start = (s / segs) * Math.PI * 2 + time * spin * (k % 2 ? -1 : 1) * (1 + k * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, start, start + (Math.PI * 2 / segs) * 0.55);
      ctx.stroke();
    }
  }

  // 放射状の波形（話すと伸びる）
  const inner = R * 0.42;
  for (let i = 0; i < BARS; i++) {
    const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const noise =
      Math.sin(time * 3.1 + i * 0.55) * 0.5 + Math.sin(time * 5.3 + i * 1.7) * 0.3 + Math.sin(time * 1.3 + i * 0.2) * 0.2;
    const amp = energy * (0.35 + 0.65 * Math.abs(noise)) + speechLevel * 0.35 * Math.random();
    bars[i] += (amp - bars[i]) * 0.25;
    const len = R * 0.04 + R * 0.2 * bars[i];
    ctx.strokeStyle = rgb(0.35 + 0.5 * bars[i]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
    ctx.stroke();
  }

  // 中心の光るコア（呼吸するように明滅）
  const pulse = 0.85 + Math.sin(time * 2) * 0.05 + energy * 0.1;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, inner * 0.95 * pulse);
  g.addColorStop(0, rgb(0.35));
  g.addColorStop(0.6, rgb(0.08));
  g.addColorStop(1, rgb(0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, inner * 0.95 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(0.6);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, inner * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  requestAnimationFrame(frame);
}
setState("idle");
requestAnimationFrame(frame);
