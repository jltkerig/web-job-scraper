// Pixel art for the fox and the garden, drawn from text grids (one character per pixel).
// Everything is inline, so the extension adds no files a web page could probe for.
(function (root) {
  "use strict";

  const PALETTE = {
    K: "#2b1a12", // dark brown: outline, legs, nose, eyes
    O: "#e87a2a", // orange
    D: "#b9561b", // dark orange shading
    C: "#f7e7c9", // cream
    W: "#ffffff", // eye shine
    G: "#4a9b3a", // leaf green
    g: "#2f6b26", // stem green
    B: "#4f6fd9", // bluebell
    b: "#9fb2f5", // bluebell highlight
    Y: "#ffd84a", // sparkle
    w: "#8a6a3a", // wilted stem
    v: "#8d89a8", // wilted petals
  };

  // ---------- fox parts (facing right; the frame is 32 x 32, ground at row 30) ----------

  const HEAD = [
    ".K...K......",
    ".KK..KK.....",
    ".KOK.KOK....",
    "KOOOKOOOK...",
    "KOOOOOKOOK..",
    "KOOOOOKOOOK.",
    "KOOOOOOOOOOK",
    "KCOOOOOOCCCK",
    ".KCCOOOCCCK.",
    "..KCCCCCCK..",
    "...KKKKKK...",
  ];
  // The eye is the two K pixels at column 6, rows 4-5; closed, it becomes a short line on row 5.
  const EYE_OPEN = [[6, 4, "K"], [6, 5, "K"]];
  const EYE_CLOSED = [[6, 4, "O"], [5, 5, "K"], [6, 5, "K"], [7, 5, "K"]];

  const BODY = [
    "....KKKKKKKKK...",
    "..KKOOOOOOOOOK..",
    ".KOOOOOOOOOOOOK.",
    "KOOOOOOOOOOOOOOK",
    "KDOOOOOOOOOOOOCK",
    "KDDOOOOOOOOOOCCK",
    ".KDDDOOOOOOOCCK.",
    "..KKKKKKKKKKKK..",
  ];

  const SIT_BODY = [
    "....KKKK....",
    "..KKOOOOK...",
    ".KOOOOOOOK..",
    "KOOOOOOOOCK.",
    "KOOOOOOOCCK.",
    "KOOOOOOOCCCK",
    "KDOOOOOOCCCK",
    "KDOOOOOOCCK.",
    "KDDOOOOOOK..",
    "KDDDOOOOOK..",
    ".KKKKKKKKK..",
  ];

  const TAIL = [
    ".KK.......",
    "KCCK......",
    "KCCOK.....",
    "KOOOOK....",
    ".KOOOOKK..",
    "..KOOOOOKK",
    "...KKOOOOK",
    ".....KKKK.",
  ];
  const TAIL_UP = [
    "KK........",
    "KCK.......",
    "KCCK......",
    "KOOOK.....",
    ".KOOOK....",
    "..KOOOKKK.",
    "...KOOOOOK",
    "....KKKKK.",
  ];
  const TAIL_DOWN = [
    "...KKKK...",
    ".KKOOOOKK.",
    "KCCOOOOOOK",
    "KCCKKKKKK.",
    ".KK.......",
  ];

  // ---------- garden (9 x 14, bottom row on the ground) ----------

  const FLOWERS = {
    sprout: [
      ".........", ".........", ".........", ".........", ".........", ".........", ".........", ".........",
      ".........", ".........",
      "..G...G..",
      "...GgG...",
      "....g....",
      "....g....",
    ],
    bloom: [
      "....g....",
      "....gg...",
      "....g.BB.",
      "....g.BBb",
      "....g..B.",
      "..BBg....",
      ".bBBg....",
      "..B.g....",
      "....g.BB.",
      "....g.BBb",
      ".G..g..B.",
      "..G.g.G..",
      "...GgG...",
      "....g....",
    ],
    wilt: [
      ".........", ".........", ".........", ".........", ".........",
      ".vv......",
      ".vvw.....",
      "...ww....",
      ".....w...",
      ".....w...",
      "..G..w...",
      "...G.w.G.",
      "....GwG..",
      ".....w...",
    ],
  };
  FLOWERS.sparkle = FLOWERS.bloom.map((row, y) => {
    const marks = { 0: [1, 7], 3: [0], 6: [8], 8: [1] }[y] || [];
    return row.split("").map((ch, x) => (marks.includes(x) ? "Y" : ch)).join("");
  });

  // ---------- composing frames ----------

  // A frame is a Map "x,y" -> palette letter. Later parts are drawn over earlier ones.
  function stamp(frame, grid, ox, oy) {
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== ".") frame.set(`${ox + x},${oy + y}`, row[x]);
      }
    });
  }

  function dots(frame, list, ox, oy) {
    for (const [x, y, ch] of list) frame.set(`${ox + x},${oy + y}`, ch);
  }

  // One leg: orange thigh, dark sock, a 3-pixel foot. dx moves the lower leg, lift raises the foot.
  function leg(frame, x, top, dx = 0, lift = 0) {
    for (let y = top; y < top + 4; y += 1) {
      frame.set(`${x},${y}`, "D");
      frame.set(`${x + 1},${y}`, "D");
    }
    for (let y = top + 4; y < top + 8 - lift; y += 1) {
      frame.set(`${x + dx},${y}`, "K");
      frame.set(`${x + dx + 1},${y}`, "K");
    }
    for (let i = 0; i < 3; i += 1) frame.set(`${x + dx + i},${top + 8 - lift}`, "K");
  }

  const LEG_X = [8, 11, 17, 20]; // back, back, front, front
  // Walk cycle: [dx, lift] for each leg in each of 4 frames.
  const WALK = [
    [[-1, 0], [1, 1], [1, 1], [-1, 0]],
    [[0, 1], [0, 0], [0, 0], [0, 1]],
    [[1, 1], [-1, 0], [-1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 1], [0, 0]],
  ];

  function stand({ walk = -1, eyes = true, tail = "TAIL", bob = 0, rise = 0 } = {}) {
    const frame = new Map();
    const top = 21 + bob - rise;
    stamp(frame, tail === "UP" ? TAIL_UP : TAIL, 0, 7 + bob - rise);
    LEG_X.forEach((x, i) => {
      const [dx, lift] = walk >= 0 ? WALK[walk][i] : [0, 0];
      leg(frame, x, top, dx, lift);
    });
    stamp(frame, BODY, 6, 13 + bob - rise);
    stamp(frame, HEAD, 19, 4 + bob - rise);
    dots(frame, eyes ? EYE_OPEN : EYE_CLOSED, 19, 4 + bob - rise);
    return frame;
  }

  // Sitting: haunch on the ground, tail curled in front of it, front legs straight, head over the chest.
  function sit({ eyes = true, alert = false } = {}) {
    const frame = new Map();
    stamp(frame, TAIL_DOWN, 1, 25);
    stamp(frame, SIT_BODY, 9, 19);
    for (const x of [17, 19]) {
      for (let y = 21; y < 29; y += 1) frame.set(`${x},${y}`, y < 24 ? "D" : "K");
    }
    for (let i = 0; i < 4; i += 1) frame.set(`${17 + i},29`, "K");
    const headY = alert ? 9 : 10;
    stamp(frame, HEAD, 12, headY);
    dots(frame, eyes ? EYE_OPEN : EYE_CLOSED, 12, headY);
    return frame;
  }

  // Curled up: body low, no legs, head resting on its paws.
  function lie({ eyes = false, breathe = 0 } = {}) {
    const frame = new Map();
    stamp(frame, TAIL_DOWN, 0, 25);
    stamp(frame, BODY, 6, 22 - breathe);
    for (let i = 0; i < 5; i += 1) frame.set(`${21 + i},29`, "K");
    stamp(frame, HEAD, 18, 18);
    dots(frame, eyes ? EYE_OPEN : EYE_CLOSED, 18, 18);
    return frame;
  }

  // Crouched, ready to pounce: like lying down but eyes open and tail up.
  function crouch() {
    const frame = lie({ eyes: true });
    stamp(frame, TAIL_UP, 0, 17);
    return frame;
  }

  // Every pose the fox uses, built once.
  const FOX = {
    stand: stand(),
    standBlink: stand({ eyes: false }),
    walk: [0, 1, 2, 3].map((walk) => stand({ walk, bob: walk % 2 === 1 ? 1 : 0 })),
    sit: sit(),
    sitBlink: sit({ eyes: false }),
    alert: sit({ alert: true }),
    sleep: [lie(), lie({ breathe: 1 })],
    peek: lie({ eyes: true }),
    crouch: crouch(),
    leap: stand({ walk: 0, tail: "UP", rise: 4 }),
  };

  // Draws a frame onto a canvas context at (x, y) in canvas pixels. flip mirrors it to face left.
  function draw(ctx, frame, x, y, scale, flip = false, width = 32) {
    for (const [key, ch] of frame) {
      const [px, py] = key.split(",").map(Number);
      ctx.fillStyle = PALETTE[ch];
      const fx = flip ? width - 1 - px : px;
      ctx.fillRect(Math.round(x + fx * scale), Math.round(y + py * scale), scale, scale);
    }
  }

  const FLOWER_FRAMES = {};
  for (const [name, grid] of Object.entries(FLOWERS)) {
    FLOWER_FRAMES[name] = new Map();
    stamp(FLOWER_FRAMES[name], grid, 0, 0);
  }

  root.PetSprites = { PALETTE, FOX, FLOWERS: FLOWER_FRAMES, FLOWER_SIZE: [9, 14], FOX_SIZE: 32, draw };
})(typeof globalThis !== "undefined" ? globalThis : this);
