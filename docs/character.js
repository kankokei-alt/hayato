// ハヤトの立ち絵。持ち主が用意したイラストを表情ごとに切り抜いた画像（docs/hayato/*.webp）を切り替えて表示する。
// 使い方: const hayato = createCharacter(container); hayato.setExpression("smile"); hayato.setTalking(true);

// 各画像の大きさと、その画像の中での顔の中心（ピクセル）。顔の位置と大きさをそろえて表示するのに使う
// s は頭の大きさをそろえるための倍率（全身の絵は頭が少し大きく描かれているので縮める）
const SPRITES = {
  neutral:   { w: 230, h: 290, cx: 125, cy: 135, s: 0.83 }, // ご案内
  smile:     { w: 190, h: 250, cx: 90,  cy: 135, s: 1 },    // 笑顔（お任せください！）
  excited:   { w: 252, h: 290, cx: 145, cy: 135, s: 0.86 }, // 斜め向き・やぁ！
  fired:     { w: 217, h: 249, cx: 125, cy: 130, s: 1.03 }, // 真剣（解析中／信頼）
  idea:      { w: 262, h: 290, cx: 155, cy: 135, s: 0.88 }, // ひらめき解決！
  convinced: { w: 180, h: 250, cx: 90,  cy: 134, s: 1.05 }, // 納得／ふむふむ
  surprised: { w: 222, h: 215, cx: 105, cy: 110, s: 1 },    // 驚き／ひらめき
  worried:   { w: 200, h: 215, cx: 100, cy: 115, s: 1 },    // 困り顔（共感）
  please:    { w: 166, h: 208, cx: 85,  cy: 110, s: 1 },    // お願い／お祈り
  error:     { w: 238, h: 258, cx: 125, cy: 135, s: 1 },    // ガーン（エラー／想定外）
  panic:     { w: 237, h: 280, cx: 115, cy: 115, s: 1 },    // パニック
  relieved:  { w: 228, h: 212, cx: 110, cy: 110, s: 1 },    // お疲れ様です（ひとやすみ）
  bow:       { w: 178, h: 290, cx: 95,  cy: 105, s: 1 },    // お辞儀
};

// Claude やアプリが使う表情名 → 使う画像
const EXPRESSIONS = {
  neutral: "neutral", listening: "neutral",
  smile: "smile", excited: "excited",
  fired: "fired", thinking: "fired",
  idea: "idea", convinced: "convinced", surprised: "surprised",
  worried: "worried", sad: "worried", please: "please",
  error: "error", panic: "panic", relieved: "relieved", bow: "bow",
};
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

// 表示エリア（画像のピクセル単位）。顔の中心をここにそろえる
const STAGE = { w: 300, h: 300, faceX: 150, faceY: 138 };

export function createCharacter(container) {
  const root = document.createElement("div");
  root.className = "hayato-figure";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "ハヤト");

  const imgs = {};
  for (const [name, s] of Object.entries(SPRITES)) {
    const img = document.createElement("img");
    img.src = `hayato/${name}.webp`;
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.style.width = `${((s.w * s.s) / STAGE.w) * 100}%`;
    img.style.left = `${((STAGE.faceX - s.cx * s.s) / STAGE.w) * 100}%`;
    img.style.top = `${((STAGE.faceY - s.cy * s.s) / STAGE.h) * 100}%`;
    // 顔の中心を軸に揺らす
    img.style.transformOrigin = `${(s.cx / s.w) * 100}% ${(s.cy / s.h) * 100}%`;
    root.append(img);
    imgs[name] = img;
  }
  container.append(root);

  let current = null;
  function setExpression(name) {
    if (!EXPRESSIONS[name] || name === current) return;
    const prevSprite = current && EXPRESSIONS[current];
    current = name;
    const sprite = EXPRESSIONS[name];
    if (sprite === prevSprite) return;
    for (const [key, img] of Object.entries(imgs)) img.classList.toggle("active", key === sprite);
    root.classList.remove("pop");
    void root.offsetWidth; // アニメーションをやり直す
    root.classList.add("pop");
  }

  function setTalking(on) {
    root.classList.toggle("talking", on);
  }

  setExpression("neutral");
  return { setExpression, setTalking, get expression() { return current; } };
}
