// ハヤトの立ち絵（オリジナルのSVG）。表情・まばたき・口パク・呼吸を動かす。
// 使い方: const hayato = createCharacter(container); hayato.setExpression("smile"); hayato.setTalking(true);

const SVG_NS = "http://www.w3.org/2000/svg";

// ---- 表情ごとの部品（眉・目・口）の形 ----
// 目は「開き方」で表す: open（通常）, narrow（細め）, wide（見開き）, happy（^ ^ の笑い目）, closed（閉じ）
const EXPRESSIONS = {
  neutral:   { brows: "normal",  eyes: "open",   mouth: "smile_small", look: [0, 0],    tilt: 0,  blush: 0,   extra: null },
  smile:     { brows: "up",      eyes: "happy",  mouth: "grin",        look: [0, 0],    tilt: -3, blush: 0.5, extra: null },
  excited:   { brows: "up",      eyes: "wide",   mouth: "open_happy",  look: [0, -1],   tilt: 3,  blush: 0.6, extra: "sparkle" },
  fired:     { brows: "fierce",  eyes: "narrow", mouth: "grin_teeth",  look: [0, 0],    tilt: -2, blush: 0,   extra: "fire" },
  thinking:  { brows: "think",   eyes: "open",   mouth: "flat",        look: [5, -5],   tilt: 5,  blush: 0,   extra: "dots" },
  surprised: { brows: "high",    eyes: "wide",   mouth: "o",           look: [0, 0],    tilt: 0,  blush: 0,   extra: "shock" },
  worried:   { brows: "worried", eyes: "open",   mouth: "wavy",        look: [-3, 2],   tilt: -4, blush: 0,   extra: "sweat" },
  sad:       { brows: "worried", eyes: "narrow", mouth: "frown",       look: [0, 4],    tilt: -5, blush: 0,   extra: null },
  listening: { brows: "up",      eyes: "open",   mouth: "smile_small", look: [0, 0],    tilt: 4,  blush: 0,   extra: null },
};
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

// 眉（左右対称。左眉の形を書き、右は鏡写し）
const BROWS = {
  normal:  "M133 183 Q156 172 182 180",
  up:      "M133 179 Q156 166 182 175",
  high:    "M134 172 Q157 158 181 168",
  fierce:  "M131 175 Q158 178 184 191",
  worried: "M133 186 Q158 180 182 172",
  think:   "M133 181 Q156 172 182 181",
};

// 口（顔の中心 x=200 付近）
const MOUTHS = {
  smile_small: { d: "M186 284 Q200 291 214 284", fill: false },
  grin:        { d: "M181 280 Q200 298 219 280 Q200 288 181 280 Z", fill: true },
  open_happy:  { d: "M180 279 Q200 279 220 279 Q216 302 200 304 Q184 302 180 279 Z", fill: true, tongue: true },
  grin_teeth:  { d: "M178 279 L222 279 Q216 296 200 297 Q184 296 178 279 Z", fill: true, teeth: true },
  flat:        { d: "M189 286 L209 284", fill: false },
  o:           { d: "M200 279 Q210 279 210 290 Q210 301 200 301 Q190 301 190 290 Q190 279 200 279 Z", fill: true },
  wavy:        { d: "M185 287 Q191 282 197 287 Q203 292 209 287 Q213 284 216 286", fill: false },
  frown:       { d: "M187 290 Q200 282 213 290", fill: false },
  // 口パク用
  talk_a:      { d: "M184 280 Q200 279 216 280 Q212 300 200 301 Q188 300 184 280 Z", fill: true, tongue: true },
  talk_i:      { d: "M182 281 Q200 284 218 281 Q212 292 200 293 Q188 292 182 281 Z", fill: true, teeth: true },
  talk_o:      { d: "M200 280 Q209 280 209 289 Q209 297 200 297 Q191 297 191 289 Q191 280 200 280 Z", fill: true },
  talk_e:      { d: "M185 281 Q200 281 215 281 Q211 294 200 295 Q189 294 185 281 Z", fill: true },
};
const TALK_SHAPES = ["talk_a", "talk_i", "talk_o", "talk_e", "talk_a", "smile_small"];

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

/** 左目の部品を描く（右目は鏡写しで使う） */
function drawEye(parent, id) {
  const g = el("g", { class: "eye", id }, parent);
  // 開いた目
  const open = el("g", { class: "eye-open" }, g);
  el("path", { class: "sclera", d: "M136 219 Q144 203 163 202 Q180 203 187 214 Q184 236 162 238 Q143 236 136 219 Z" }, open);
  const iris = el("g", { class: "iris" }, open);
  el("ellipse", { cx: 163, cy: 221, rx: 12.5, ry: 15.5, fill: `url(#irisGrad)` }, iris);
  el("ellipse", { cx: 163, cy: 223, rx: 6, ry: 8, fill: "#0b1b33" }, iris);
  el("ellipse", { cx: 158, cy: 214, rx: 4.2, ry: 5.2, fill: "#fff" }, iris);
  el("circle", { cx: 169, cy: 228, r: 2, fill: "#fff", opacity: 0.85 }, iris);
  // 上まぶた（線の太いまつげ）
  el("path", { class: "lid", d: "M131 216 Q141 199 163 198 Q183 199 191 213 Q186 207 163 205 Q143 206 131 216 Z" }, open);
  el("path", { class: "lash", d: "M131 216 L125 212 M133 211 L128 205" }, open);
  // 下まつげ
  el("path", { class: "lower", d: "M142 234 Q162 241 182 231" }, open);
  // 閉じた目
  el("path", { class: "eye-closed", d: "M134 222 Q162 232 189 220" }, g);
  // 笑い目 ^
  el("path", { class: "eye-happy", d: "M136 225 Q162 203 188 224" }, g);
  return g;
}

export function createCharacter(container) {
  const svg = el("svg", { viewBox: "0 0 400 500", class: "hayato", role: "img", "aria-label": "ハヤト" });

  const defs = el("defs", {}, svg);
  defs.innerHTML = `
    <linearGradient id="skinGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe6d5"/><stop offset="1" stop-color="#f6cdb4"/>
    </linearGradient>
    <linearGradient id="hairGrad" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#2a3550"/><stop offset=".55" stop-color="#18203a"/><stop offset="1" stop-color="#0f1528"/>
    </linearGradient>
    <linearGradient id="hairShine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5fe3ff" stop-opacity="0"/><stop offset=".5" stop-color="#5fe3ff" stop-opacity=".55"/><stop offset="1" stop-color="#5fe3ff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="irisGrad" cx=".45" cy=".35" r=".75">
      <stop offset="0" stop-color="#ffd27a"/><stop offset=".45" stop-color="#ff9a2e"/><stop offset="1" stop-color="#b4460f"/>
    </radialGradient>
    <linearGradient id="jacketGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c2a3e"/><stop offset="1" stop-color="#0c1320"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;

  const body = el("g", { class: "body" }, svg);

  // ---- 体（ジャケット） ----
  const torso = el("g", { class: "torso" }, body);
  el("path", { d: "M176 318 L224 318 L230 372 L170 372 Z", fill: "#efc2a6" }, torso); // 首
  el("path", { d: "M176 330 Q200 346 224 330 L226 348 Q200 360 174 348 Z", fill: "#d9a88c", opacity: ".6" }, torso); // 首の影
  el("path", { d: "M40 500 Q46 404 120 378 Q160 364 182 360 L200 410 L218 360 Q240 364 280 378 Q354 404 360 500 Z", fill: "url(#jacketGrad)" }, torso);
  // 立ち襟
  el("path", { d: "M166 352 L182 340 L200 398 L178 384 Z", fill: "#24364f" }, torso);
  el("path", { d: "M234 352 L218 340 L200 398 L222 384 Z", fill: "#24364f" }, torso);
  el("path", { d: "M188 372 L200 398 L212 372 L200 380 Z", fill: "#0a0f19" }, torso);
  // 光るライン
  const lines = el("g", { class: "glow-lines", filter: "url(#glow)" }, torso);
  el("path", { d: "M70 470 Q90 420 140 400 L170 392" }, lines);
  el("path", { d: "M330 470 Q310 420 260 400 L230 392" }, lines);
  el("path", { d: "M200 412 L200 500" }, lines);
  // 胸の徽章（六角形）
  el("path", { class: "badge", d: "M142 432 L152 426 L162 432 L162 444 L152 450 L142 444 Z" }, torso);
  el("path", { d: "M147 438 L152 434 L157 438 L157 442 L152 446 L147 442 Z", fill: "#0c1320" }, torso);

  // ---- 頭 ----
  const head = el("g", { class: "head" }, body);

  // 後ろ髪
  el("path", { d: "M112 214 Q96 120 168 92 Q234 72 280 112 Q312 146 296 230 Q304 262 284 286 L270 230 Q262 150 200 138 Q140 146 128 232 L118 282 Q100 258 112 214 Z", fill: "url(#hairGrad)" }, head);

  // 耳
  el("path", { d: "M131 218 Q116 212 118 232 Q121 254 138 256 Z", fill: "#f4c6ab" }, head);
  el("path", { d: "M269 218 Q284 212 282 232 Q279 254 262 256 Z", fill: "#f4c6ab" }, head);

  // 顔
  el("path", { class: "face", d: "M132 196 Q130 250 152 284 Q176 316 200 320 Q224 316 248 284 Q270 250 268 196 Q262 148 200 146 Q138 148 132 196 Z", fill: "url(#skinGrad)" }, head);
  // あごの影
  el("path", { d: "M160 296 Q200 330 240 296 Q222 318 200 320 Q178 318 160 296 Z", fill: "#e9b79c", opacity: ".55" }, head);

  // 頬の赤み
  const blush = el("g", { class: "blush" }, head);
  el("ellipse", { cx: 150, cy: 256, rx: 15, ry: 7, fill: "#ff8f8f" }, blush);
  el("ellipse", { cx: 250, cy: 256, rx: 15, ry: 7, fill: "#ff8f8f" }, blush);
  el("path", { d: "M141 254 l5 -6 M150 255 l5 -6 M159 254 l5 -6 M236 254 l5 -6 M245 255 l5 -6 M254 254 l5 -6", stroke: "#ff7070", "stroke-width": 1.6, "stroke-linecap": "round" }, blush);

  // 目
  const eyes = el("g", { class: "eyes" }, head);
  const eyeL = drawEye(eyes, "eyeL");
  const eyeR = drawEye(eyes, "eyeR");
  eyeR.setAttribute("transform", "translate(400 0) scale(-1 1)");


  // 鼻
  el("path", { d: "M202 246 Q206 260 199 266", class: "nose" }, head);

  // 口
  const mouthG = el("g", { class: "mouth" }, head);
  const mouthInner = el("path", { class: "mouth-inner", d: MOUTHS.smile_small.d }, mouthG);
  const tongue = el("ellipse", { class: "tongue", cx: 200, cy: 297, rx: 9, ry: 4.5 }, mouthG);
  const teeth = el("path", { class: "teeth", d: "M182 281 L218 281 L216 286 L184 286 Z" }, mouthG);
  const mouthLine = el("path", { class: "mouth-line", d: MOUTHS.smile_small.d }, mouthG);

  // 前髪（ツンツン）
  const bangs = el("g", { class: "bangs" }, head);
  el("path", {
    d: "M122 214 Q114 150 160 116 Q200 94 246 112 Q290 134 282 214 L273 176 L263 190 L255 160 L240 182 L231 150 L215 178 L205 140 L191 176 L179 148 L167 182 L157 156 L145 186 L139 168 Z",
    fill: "url(#hairGrad)",
  }, bangs);
  // 上に跳ねる毛
  el("path", { d: "M160 118 Q150 80 176 58 Q172 88 186 104 Z M206 102 Q214 62 246 50 Q228 80 232 108 Z M246 116 Q270 92 300 98 Q276 108 268 130 Z", fill: "url(#hairGrad)" }, bangs);
  // ハイライト
  el("path", { d: "M150 146 Q166 128 188 122 M214 120 Q240 122 258 140", stroke: "url(#hairShine)", "stroke-width": 4, fill: "none", "stroke-linecap": "round", opacity: ".8" }, bangs);
  el("path", { d: "M201 142 L205 141 L191 176 Z M228 152 L232 151 L215 178 Z", fill: "#5fe3ff", opacity: ".35" }, bangs);

  // 眉（前髪の上に描く。アニメ風に髪から透けて見える）
  const browL = el("path", { class: "brow", d: BROWS.normal }, head);
  const browR = el("path", { class: "brow", d: BROWS.normal, transform: "translate(400 0) scale(-1 1)" }, head);

  // ヘッドセット（左耳側）
  const headset = el("g", { class: "headset" }, head);
  el("rect", { x: 266, y: 214, width: 20, height: 34, rx: 9, fill: "#22324a" }, headset);
  el("rect", { x: 270, y: 222, width: 12, height: 18, rx: 5, class: "headset-light" }, headset);
  el("path", { d: "M274 246 Q268 290 236 298", stroke: "#22324a", "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, headset);
  el("circle", { cx: 234, cy: 298, r: 4.5, class: "headset-light" }, headset);

  // ---- 感情のエフェクト ----
  const fx = el("g", { class: "fx" }, head);
  const sweat = el("path", { class: "fx-sweat", d: "M276 168 Q286 184 280 192 Q272 196 270 188 Q270 180 276 168 Z" }, fx);
  const sparkle = el("g", { class: "fx-sparkle" }, fx);
  for (const [x, y, s] of [[300, 140, 1], [96, 170, 0.7], [312, 200, 0.55]]) {
    el("path", { d: `M${x} ${y - 14 * s} L${x + 4 * s} ${y - 4 * s} L${x + 14 * s} ${y} L${x + 4 * s} ${y + 4 * s} L${x} ${y + 14 * s} L${x - 4 * s} ${y + 4 * s} L${x - 14 * s} ${y} L${x - 4 * s} ${y - 4 * s} Z` }, sparkle);
  }
  const fire = el("g", { class: "fx-fire", filter: "url(#glow)" }, fx);
  el("path", { d: "M92 150 L112 160 M86 182 L108 184 M96 212 L114 204 M308 150 L288 160 M314 182 L292 184 M304 212 L286 204" }, fire);
  const dots = el("g", { class: "fx-dots" }, fx);
  [[292, 150, 4], [306, 132, 5.5], [324, 110, 7]].forEach(([cx, cy, r]) => el("circle", { cx, cy, r }, dots));
  const shock = el("g", { class: "fx-shock" }, fx);
  el("path", { d: "M120 120 L104 98 M200 72 L200 48 M280 120 L296 98" }, shock);

  container.append(svg);

  // ---- 状態と更新 ----
  let current = "neutral";
  let talking = false;
  let talkShape = "smile_small";
  let blinking = false;

  function setMouth(name) {
    const m = MOUTHS[name] ?? MOUTHS.smile_small;
    mouthInner.setAttribute("d", m.d);
    mouthLine.setAttribute("d", m.d);
    mouthInner.style.display = m.fill ? "" : "none";
    tongue.style.display = m.tongue ? "" : "none";
    teeth.style.display = m.teeth ? "" : "none";
  }

  function applyEyes(mode) {
    svg.dataset.eyes = blinking ? "closed" : mode;
  }

  function render() {
    const ex = EXPRESSIONS[current];
    browL.setAttribute("d", BROWS[ex.brows]);
    browR.setAttribute("d", BROWS[ex.brows]);
    applyEyes(ex.eyes);
    setMouth(talking ? talkShape : ex.mouth);
    blush.style.opacity = String(ex.blush);
    svg.dataset.fx = ex.extra ?? "";
    // 視線（黒目の位置）
    const [lx, ly] = ex.look;
    for (const eye of [eyeL, eyeR]) {
      const flip = eye === eyeR ? -1 : 1; // 右目は鏡写しなので x を反転
      eye.querySelector(".iris").setAttribute("transform", `translate(${lx * flip} ${ly})`);
    }
    head.style.setProperty("--tilt", `${ex.tilt}deg`);
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
  function scheduleBlink() {
    const wait = 2200 + Math.random() * 3800;
    setTimeout(() => {
      const ex = EXPRESSIONS[current];
      if (ex.eyes !== "happy") {
        blinking = true; applyEyes(ex.eyes);
        setTimeout(() => {
          blinking = false; applyEyes(EXPRESSIONS[current].eyes);
          if (Math.random() < 0.25) setTimeout(() => {
            blinking = true; applyEyes(EXPRESSIONS[current].eyes);
            setTimeout(() => { blinking = false; applyEyes(EXPRESSIONS[current].eyes); }, 110);
          }, 160);
        }, 120);
      }
      scheduleBlink();
    }, wait);
  }
  scheduleBlink();

  // 口パク: 話している間は口の形をランダムに切り替える
  let talkTimer = null;
  function setTalking(on) {
    if (on === talking) return;
    talking = on;
    clearInterval(talkTimer);
    if (on) {
      talkTimer = setInterval(() => {
        talkShape = TALK_SHAPES[(Math.random() * TALK_SHAPES.length) | 0];
        setMouth(talkShape);
      }, 95);
    }
    render();
  }

  render();
  return { setExpression, setTalking, get expression() { return current; } };
}
