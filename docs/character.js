// ハヤトの立ち絵アニメーション。
// 持ち主が用意したイラストを表情ごとに切り抜いた画像（docs/hayato/*.webp）を、
// WebGL で細かいメッシュに分けて変形させ、Live2D のように動かす。
//  - 体: 呼吸・頭のゆれ・うなずき（首を軸に頭だけ回す）
//  - 口パク: 口が開いた絵は口のまわりを上下に伸び縮みさせる。閉じた口の絵は肌色で隠して、同じタッチの口を描く
//  - まばたき: 目を肌色で隠して、閉じた目の線を描く
// 使い方: const hayato = createCharacter(container); hayato.setExpression("smile"); hayato.setTalking(true);

const INK = "#2b2a2e";

// 各画像の情報（画像のピクセル座標）
//  w,h: 大きさ / cx,cy: 顔の中心 / s: 頭の大きさをそろえる倍率 / neck: 首（頭を回す軸）の y
//  eyes: 開いている目の範囲 [x1,y1,x2,y2] / mouth: 口の中心と大きさ、open=口が開いた絵か
const SPRITES = {
  neutral:   { w: 230, h: 290, cx: 125, cy: 135, s: 0.83, neck: 203, eyes: [[82, 132, 110, 160], [148, 132, 177, 160]], mouth: { x: 131, y: 179, w: 42, h: 8, open: false } },
  smile:     { w: 190, h: 250, cx: 90,  cy: 135, s: 1,    neck: 198, eyes: [], mouth: { x: 95, y: 169, w: 56, h: 22, open: true } },
  excited:   { w: 252, h: 290, cx: 145, cy: 135, s: 0.86, neck: 212, eyes: [[90, 134, 119, 168], [159, 131, 195, 168]], mouth: { x: 148, y: 181, w: 33, h: 22, open: true } },
  fired:     { w: 217, h: 249, cx: 125, cy: 130, s: 1.03, neck: 188, eyes: [[78, 120, 102, 142], [138, 120, 163, 140]], mouth: { x: 134, y: 162, w: 36, h: 7, open: false } },
  idea:      { w: 262, h: 290, cx: 155, cy: 135, s: 0.88, neck: 212, eyes: [[98, 133, 135, 167]], mouth: { x: 157, y: 184, w: 42, h: 22, open: true } },
  convinced: { w: 180, h: 250, cx: 90,  cy: 134, s: 1.05, neck: 186, eyes: [], mouth: { x: 87, y: 160, w: 34, h: 6, open: false } },
  surprised: { w: 222, h: 215, cx: 105, cy: 110, s: 1,    neck: 176, eyes: [[55, 105, 85, 137], [118, 105, 148, 137]], mouth: { x: 104, y: 152, w: 15, h: 15, open: true } },
  worried:   { w: 200, h: 215, cx: 100, cy: 115, s: 1,    neck: 176, eyes: [[52, 118, 77, 138], [108, 115, 137, 138]], mouth: { x: 93, y: 156, w: 17, h: 7, open: false } },
  please:    { w: 166, h: 208, cx: 85,  cy: 110, s: 1,    neck: 170, eyes: [[35, 103, 67, 133], [98, 103, 130, 133]], mouth: { x: 84, y: 151, w: 28, h: 12, open: true } },
  error:     { w: 238, h: 258, cx: 125, cy: 135, s: 1,    neck: 214, eyes: [], mouth: { x: 123, y: 192, w: 27, h: 10, open: true } },
  panic:     { w: 237, h: 280, cx: 115, cy: 115, s: 1,    neck: 182, eyes: [], mouth: { x: 117, y: 153, w: 35, h: 14, open: true } },
  relieved:  { w: 228, h: 212, cx: 110, cy: 110, s: 1,    neck: 172, eyes: [], mouth: { x: 116, y: 147, w: 33, h: 11, open: true } },
  bow:       { w: 178, h: 290, cx: 95,  cy: 105, s: 1,    neck: 176, eyes: [], mouth: { x: 105, y: 151, w: 30, h: 7, open: false } },
};

// Claude やアプリが使う表情名 → 使う画像と、頭の傾き（度）
const EXPRESSIONS = {
  neutral:   { sprite: "neutral", tilt: 0 },
  listening: { sprite: "neutral", tilt: 3.5 },
  smile:     { sprite: "smile", tilt: -2 },
  excited:   { sprite: "excited", tilt: 2 },
  fired:     { sprite: "fired", tilt: 0 },
  thinking:  { sprite: "fired", tilt: 3 },
  idea:      { sprite: "idea", tilt: 2 },
  convinced: { sprite: "convinced", tilt: -2 },
  surprised: { sprite: "surprised", tilt: 0 },
  worried:   { sprite: "worried", tilt: -3 },
  sad:       { sprite: "worried", tilt: -5 },
  please:    { sprite: "please", tilt: 2 },
  error:     { sprite: "error", tilt: -2 },
  panic:     { sprite: "panic", tilt: 0 },
  relieved:  { sprite: "relieved", tilt: -2 },
  bow:       { sprite: "bow", tilt: 0 },
};
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

// 表示エリア（画像のピクセル単位）。顔の中心をここにそろえる
const STAGE = { w: 300, h: 300, faceX: 150, faceY: 138 };
const GRID = 72; // メッシュの細かさ（縦横の分割数）

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 目や口のまわりの肌の色を拾う（隠すときに使う）。周囲の輪の上の点から、肌らしい色の中央値をとる */
function makeSkinSampler(img, s) {
  const c = document.createElement("canvas");
  c.width = s.w; c.height = s.h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, s.w, s.h).data;
  return (cx, cy, rx, ry) => {
    const cols = [];
    for (const k of [1.3, 1.5, 1.75]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * rx * k), y = Math.round(cy + Math.sin(a) * ry * k);
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const o = (y * s.w + x) * 4;
        const [r, gg, b, al] = [data[o], data[o + 1], data[o + 2], data[o + 3]];
        // 肌らしい色だけ（線・髪・ほっぺの赤み・白目は除く）
        if (al > 240 && r > 215 && gg > 180 && b > 150 && r - gg < 40 && r - b > 15) cols.push([r, gg, b]);
      }
    }
    if (!cols.length) return "rgb(252,228,212)";
    const med = (i) => cols.map((c) => c[i]).sort((a, b) => a - b)[cols.length >> 1];
    return `rgb(${med(0)},${med(1)},${med(2)})`;
  };
}

/** 縁をぼかした楕円で塗る（貼り付けた跡が目立たないように） */
function softEllipse(g, cx, cy, rx, ry, color) {
  g.save();
  g.fillStyle = color;
  for (let i = 3; i >= 0; i--) {
    g.globalAlpha = i === 0 ? 1 : 0.22;
    g.beginPath();
    g.ellipse(cx, cy, rx + i * 1.1, ry + i * 1.1, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// ---- 目と口の描き足し（元の絵と同じ太い線のタッチ） ----
function drawLid(g, eye, amount, skin) {
  // amount: 0=開いている, 1=閉じている
  if (amount <= 0) return;
  const [x1, y1, x2, y2] = eye;
  const w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  if (amount >= 1) {
    softEllipse(g, cx, cy, w / 2 + 4.5, h / 2 + 4, skin);
    // 閉じた目: 下向きのゆるい弧＋目じりのまつげ
    const y = y1 + h * 0.6;
    g.strokeStyle = INK;
    g.lineCap = "round";
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(x1, y - 3);
    g.quadraticCurveTo(cx, y + h * 0.26, x2, y - 3);
    g.stroke();
    return;
  }
  // 半分閉じ: 上半分を肌で隠し、まぶたの線を下ろす
  const lidY = y1 - 2 + (h + 4) * amount;
  g.save();
  g.beginPath();
  g.rect(x1 - 6, y1 - 8, w + 12, lidY - y1 + 8);
  g.clip();
  softEllipse(g, cx, cy, w / 2 + 4.5, h / 2 + 4, skin);
  g.restore();
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineWidth = 3.6;
  g.beginPath();
  g.moveTo(x1 - 1, lidY + 1);
  g.quadraticCurveTo(cx, lidY - 2.5, x2 + 1, lidY + 1);
  g.stroke();
}

function drawTalkMouth(g, m, level, skin) {
  // level: 1=小さく開く 2=中くらい 3=大きく
  const w = m.w;
  softEllipse(g, m.x, m.y, w / 2 + 3, Math.max(m.h, 6) / 2 + 3.5, skin);
  const mw = Math.max(9, w * [0, 0.42, 0.55, 0.62][level]);
  const mh = Math.min([0, 5, 9, 13][level], mw * [0, 0.45, 0.62, 0.75][level]);
  const top = m.y - mh * 0.35;
  g.beginPath();
  g.moveTo(m.x - mw / 2, top);
  g.quadraticCurveTo(m.x, top - 1.5, m.x + mw / 2, top);
  g.quadraticCurveTo(m.x + mw / 2, top + mh, m.x, top + mh);
  g.quadraticCurveTo(m.x - mw / 2, top + mh, m.x - mw / 2, top);
  g.closePath();
  g.fillStyle = "#c8504d";
  g.fill();
  if (level >= 2) {
    g.save();
    g.clip();
    g.fillStyle = "#f19a92";
    g.beginPath();
    g.ellipse(m.x, top + mh, mw * 0.32, mh * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.strokeStyle = INK;
  g.lineWidth = 2.4;
  g.lineJoin = "round";
  g.stroke();
}

// ---- WebGL ----
const VS = `
attribute vec2 aUV;
uniform vec2 uSize;        // 画像の大きさ(px)
uniform vec4 uPlace;       // 配置: x, y, 倍率, 0（ステージ座標）
uniform vec2 uStage;
uniform vec2 uNeck;        // 首の位置(px)
uniform float uHeadRot;    // 頭の回転(rad)
uniform float uBreath;     // 呼吸(0..1)
uniform vec2 uBob;         // 全体の上下(px)
uniform float uPop;        // 表情切り替え時の弾み
uniform vec4 uMouth;       // 口 x, y, 半幅, 半高（px）
uniform float uJaw;        // 口の開き（伸ばす量）
varying vec2 vUV;
void main() {
  vec2 p = aUV * uSize;
  // 口のまわりを上下に伸ばす（口が開いた絵の口パク）
  vec2 dm = (p - uMouth.xy) / vec2(uMouth.z * 1.6, uMouth.w * 3.0 + 6.0);
  float fm = clamp(1.0 - dot(dm, dm), 0.0, 1.0);
  p.y += (p.y - uMouth.y) * uJaw * fm * fm;
  // 首から上を回す（首の近くはなめらかに減らす）
  float head = smoothstep(uNeck.y + 22.0, uNeck.y - 14.0, p.y);
  float a = uHeadRot * head;
  vec2 q = p - uNeck;
  p = uNeck + vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  // 呼吸: 肩から下を少し広げ、頭を少し持ち上げる
  float body = smoothstep(uNeck.y - 10.0, uSize.y, p.y);
  p.x = uNeck.x + (p.x - uNeck.x) * (1.0 + 0.012 * uBreath * body);
  p.y -= 2.2 * uBreath * (1.0 - body);
  // 弾み（顔の中心を軸に拡大）
  p = uNeck + (p - uNeck) * (1.0 + uPop);
  vec2 s = uPlace.xy + p * uPlace.z + uBob;
  vec2 clip = (s / uStage) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUV = aUV;
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uTex, vUV);
  // 切り抜きの端をぼかす（左右と下）
  float edge = smoothstep(0.0, 0.07, vUV.x) * smoothstep(1.0, 0.93, vUV.x) * smoothstep(1.0, 0.8, vUV.y);
  gl_FragColor = c * edge;
}`;

function makeGL(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  // 格子状のメッシュ
  const uv = [];
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) uv.push(i / GRID, j / GRID);
  const idx = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aUV");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const u = {};
  for (const n of ["uSize", "uPlace", "uStage", "uNeck", "uHeadRot", "uBreath", "uBob", "uPop", "uMouth", "uJaw", "uTex"]) {
    u[n] = gl.getUniformLocation(prog, n);
  }
  return { gl, u, count: idx.length };
}

export function createCharacter(container) {
  const root = document.createElement("div");
  root.className = "hayato-figure";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "ハヤト");
  const canvas = document.createElement("canvas");
  root.append(canvas);
  container.append(root);

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const comp = document.createElement("canvas"); // 目・口を描き足した今の絵
  const cg = comp.getContext("2d");
  let glx = null;
  try { glx = makeGL(canvas); } catch (err) { console.warn("WebGL が使えないため簡易表示にします", err); }
  const g2 = glx ? null : canvas.getContext("2d");

  const images = {};
  const skins = {}; // 画像ごとに { eyes: [色...], mouth: 色 }
  let ready = false;
  Promise.all(Object.keys(SPRITES).map(async (name) => {
    images[name] = await loadImage(`hayato/${name}.webp`);
    const s = SPRITES[name], sample = makeSkinSampler(images[name], s);
    skins[name] = {
      eyes: s.eyes.map(([x1, y1, x2, y2]) => sample((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2)),
      mouth: sample(s.mouth.x, s.mouth.y, s.mouth.w / 2, Math.max(s.mouth.h, 6) / 2),
    };
  })).then(() => { ready = true; dirty = true; }).catch((err) => console.error("立ち絵を読み込めませんでした", err));

  // ---- 状態 ----
  let current = "neutral";
  let talking = false;
  let lid = 0;            // まばたき 0..1
  let talkLevel = 0;      // 閉じた口の絵の口パク段階 0..3
  let jaw = 0;            // 開いた口の絵の伸び
  let dirty = true;       // 描き足しを作り直す必要があるか
  let tilt = 0, tiltTarget = 0;
  let popStart = -1;
  let talkEnv = 0;        // 話している度合い（なめらかに変化）
  let frozen = false, frozenJaw = null; // テスト用

  function setExpression(name) {
    if (!EXPRESSIONS[name] || name === current) return;
    const changed = EXPRESSIONS[name].sprite !== EXPRESSIONS[current].sprite;
    current = name;
    tiltTarget = EXPRESSIONS[name].tilt;
    if (changed) { popStart = performance.now(); lid = 0; talkLevel = 0; dirty = true; }
  }
  function setTalking(on) { talking = on; }

  // まばたき（2〜6秒ごと。たまに2回）
  function blink(twice) {
    const frames = [0.5, 1, 1, 0.5, 0];
    frames.forEach((v, i) => setTimeout(() => { lid = v; dirty = true; }, i * 45));
    if (twice) setTimeout(() => blink(false), 320);
  }
  (function scheduleBlink() {
    setTimeout(() => { if (!document.hidden && !reduceMotion && !frozen) blink(Math.random() < 0.2); scheduleBlink(); }, 2000 + Math.random() * 4000);
  })();

  // 口パク: 話している間、音節のようなリズムで開け閉めする
  let nextSyllable = 0, syllableTarget = 0;
  function updateMouth(now, s) {
    if (talking) {
      if (now > nextSyllable) {
        syllableTarget = Math.random() < 0.18 ? 0 : 0.35 + Math.random() * 0.65;
        nextSyllable = now + 70 + Math.random() * 90;
      }
    } else {
      syllableTarget = 0;
    }
    jaw += (syllableTarget - jaw) * 0.45;
    if (frozenJaw !== null) jaw = frozenJaw;
    if (!s.mouth.open) {
      const level = jaw < 0.15 ? 0 : jaw < 0.45 ? 1 : jaw < 0.75 ? 2 : 3;
      if (level !== talkLevel) { talkLevel = level; dirty = true; }
    }
  }

  function compose(name) {
    const s = SPRITES[name];
    if (comp.width !== s.w || comp.height !== s.h) { comp.width = s.w; comp.height = s.h; }
    cg.clearRect(0, 0, s.w, s.h);
    cg.drawImage(images[name], 0, 0);
    s.eyes.forEach((eye, i) => drawLid(cg, eye, lid, skins[name].eyes[i]));
    if (!s.mouth.open && talkLevel > 0) drawTalkMouth(cg, s.mouth, talkLevel, skins[name].mouth);
    if (glx) {
      const { gl } = glx;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, comp);
    }
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  let lastSprite = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!ready || document.hidden) return;
    resize();
    const name = EXPRESSIONS[current].sprite;
    const s = SPRITES[name];
    const t = reduceMotion ? 0 : now / 1000;

    updateMouth(now, s);
    if (name !== lastSprite) { lastSprite = name; dirty = true; }
    if (dirty) { compose(name); dirty = false; }

    talkEnv += ((talking ? 1 : 0) - talkEnv) * 0.08;
    tilt += (tiltTarget - tilt) * 0.08;
    const deg = Math.PI / 180;
    const sway = reduceMotion ? 0 : (Math.sin(t * 2 * Math.PI / 6.5) * 1.3 + Math.sin(t * 2 * Math.PI / 2.9 + 1.3) * 0.5);
    const nod = Math.sin(t * 2 * Math.PI * 1.9) * 1.6 * talkEnv;
    const headRot = (tilt + sway + nod) * deg;
    const breath = reduceMotion ? 0 : (Math.sin(t * 2 * Math.PI / 4.2) + 1) / 2;
    const bob = -Math.abs(Math.sin(t * Math.PI * 3.8)) * 2.2 * talkEnv;
    let pop = 0;
    if (popStart >= 0) {
      const k = (now - popStart) / 380;
      if (k >= 1) popStart = -1; else pop = Math.sin(k * Math.PI) * 0.05 * (1 - k * 0.5) - (k < 0.15 ? 0.03 * (1 - k / 0.15) : 0);
    }
    const jawAmount = s.mouth.open ? -0.3 + jaw * 0.9 : 0;

    const scale = s.s;
    const placeX = STAGE.faceX - s.cx * scale;
    const placeY = STAGE.faceY - s.cy * scale;

    if (glx) {
      const { gl, u, count } = glx;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uSize, s.w, s.h);
      gl.uniform4f(u.uPlace, placeX, placeY, scale, 0);
      gl.uniform2f(u.uStage, STAGE.w, STAGE.h);
      gl.uniform2f(u.uNeck, s.cx, s.neck);
      gl.uniform1f(u.uHeadRot, headRot);
      gl.uniform1f(u.uBreath, breath);
      gl.uniform2f(u.uBob, 0, bob);
      gl.uniform1f(u.uPop, pop);
      gl.uniform4f(u.uMouth, s.mouth.x, s.mouth.y, s.mouth.w / 2, s.mouth.h / 2);
      gl.uniform1f(u.uJaw, jawAmount);
      gl.uniform1i(u.uTex, 0);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    } else if (g2) {
      // WebGL が無い端末: 変形なしで、回転と弾みだけ
      const k = canvas.width / STAGE.w;
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.clearRect(0, 0, canvas.width, canvas.height);
      g2.setTransform(k, 0, 0, k, 0, 0);
      g2.translate(placeX + s.cx * scale, placeY + s.neck * scale + bob);
      g2.rotate(headRot * 0.5);
      g2.scale(scale * (1 + pop), scale * (1 + pop));
      g2.drawImage(comp, -s.cx, -s.neck);
    }
  }
  requestAnimationFrame(frame);

  // テスト用: まばたき・口の開きを固定して確認する
  function debugPose({ lid: l, jaw: j } = {}) {
    frozen = true;
    if (l !== undefined) { lid = l; dirty = true; }
    frozenJaw = j ?? null;
  }

  return { setExpression, setTalking, debugPose, get expression() { return current; } };
}
