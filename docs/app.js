// ハヤト: 音声認識 → Claude（iPhoneから直接呼ぶ）→ 音声合成 の流れと、中央コアのアニメーション。
import * as agent from "./agent.js";
import { createCharacter, EXPRESSION_NAMES } from "./character.js";

const $ = (id) => document.getElementById(id);
const els = {
  core: $("core"), stateLabel: $("stateLabel"), activity: $("activity"),
  youText: $("youText"), hayatoText: $("hayatoText"),
  mic: $("micBtn"), autoListen: $("autoListen"),
  textForm: $("textForm"), textInput: $("textInput"),
  log: $("log"), logBody: $("logBody"), logToggle: $("logToggle"), resetBtn: $("resetBtn"),
  settings: $("settings"), settingsBtn: $("settingsBtn"), apiKey: $("apiKey"),
  callName: $("callName"), effort: $("effort"),
  voiceSelect: $("voiceSelect"), rate: $("rate"), rateOut: $("rateOut"),
  pitch: $("pitch"), pitchOut: $("pitchOut"), testVoice: $("testVoice"),
  keyboardBtn: $("keyboardBtn"), memoryCount: $("memoryCount"),
  exportBtn: $("exportBtn"), importBtn: $("importBtn"), importFile: $("importFile"),
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
  apiKey: store.get("apiKey", ""),
  callName: store.get("callName", ""),
  effort: store.get("effort", "low"),
  voiceURI: store.get("voiceURI", ""),
  rate: store.get("rate", 1.15),
  pitch: store.get("pitch", 1.0),
  autoListen: store.get("autoListen", false),
};
function applyAgentSettings() {
  agent.configure({ apiKey: settings.apiKey.trim(), userCallName: settings.callName, effort: settings.effort });
}
applyAgentSettings();

// ---------- 状態 ----------
const STATE_TEXT = {
  idle: "STANDBY", listening: "LISTENING", thinking: "ANALYZING", speaking: "SPEAKING", error: "ERROR",
};
const hayato = createCharacter($("character"));
let relaxTimer = null;

let state = "idle";
function setState(next, activity) {
  const prev = state;
  state = next;
  document.body.dataset.state = next;
  els.stateLabel.textContent = STATE_TEXT[next];
  // 状態に合わせた表情。話している間の表情は返答の中の [face:...] で決まる
  clearTimeout(relaxTimer);
  if (next === "listening") hayato.setExpression("listening");
  else if (next === "thinking" && prev !== "speaking") hayato.setExpression("thinking");
  else if (next === "error") hayato.setExpression("error");
  else if (next === "idle") relaxTimer = setTimeout(() => { if (state === "idle") hayato.setExpression("neutral"); }, 6000);
  if (activity === undefined) return;
  // 長い案内はリングの中に収まらないので、下の字幕エリアに出す
  if (activity.length > 20) {
    els.activity.textContent = "";
    els.hayatoText.textContent = activity;
  } else {
    els.activity.textContent = activity;
  }
}

// ---------- 音声合成（読み上げ） ----------
const synth = window.speechSynthesis;
let voices = [];
let speakQueue = [];
let speaking = false;
let speechLevel = 0; // コアのアニメーション用
let currentUtterance = null;

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

function enqueueSpeech(text, expression = null) {
  const t = cleanForSpeech(text);
  if (!synth) { if (expression) hayato.setExpression(expression); return; }
  if (!t) { if (expression) hayato.setExpression(expression); return; }
  speakQueue.push({ text: t, expression });
  if (!speaking) speakNext();
}

function speakNext() {
  const item = speakQueue.shift();
  if (!item) {
    speaking = false;
    hayato.setTalking(false);
    if (!streamDone) setState("thinking"); // ツール実行中などで返答の続きを待っている
    maybeFinishSpeaking();
    return;
  }
  speaking = true;
  setState("speaking");
  // その文に付いていた表情に切り替える（考え中・聞き取り中の顔のままなら普通の顔に）
  if (item.expression) hayato.setExpression(item.expression);
  else if (["thinking", "listening"].includes(hayato.expression)) hayato.setExpression("neutral");
  const u = new SpeechSynthesisUtterance(item.text);
  currentUtterance = u; // 参照を持っておかないと iPhone で onend が来なくなることがある
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "ja-JP"; }
  u.rate = Number(els.rate.value);
  u.pitch = Number(els.pitch.value);
  u.onstart = () => hayato.setTalking(true);
  u.onboundary = () => { speechLevel = 1; };
  u.onend = () => speakNext();
  u.onerror = () => speakNext();
  synth.speak(u);
}

function stopSpeaking() {
  speakQueue = [];
  speaking = false;
  hayato.setTalking(false);
  synth?.cancel();
}

// 返答の受信が終わり、読み上げも終わったら待機に戻る（連続会話なら聞き取り再開）
let streamDone = true;
let lastError = null; // エラーを読み上げたあとも画面に残しておく
function maybeFinishSpeaking() {
  if (!streamDone || speaking) return;
  if (state === "error") return;
  if (lastError) {
    setState("error", lastError);
    lastError = null;
    return; // エラーのあとは自動で聞き取りを再開しない
  }
  setState("idle", "マイクをタップ");
  if (els.autoListen.checked && recognition && !recognitionBroken) setTimeout(() => { if (state === "idle") startListening(); }, 350);
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
// iPhone の Safari は Siri の音声入力を使う。Safari 版と、ホーム画面に追加したアプリ版で挙動が違うことがあるので、
// 使えないと分かったらキーボードの音声入力（マイクキー）に切り替えるよう案内する。
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isStandalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
let recognition = null;
let recognitionBroken = false;
let heardText = "";
let silenceTimer = null;
const SILENCE_MS = 1400; // この時間しゃべらなければ話し終わりとみなす

function recognitionUnavailable(reason) {
  recognitionBroken = true;
  showTextInput(true);
  setState("error", reason);
  addLog("error", reason);
}

if (Recognition) {
  recognition = new Recognition();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    // iPhone は確定フラグ（isFinal）が付かないまま終わることがあるので、毎回全体を組み立て直す
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    heardText = text;
    els.youText.textContent = text;
    speechLevel = 0.8;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(stopListening, SILENCE_MS);
  };
  recognition.onerror = (e) => {
    clearTimeout(silenceTimer);
    if (e.error === "no-speech" || e.error === "aborted") return;
    if (e.error === "service-not-allowed") {
      recognitionUnavailable(
        isStandalone
          ? "この画面では音声認識が使えないようです。下のキーボードのマイクキーで話すか、Safariで開いてください"
          : "音声認識が使えません。iPhoneの設定 → Siri で「Siriに話しかける」または音声入力をオンにしてください",
      );
      return;
    }
    if (e.error === "not-allowed") {
      setState("error", "マイクが許可されていません。iPhoneの設定 → アプリ → Safari → マイク を「許可」にしてください");
      return;
    }
    setState("error", `音声認識エラー: ${e.error}`);
  };
  recognition.onend = () => {
    clearTimeout(silenceTimer);
    if (state !== "listening") return;
    const text = heardText.trim();
    if (text) send(text);
    else setState("idle", "聞き取れませんでした。もう一度どうぞ");
  };
} else {
  recognitionBroken = true;
  els.hayatoText.textContent = "音声認識が使えません。左下のキーボードボタンから、キーボードのマイクキーで話しかけてください";
}

function startListening() {
  if (!recognition || recognitionBroken) {
    showTextInput(true);
    els.textInput.focus();
    return;
  }
  stopSpeaking();
  heardText = "";
  els.youText.textContent = "";
  setState("listening", "お話しください");
  try { recognition.start(); } catch { /* 既に開始済み */ }
}

function stopListening() {
  clearTimeout(silenceTimer);
  try { recognition?.stop(); } catch { /* noop */ }
}

// ---------- Claude との会話 ----------
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
  let failure = null;
  let tagBuf = ""; // 途中で切れた [face:...] タグの断片
  let nextExpression = null; // 次に読み上げる文に付ける表情

  const flushSentences = (force = false) => {
    // 句点・感嘆符・改行で区切って、文ごとに読み上げを始める（全文を待たないので応答が速く感じる）
    const re = /[^。！？!?\n]*[。！？!?\n]+/g;
    let m, last = 0;
    while ((m = re.exec(pending))) { enqueueSpeech(m[0], nextExpression); nextExpression = null; last = re.lastIndex; }
    pending = pending.slice(last);
    if (force && (pending.trim() || nextExpression)) { enqueueSpeech(pending, nextExpression); nextExpression = null; pending = ""; }
  };

  // 返答に混ざる [face:smile] などの表情タグを取り除き、表情として使う
  const stripTags = (chunk, final = false) => {
    let input = tagBuf + chunk;
    tagBuf = "";
    let out = "";
    for (;;) {
      const open = input.indexOf("[");
      if (open < 0) { out += input; break; }
      out += input.slice(0, open);
      const rest = input.slice(open);
      const close = rest.indexOf("]");
      if (close < 0) {
        if (!final && rest.length < 24) tagBuf = rest; else out += rest;
        break;
      }
      const tag = rest.slice(1, close).match(/^face:\s*(\w+)$/);
      if (tag && EXPRESSION_NAMES.includes(tag[1])) {
        // 表情が変わる前の文は先に読み上げ待ちに入れておく
        if (pending.trim()) { enqueueSpeech(pending, nextExpression); pending = ""; }
        nextExpression = tag[1];
      } else if (!tag) {
        out += rest.slice(0, close + 1);
      }
      input = rest.slice(close + 1);
    }
    return out;
  };

  const addText = (text) => {
    if (!text) return;
    if (!reply) text = text.replace(/^\s+/, "");
    reply += text;
    pending += text;
    els.hayatoText.textContent = reply;
    bubble ??= addLog("assistant", "");
    bubble.textContent += text;
    flushSentences();
  };

  const onEvent = (ev) => {
    if (controller.signal.aborted) return;
    if (ev.type === "text") {
      addText(stripTags(ev.text));
    } else if (ev.type === "tool") {
      addText(stripTags("", true));
      flushSentences(true);
      if (!speaking) setState("thinking");
      els.activity.textContent = `${ev.label}…`;
      addLog("tool", `▸ ${ev.label}`);
      bubble = null;
      // ツールの前後の文が続けて表示されるよう区切りを入れる
      if (reply && !/\s$/.test(reply)) reply += " ";
    } else if (ev.type === "error") {
      failure = ev;
    }
  };

  try {
    await agent.runTurn(text, onEvent, controller.signal);
    if (controller.signal.aborted) return;
    if (failure) {
      stopSpeaking();
      setState("error", failure.message);
      addLog("error", failure.message);
      lastError = failure.message;
      enqueueSpeech(failure.message);
      if (failure.kind === "auth") els.settings.showModal();
    } else {
      addText(stripTags("", true));
      flushSentences(true);
    }
  } finally {
    if (currentRequest === controller) currentRequest = null;
    streamDone = true;
    if (!speaking) maybeFinishSpeaking();
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
  keepScreenOn();
  if (!recognition || recognitionBroken) { startListening(); return; }
  if (state === "listening") { stopListening(); return; }
  // 考え中・話し中にタップしたら割り込んで聞き取りへ
  currentRequest?.abort();
  currentRequest = null;
  streamDone = true;
  startListening();
});

function showTextInput(show) {
  els.textForm.hidden = !show;
  els.keyboardBtn.setAttribute("aria-pressed", String(show));
}
els.keyboardBtn.addEventListener("click", () => {
  const show = els.textForm.hidden;
  showTextInput(show);
  if (show) els.textInput.focus();
});

// 会話中に画面が消えないようにする（対応していない端末では何もしない）
let wakeLock = null;
async function keepScreenOn() {
  try {
    if (!wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* 非対応・拒否されても会話はできる */ }
}

// アプリを閉じた・裏に回したら、話すのと聞くのをやめる
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopListening();
    stopSpeaking();
    if (state === "listening" || state === "speaking") setState("idle", "マイクをタップ");
  } else if (state !== "idle") {
    keepScreenOn();
  }
});

els.textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  keepScreenOn();
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

els.resetBtn.addEventListener("click", () => {
  currentRequest?.abort();
  stopSpeaking();
  agent.resetConversation(); // メモとタスクは消えない
  els.logBody.innerHTML = "";
  els.youText.textContent = "";
  els.hayatoText.textContent = "";
  setState("idle", "新しい会話を始めました");
});

// 設定ダイアログ
els.apiKey.value = settings.apiKey;
els.callName.value = settings.callName;
els.effort.value = settings.effort;
els.rate.value = settings.rate; els.rateOut.textContent = settings.rate;
els.pitch.value = settings.pitch; els.pitchOut.textContent = settings.pitch;
els.settingsBtn.addEventListener("click", () => { refreshMemoryCount(); els.settings.showModal(); });
els.settings.addEventListener("close", () => {
  settings.apiKey = els.apiKey.value.trim();
  settings.callName = els.callName.value.trim();
  settings.effort = els.effort.value;
  store.set("apiKey", settings.apiKey);
  store.set("callName", settings.callName);
  store.set("effort", settings.effort);
  applyAgentSettings();
  if (settings.apiKey && state === "error") setState("idle", "マイクをタップ");
});
els.voiceSelect.addEventListener("change", () => store.set("voiceURI", els.voiceSelect.value));
els.rate.addEventListener("input", () => { els.rateOut.textContent = els.rate.value; store.set("rate", Number(els.rate.value)); });
els.pitch.addEventListener("input", () => { els.pitchOut.textContent = els.pitch.value; store.set("pitch", Number(els.pitch.value)); });
els.testVoice.addEventListener("click", () => {
  unlockAudio();
  stopSpeaking();
  enqueueSpeech("準備はばっちりです。いつでもお任せください！", "fired");
});

// メモとタスクのバックアップ（機種変更や、万一消えたときのため）
function refreshMemoryCount() {
  const m = agent.loadMemory();
  els.memoryCount.textContent = `メモ ${m.notes.length}件・タスク ${m.tasks.filter((t) => !t.done).length}件`;
}
els.exportBtn.addEventListener("click", async () => {
  const json = JSON.stringify(agent.loadMemory(), null, 2);
  const file = new File([json], `hayato-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
  try {
    // iPhone では共有シートが開き、「ファイルに保存」でiCloud Driveなどに保存できる
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});
els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;
  try {
    agent.importMemory(JSON.parse(await file.text()));
    refreshMemoryCount();
    alert("バックアップを読み込みました");
  } catch {
    alert("読み込めませんでした。ハヤトのバックアップファイルか確認してください");
  }
});

// 起動時のあいさつ（表示だけ。iPhoneは画面を触るまで声を出せない）
function greeting() {
  const h = new Date().getHours();
  const name = settings.callName ? `${settings.callName}、` : "";
  if (h < 5) return `${name}夜遅くまでお疲れ様です。お付き合いしますよ。`;
  if (h < 11) return `${name}おはようございます！ 今日もよろしくお願いします。`;
  if (h < 18) return `${name}こんにちは！ 何からお手伝いしましょう？`;
  return `${name}お疲れ様です！ 今日はどんな一日でしたか？`;
}
els.hayatoText.textContent = greeting();
hayato.setExpression("bow");
setTimeout(() => { if (state === "idle") hayato.setExpression("smile"); }, 1600);
setTimeout(() => { if (state === "idle") hayato.setExpression("neutral"); }, 5000);

// 初回: APIキーが無ければ設定を開く
if (!settings.apiKey) {
  setState("idle", "まず設定");
  els.hayatoText.textContent = "はじめまして、ハヤトです！ 右上の設定でClaudeのAPIキーを入れてください。それで僕が動けるようになります。";
  refreshMemoryCount();
  els.settings.showModal();
}

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
