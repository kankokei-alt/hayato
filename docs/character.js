// ハヤトの立ち絵（SVG）。デフォルメ等身・太い輪郭線・グレーのスーツ・光るヘッドセット。
// 表情・まばたき・口パク・呼吸を動かす。
// 使い方: const hayato = createCharacter(container); hayato.setExpression("smile"); hayato.setTalking(true);

const SVG_NS = "http://www.w3.org/2000/svg";
const INK = "#2b2a31"; // 輪郭線の色

// ---- 表情ごとの部品 ----
// eyes: open（通常）/ narrow（真剣）/ wide（見開き）/ teary（うるうる）/ happy（^ ^）/ closed
// eyes は両目共通の文字列か、[左目, 右目]（画面上の左右）
// pose: "bow" はお辞儀（頭を下げる）
const EXPRESSIONS = {
  neutral:   { brows: "normal",  eyes: "open",          mouth: "smile_small", look: [0, 0],  tilt: 0,  blush: 0.55, extra: null },
  smile:     { brows: "up",      eyes: "happy",         mouth: "grin",        look: [0, 0],  tilt: -3, blush: 0.9,  extra: "sparkle" },
  excited:   { brows: "up",      eyes: "wide",          mouth: "open_happy",  look: [0, -1], tilt: 3,  blush: 0.9,  extra: "sparkle" },
  fired:     { brows: "fierce",  eyes: "narrow",        mouth: "smirk",       look: [0, 1],  tilt: -2, blush: 0.4,  extra: "signal" },
  idea:      { brows: "up",      eyes: ["open", "happy"], mouth: "open_happy", look: [0, -1], tilt: 4, blush: 0.9,  extra: "idea" },
  thinking:  { brows: "think",   eyes: "open",          mouth: "flat",        look: [6, -6], tilt: 5,  blush: 0.4,  extra: "dots" },
  convinced: { brows: "relaxed", eyes: "closed",        mouth: "smile_small", look: [0, 0],  tilt: -6, blush: 0.5,  extra: "convinced" },
  surprised: { brows: "high",    eyes: "wide",          mouth: "o",           look: [0, 0],  tilt: 0,  blush: 0.4,  extra: "bang" },
  worried:   { brows: "worried", eyes: "teary",         mouth: "wavy",        look: [-2, 3], tilt: -4, blush: 0.4,  extra: "confused" },
  please:    { brows: "worried", eyes: "teary",         mouth: "small_open",  look: [0, -3], tilt: 0,  blush: 0.7,  extra: "please" },
  sad:       { brows: "worried", eyes: "teary",         mouth: "frown",       look: [0, 4],  tilt: -5, blush: 0.3,  extra: "tear" },
  error:     { brows: "worried", eyes: ["x", "swirl"],  mouth: "wavy",        look: [0, 0],  tilt: -7, blush: 0.3,  extra: "error" },
  panic:     { brows: "worried", eyes: ["x", "swirl"],  mouth: "distress",    look: [0, 0],  tilt: 4,  blush: 0,    extra: "panic" },
  relieved:  { brows: "relaxed", eyes: "closed",        mouth: "relaxed",     look: [0, 0],  tilt: -3, blush: 0.6,  extra: "relieved" },
  bow:       { brows: "relaxed", eyes: "closed",        mouth: "smile_small", look: [0, 0],  tilt: 0,  blush: 0.6,  extra: "bow", pose: "bow" },
  listening: { brows: "up",      eyes: "open",          mouth: "smile_small", look: [0, 0],  tilt: 4,  blush: 0.6,  extra: "signal" },
};
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

// 眉（左眉。右は鏡写し）
const BROWS = {
  normal:  "M140 200 Q157 192 176 197",
  up:      "M140 195 Q157 185 176 191",
  high:    "M141 187 Q158 176 175 184",
  fierce:  "M139 194 Q159 197 179 207",
  worried: "M141 205 Q160 199 177 189",
  think:   "M140 197 Q157 190 176 199",
  relaxed: "M141 201 Q158 195 176 200",
};

// 口（中心 x=200）
const MOUTHS = {
  smile_small: { d: "M187 297 Q200 306 213 297", fill: false },
  grin:        { d: "M174 289 Q200 291 226 289 Q222 320 200 322 Q178 320 174 289 Z", fill: true, teeth: true, tongue: true },
  open_happy:  { d: "M178 290 Q200 291 222 290 Q218 316 200 318 Q182 316 178 290 Z", fill: true, tongue: true },
  smirk:       { d: "M186 300 Q201 305 216 293", fill: false },
  flat:        { d: "M191 300 L209 299", fill: false },
  o:           { d: "M200 292 Q209 292 209 302 Q209 312 200 312 Q191 312 191 302 Q191 292 200 292 Z", fill: true },
  wavy:        { d: "M186 304 Q193 297 200 303 Q207 309 214 302", fill: false },
  frown:       { d: "M188 306 Q200 296 212 306", fill: false },
  distress:    { d: "M180 298 Q200 288 220 298 Q223 320 200 322 Q177 320 180 298 Z", fill: true, teeth: true },
  small_open:  { d: "M191 298 Q200 295 209 298 Q209 309 200 310 Q191 309 191 298 Z", fill: true },
  relaxed:     { d: "M181 295 Q200 310 219 295", fill: false },
  // 口パク用
  talk_a:      { d: "M182 292 Q200 292 218 292 Q215 316 200 317 Q185 316 182 292 Z", fill: true, tongue: true },
  talk_i:      { d: "M180 293 Q200 296 220 293 Q214 306 200 307 Q186 306 180 293 Z", fill: true, teeth: true },
  talk_o:      { d: "M200 292 Q209 292 209 301 Q209 310 200 310 Q191 310 191 301 Q191 292 200 292 Z", fill: true },
  talk_e:      { d: "M183 293 Q200 293 217 293 Q213 308 200 309 Q187 308 183 293 Z", fill: true },
};
const TALK_SHAPES = ["talk_a", "talk_i", "talk_o", "talk_e", "talk_a", "smile_small"];

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

/** 左目（右目は鏡写しで使う）。中心はおよそ (160, 238) */
function drawEye(parent, id) {
  const g = el("g", { class: "eye", id }, parent);
  const open = el("g", { class: "eye-open" }, g);
  el("path", { class: "sclera", d: "M138 238 Q138 211 160 209 Q182 211 182 238 Q181 264 160 265 Q139 264 138 238 Z" }, open);
  const iris = el("g", { class: "iris" }, open);
  el("ellipse", { cx: 160, cy: 240, rx: 15.5, ry: 19.5, fill: "url(#irisGrad)", stroke: INK, "stroke-width": 1.5 }, iris);
  el("ellipse", { cx: 160, cy: 243, rx: 7.5, ry: 9.5, fill: "#16263f" }, iris);
  el("ellipse", { cx: 153.5, cy: 229.5, rx: 6, ry: 7, fill: "#fff" }, iris);
  el("circle", { cx: 167, cy: 251, r: 3, fill: "#fff", opacity: 0.9 }, iris);
  // 涙目のときのうるうるハイライト
  el("ellipse", { class: "teary-shine", cx: 160, cy: 256, rx: 11, ry: 3.2, fill: "#dff4ff", opacity: 0.9 }, iris);
  // 上まぶた（太い線）
  el("path", { class: "lid", d: "M135 233 Q139 206 161 204 Q182 205 187 226" }, open);
  el("path", { class: "lash", d: "M136 229 L130 225" }, open);
  // 閉じた目・笑い目
  el("path", { class: "eye-closed", d: "M139 240 Q160 251 182 240" }, g);
  el("path", { class: "eye-happy", d: "M139 245 Q160 220 182 245" }, g);
  // ガーン・パニック用の × と ぐるぐる
  el("path", { class: "eye-x", d: "M145 224 L176 253 M176 224 L145 253" }, g);
  el("path", { class: "eye-swirl", d: "M160 238 m-2 0 a2 2 0 1 1 4 0 a5 5 0 0 1 -10 0 a8 8 0 0 1 16 0 a11 11 0 0 1 -22 0 a14 14 0 0 1 28 0 a17 17 0 0 1 -34 0" }, g);
  return g;
}

export function createCharacter(container) {
  const svg = el("svg", { viewBox: "0 0 400 500", class: "hayato", role: "img", "aria-label": "ハヤト" });

  const defs = el("defs", {}, svg);
  defs.innerHTML = `
    <radialGradient id="irisGrad" cx=".5" cy=".3" r=".8">
      <stop offset="0" stop-color="#cfeaff"/><stop offset=".45" stop-color="#7fb6e2"/><stop offset="1" stop-color="#2f5f93"/>
    </radialGradient>
    <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#45434d"/><stop offset="1" stop-color="#2a2930"/>
    </linearGradient>
    <linearGradient id="suitGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#77797f"/><stop offset="1" stop-color="#55575e"/>
    </linearGradient>
    <linearGradient id="cupGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eaf7ff"/><stop offset="1" stop-color="#a9d8f5"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;

  const body = el("g", { class: "body" }, svg);

  // ================= 体（スーツ） =================
  const torso = el("g", { class: "torso" }, body);
  el("path", { class: "ol", d: "M178 322 L222 322 L224 356 L176 356 Z", fill: "#f6d3bd" }, torso); // 首
  // ジャケット
  el("path", { class: "ol", d: "M64 500 Q66 410 124 378 Q156 362 180 352 L200 386 L220 352 Q244 362 276 378 Q334 410 336 500 Z", fill: "url(#suitGrad)" }, torso);
  // シャツ
  el("path", { class: "ol", d: "M180 352 L200 386 L220 352 L214 346 L186 346 Z", fill: "#fbfbfd" }, torso);
  el("path", { class: "ol", d: "M186 346 L200 362 L214 346", fill: "#fbfbfd" }, torso);
  // ネクタイ
  el("path", { class: "ol", d: "M193 360 L207 360 L205 373 L195 373 Z", fill: "#2f416e" }, torso);
  el("path", { class: "ol", d: "M195 373 L205 373 L212 440 L200 454 L188 440 Z", fill: "#2f416e" }, torso);
  el("path", { d: "M197 392 L207 386 M195 410 L209 402 M193 428 L210 420", stroke: "#4a5f92", "stroke-width": 2.5, "stroke-linecap": "round" }, torso);
  // 襟（ラペル）
  el("path", { class: "ol", d: "M180 352 L160 366 L176 396 L166 404 L192 458 L200 386 Z", fill: "#64666d" }, torso);
  el("path", { class: "ol", d: "M220 352 L240 366 L224 396 L234 404 L208 458 L200 386 Z", fill: "#64666d" }, torso);
  // 腕の付け根の影
  el("path", { d: "M104 500 Q102 446 122 412 M296 500 Q298 446 278 412", fill: "none", stroke: INK, "stroke-width": 3, "stroke-linecap": "round", opacity: ".55" }, torso);
  // 回路模様の光るライン
  const circuits = el("g", { class: "circuit", filter: "url(#glow)" }, torso);
  el("path", { d: "M84 470 L96 440 L118 418 L142 404 M110 478 L118 452 L134 440" }, circuits);
  el("path", { d: "M316 470 L304 440 L282 418 L258 404 M290 478 L282 452 L266 440" }, circuits);
  el("path", { d: "M228 470 L244 458 L262 458 M172 470 L156 458 L138 458" }, circuits);
  for (const [cx, cy] of [[142, 404], [134, 440], [258, 404], [266, 440], [262, 458], [138, 458]]) el("circle", { cx, cy, r: 3.2 }, circuits);
  // ボタン
  el("circle", { class: "ol", cx: 200, cy: 476, r: 6, fill: "#b8945a" }, torso);

  // ================= 頭 =================
  const head = el("g", { class: "head" }, body);

  // 後ろ髪
  el("path", { class: "ol", d: "M84 256 Q58 176 92 112 Q132 50 206 46 Q284 48 318 110 Q346 176 318 256 Q302 206 292 176 L110 176 Q98 206 84 256 Z", fill: "url(#hairGrad)" }, head);

  // 顔
  const FACE_D = "M110 196 Q106 266 140 306 Q170 336 200 338 Q230 336 260 306 Q294 266 290 196 Q282 122 200 118 Q118 122 110 196 Z";
  el("path", { class: "ol face", d: FACE_D, fill: "#fde4d3" }, head);
  el("path", { d: FACE_D }, el("clipPath", { id: "faceClip" }, defs));

  // 頬の赤み
  const blush = el("g", { class: "blush" }, head);
  el("ellipse", { cx: 137, cy: 276, rx: 16, ry: 9, fill: "#ffb3b3" }, blush);
  el("ellipse", { cx: 263, cy: 276, rx: 16, ry: 9, fill: "#ffb3b3" }, blush);

  // パニック時の顔の青ざめ
  defs.insertAdjacentHTML("beforeend", `<linearGradient id="paleGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a7cff" stop-opacity=".75"/><stop offset=".55" stop-color="#7d9cff" stop-opacity=".4"/><stop offset="1" stop-color="#7d9cff" stop-opacity="0"/></linearGradient>`);
  el("rect", { class: "fx-pale", x: 100, y: 110, width: 200, height: 170, fill: "url(#paleGrad)", "clip-path": "url(#faceClip)" }, head);

  // 目
  const eyes = el("g", { class: "eyes" }, head);
  const eyeL = drawEye(eyes, "eyeL");
  const eyeR = drawEye(eyes, "eyeR");
  eyeR.setAttribute("transform", "translate(400 0) scale(-1 1)");

  // 鼻
  el("path", { d: "M199 268 Q202 274 198 277", fill: "none", stroke: "#d9a58c", "stroke-width": 2.5, "stroke-linecap": "round" }, head);

  // 口
  const mouthG = el("g", { class: "mouth" }, head);
  const mouthInner = el("path", { class: "mouth-inner", d: MOUTHS.smile_small.d }, mouthG);
  const tongue = el("ellipse", { class: "tongue", cx: 200, cy: 312, rx: 11, ry: 5.5 }, mouthG);
  const teeth = el("path", { class: "teeth", d: "M176 290 L224 290 L222 298 L178 298 Z" }, mouthG);
  const mouthLine = el("path", { class: "mouth-line", d: MOUTHS.smile_small.d }, mouthG);
  // 口の中は輪郭の内側だけに見えるよう切り抜く
  const clip = el("clipPath", { id: "mouthClip" }, defs);
  const clipPath = el("path", { d: MOUTHS.smile_small.d }, clip);
  tongue.setAttribute("clip-path", "url(#mouthClip)");
  teeth.setAttribute("clip-path", "url(#mouthClip)");

  // 前髪（ツンツン）
  const bangs = el("g", { class: "bangs" }, head);
  el("path", {
    class: "ol",
    d: "M102 216 Q92 128 150 94 Q206 62 266 88 Q320 114 302 216 Q296 190 286 176 Q288 196 280 210 Q270 170 250 152 Q256 172 248 190 Q232 152 208 140 Q214 160 204 178 Q186 146 160 140 Q172 158 164 176 Q148 152 128 160 Q136 178 126 200 Q118 186 102 216 Z",
    fill: "url(#hairGrad)",
  }, bangs);
  // 上に跳ねる毛
  el("path", { class: "ol", d: "M146 104 Q132 58 168 38 Q164 70 182 88 Z", fill: "#3c3a44" }, bangs);
  el("path", { class: "ol", d: "M200 80 Q214 32 254 24 Q234 54 240 86 Z", fill: "#3c3a44" }, bangs);
  el("path", { class: "ol", d: "M262 96 Q296 70 332 80 Q304 90 296 120 Z", fill: "#3c3a44" }, bangs);
  el("path", { class: "ol", d: "M118 124 Q86 104 70 118 Q96 118 108 142 Z", fill: "#3c3a44" }, bangs);
  // ツヤ
  el("path", { d: "M148 122 Q170 104 194 100 M228 104 Q252 110 270 128 M176 152 Q182 138 192 132 M226 150 Q236 138 248 138", fill: "none", stroke: "#7d8096", "stroke-width": 4, "stroke-linecap": "round", opacity: ".8" }, bangs);

  // 眉（前髪の上に描く）
  const browL = el("path", { class: "brow", d: BROWS.normal }, head);
  const browR = el("path", { class: "brow", d: BROWS.normal, transform: "translate(400 0) scale(-1 1)" }, head);

  // ヘッドセット
  const headset = el("g", { class: "headset" }, head);
  el("path", { d: "M92 214 Q84 52 200 44 Q316 52 308 214", fill: "none", stroke: INK, "stroke-width": 20, "stroke-linecap": "round" }, headset);
  el("path", { d: "M92 214 Q84 52 200 44 Q316 52 308 214", fill: "none", stroke: "#a9c3d6", "stroke-width": 12, "stroke-linecap": "round" }, headset);
  el("path", { d: "M104 140 Q120 80 180 64", fill: "none", stroke: "#e4f3ff", "stroke-width": 3, "stroke-linecap": "round" }, headset);
  for (const x of [70, 290]) {
    el("rect", { class: "ol", x, y: 184, width: 40, height: 86, rx: 19, fill: "url(#cupGrad)" }, headset);
    el("rect", { class: "headset-light", x: x + 9, y: 197, width: 22, height: 60, rx: 10, filter: "url(#glow)" }, headset);
  }
  // マイク
  el("path", { d: "M300 262 Q300 306 254 318", fill: "none", stroke: INK, "stroke-width": 9, "stroke-linecap": "round" }, headset);
  el("path", { d: "M300 262 Q300 306 254 318", fill: "none", stroke: "#a9c3d6", "stroke-width": 4.5, "stroke-linecap": "round" }, headset);
  el("rect", { class: "ol", x: 238, y: 310, width: 20, height: 14, rx: 7, fill: "#cfe6f5" }, headset);

  // お願いポーズの合わせた手（体と一緒に揺れるよう body の中に描く）
  const hands = el("g", { class: "fx-hands" }, body);
  el("path", { class: "ol", d: "M200 456 Q180 452 174 432 Q168 410 176 392 Q184 376 196 374 Q201 376 200 386 Z", fill: "#fbd9c4" }, hands);
  el("path", { class: "ol", d: "M200 456 Q220 452 226 432 Q232 410 224 392 Q216 376 204 374 Q199 376 200 386 Z", fill: "#fbd9c4" }, hands);
  el("path", { d: "M200 386 L200 454 M177 404 Q184 402 189 406 M175 420 Q182 418 188 422 M223 404 Q216 402 211 406 M225 420 Q218 418 212 422", fill: "none", stroke: "#2b2a31", "stroke-width": 2.4, "stroke-linecap": "round" }, hands);
  el("path", { class: "ol", d: "M172 452 L228 452 L232 466 L168 466 Z", fill: "#fbfbfd" }, hands);
  el("path", { class: "ol", d: "M150 500 Q154 470 168 462 L232 462 Q246 470 250 500 Z", fill: "#64666d" }, hands);

  // ================= 感情のエフェクト =================
  const fx = el("g", { class: "fx" }, svg);
  // ひらめき: 電球と星
  const idea = el("g", { class: "fx-idea" }, fx);
  el("path", { class: "ol", d: "M66 70 Q46 70 46 92 Q46 104 56 112 L58 122 L74 122 L76 112 Q86 104 86 92 Q86 70 66 70 Z", fill: "#ffe680" }, idea);
  el("path", { class: "ol", d: "M58 124 L74 124 L72 134 L60 134 Z", fill: "#c9d3df" }, idea);
  el("path", { d: "M60 96 Q66 106 72 96", fill: "none", stroke: "#e0a020", "stroke-width": 2.5 }, idea);
  el("path", { class: "rays", d: "M66 48 L66 58 M36 62 L43 69 M96 62 L89 69 M28 92 L38 92 M94 92 L104 92" }, idea);
  el("path", { class: "ol", d: "M346 178 l5 10 l11 2 l-8 8 l2 11 l-10 -5 l-10 5 l2 -11 l-8 -8 l11 -2 Z", fill: "#ffd84d" }, idea);
  // ガーン: ERROR の文字・ノイズ・!?
  const error = el("g", { class: "fx-error" }, fx);
  const errText = el("text", { x: 30, y: 78, class: "fx-errtext", transform: "rotate(-8 30 78)" }, error);
  errText.textContent = "ERROR";
  // パニック: 大きな ! とノイズ
  const panic = el("g", { class: "fx-panic" }, fx);
  el("path", { d: "M352 40 L344 104", class: "fx-ex", "stroke-width": 12 }, panic);
  el("circle", { cx: 342, cy: 124, r: 7, class: "fx-ex-dot" }, panic);
  el("path", { class: "fx-sweatdrop ol", d: "M292 124 Q304 142 298 152 Q290 158 284 150 Q282 140 292 124 Z", fill: "#a9e1ff" }, panic);
  // ノイズ（ガーン・パニック共通）
  const glitch = el("g", { class: "fx-glitch" }, fx);
  for (const [x, y, w] of [[20, 170, 60], [30, 186, 34], [14, 204, 48], [318, 160, 58], [330, 178, 40], [322, 214, 56], [40, 250, 30], [336, 250, 34]]) {
    el("rect", { x, y, width: w, height: 7, rx: 2 }, glitch);
  }
  // 納得: なるほど ＋ データ解析バー
  const convinced = el("g", { class: "fx-convinced" }, fx);
  const naruhodo = el("text", { x: 342, y: 120, class: "fx-word", "writing-mode": "tb" }, convinced);
  naruhodo.textContent = "なるほど";
  const barLabel = el("text", { x: 228, y: 30, class: "fx-small" }, convinced);
  barLabel.textContent = "データ解析";
  el("rect", { x: 300, y: 18, width: 84, height: 12, rx: 4, fill: "none", stroke: "#7fe0ff", "stroke-width": 2 }, convinced);
  el("rect", { class: "fx-bar", x: 303, y: 21, width: 78, height: 6, rx: 2 }, convinced);
  // お疲れ様: ふう ＋ コーヒー
  const relieved = el("g", { class: "fx-relieved" }, fx);
  const fuu = el("text", { x: 28, y: 250, class: "fx-word" }, relieved);
  fuu.textContent = "ふう";
  el("path", { class: "fx-sweatdrop ol", d: "M292 150 Q304 168 298 178 Q290 184 284 176 Q282 166 292 150 Z", fill: "#a9e1ff" }, relieved);
  el("path", { class: "ol", d: "M318 420 L362 420 L358 466 Q356 474 346 474 L334 474 Q324 474 322 466 Z", fill: "#f4f7fb" }, relieved);
  el("path", { class: "ol", d: "M360 430 Q376 430 374 446 Q372 458 358 456", fill: "none" }, relieved);
  el("path", { class: "steam", d: "M330 410 Q324 398 332 388 Q338 378 332 368 M346 410 Q340 396 348 386 Q354 376 348 364" }, relieved);
  // お辞儀: 動きの線
  const bowFx = el("g", { class: "fx-bow" }, fx);
  el("path", { d: "M58 230 Q46 250 58 270 M40 222 Q24 250 40 278" }, bowFx);

  const sparkle = el("g", { class: "fx-sparkle" }, fx);
  for (const [x, y, s] of [[340, 150, 1], [60, 180, 0.75], [352, 226, 0.55], [48, 120, 0.5]]) {
    el("path", { d: `M${x} ${y - 14 * s} L${x + 4 * s} ${y - 4 * s} L${x + 14 * s} ${y} L${x + 4 * s} ${y + 4 * s} L${x} ${y + 14 * s} L${x - 4 * s} ${y + 4 * s} L${x - 14 * s} ${y} L${x - 4 * s} ${y - 4 * s} Z` }, sparkle);
  }
  const signal = el("g", { class: "fx-signal" }, fx);
  el("path", { d: "M318 40 Q330 52 318 64 M330 30 Q348 52 330 74 M342 20 Q366 52 342 84" }, signal);
  const dots = el("g", { class: "fx-dots" }, fx);
  [[334, 100, 5], [350, 78, 6.5], [370, 52, 8]].forEach(([cx, cy, r]) => el("circle", { cx, cy, r }, dots));
  const bang = el("g", { class: "fx-bang" }, fx);
  el("path", { d: "M62 70 L70 112", "stroke-width": 9 }, bang);
  el("circle", { cx: 73, cy: 128, r: 5 }, bang);
  const confused = el("g", { class: "fx-confused" }, fx);
  el("path", { d: "M318 64 L322 104", class: "fx-ex" }, confused);
  el("circle", { cx: 323, cy: 118, r: 4.5, class: "fx-ex-dot" }, confused);
  el("path", { d: "M338 66 Q340 46 358 48 Q374 52 368 68 Q362 78 352 82 L352 94", class: "fx-q" }, confused);
  el("circle", { cx: 352, cy: 108, r: 4.5, class: "fx-q-dot" }, confused);
  const tear = el("g", { class: "fx-tear" }, fx);
  el("path", { d: "M134 262 Q128 276 132 284 Q138 290 143 283 Q145 274 134 262 Z" }, tear);
  el("path", { d: "M266 262 Q272 276 268 284 Q262 290 257 283 Q255 274 266 262 Z" }, tear);

  container.append(svg);

  // ---- 状態と更新 ----
  let current = "neutral";
  let talking = false;
  let blinking = false;

  function setMouth(name) {
    const m = MOUTHS[name] ?? MOUTHS.smile_small;
    mouthInner.setAttribute("d", m.d);
    mouthLine.setAttribute("d", m.d);
    clipPath.setAttribute("d", m.d);
    mouthInner.style.display = m.fill ? "" : "none";
    tongue.style.display = m.tongue ? "" : "none";
    teeth.style.display = m.teeth ? "" : "none";
  }

  function applyEyes() {
    const spec = EXPRESSIONS[current].eyes;
    const [l, r] = Array.isArray(spec) ? spec : [spec, spec];
    const blinkable = (m) => !["happy", "x", "swirl"].includes(m);
    eyeL.dataset.mode = blinking && blinkable(l) ? "closed" : l;
    eyeR.dataset.mode = blinking && blinkable(r) ? "closed" : r;
  }

  function render() {
    const ex = EXPRESSIONS[current];
    browL.setAttribute("d", BROWS[ex.brows]);
    browR.setAttribute("d", BROWS[ex.brows]);
    applyEyes();
    if (!talking) setMouth(ex.mouth);
    blush.style.opacity = String(ex.blush);
    svg.dataset.fx = ex.extra ?? "";
    const [lx, ly] = ex.look;
    for (const eye of [eyeL, eyeR]) {
      const flip = eye === eyeR ? -1 : 1; // 右目は鏡写しなので x を反転
      eye.querySelector(".iris").setAttribute("transform", `translate(${lx * flip} ${ly})`);
    }
    head.style.setProperty("--tilt", `${ex.tilt}deg`);
    svg.dataset.pose = ex.pose ?? "";
  }

  function setExpression(name) {
    if (!EXPRESSIONS[name] || name === current) return;
    current = name;
    svg.classList.remove("pop");
    void svg.getBoundingClientRect(); // アニメーションをやり直す
    svg.classList.add("pop");
    render();
  }

  // まばたき（ランダムな間隔。たまに2回）
  function blinkOnce(then) {
    blinking = true; applyEyes();
    setTimeout(() => { blinking = false; applyEyes(); then?.(); }, 120);
  }
  function scheduleBlink() {
    setTimeout(() => {
      blinkOnce(() => { if (Math.random() < 0.25) setTimeout(() => blinkOnce(), 150); });
      scheduleBlink();
    }, 2200 + Math.random() * 3800);
  }
  scheduleBlink();

  // 口パク: 話している間は口の形をランダムに切り替える
  let talkTimer = null;
  function setTalking(on) {
    if (on === talking) return;
    talking = on;
    clearInterval(talkTimer);
    if (on) {
      talkTimer = setInterval(() => setMouth(TALK_SHAPES[(Math.random() * TALK_SHAPES.length) | 0]), 95);
    }
    render();
  }

  render();
  return { setExpression, setTalking, get expression() { return current; } };
}
