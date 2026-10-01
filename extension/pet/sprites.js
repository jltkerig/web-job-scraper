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
    P: "#f59aa6", // pink: inner ears, blush
    L: "#f6a25a", // light orange: the top of the fur
    c: "#e6cfa6", // shaded cream
    G: "#4a9b3a", // leaf green
    g: "#2f6b26", // stem green
    B: "#4f6fd9", // bluebell
    b: "#9fb2f5", // petal highlight
    p: "#4a1838", // speckles inside a foxglove bell
    Y: "#f5c518", // bee yellow
    V: "#d6ecff", // bee wing
    q: "#7aa7cc", // bee wing edge
    k: "#1f3a1a", // flower outline, so flowers show on a white page
    E: "#7cbf5a", // grass
    e: "#5a9e3e", // grass shade
  };

  // ---------- fox parts (facing right; the frame is 32 x 32, ground at row 30) ----------

  // The head is drawn for the 64 x 64 fox directly (18 x 16): pointed ears with pink insides, an almond eye with a
  // shine, a blush, a cream muzzle and a black nose. Closed (blinking, sleeping), the eye is a happy curve.
  const HEAD_64 = [
    "..KK....KK........",
    ".KPK...KPK........",
    ".KPPK.KPPK........",
    "KOPPOKOPPOK.......",
    "KOOOOOOOOOOK......",
    "KOOOOOOOOOOOK.....",
    "KOOOOOOKKOOOOK....",
    "KOOOOOOKWKOOOOK...",
    "KOOOOOOKKKOOOOOKK.",
    "KOOOOOOOOOOOCCCCKK",
    "KCOOOOOOPPCCCCCCKK",
    "KCCOOOOOCCCCCCCK..",
    ".KCCOOOCCCCCKKK...",
    ".KCCCOOCCCCK......",
    "..KCCCCCCKK.......",
    "...KKKKKK.........",
  ];
  const EYE_64_CLOSED = [
    [7, 6, "O"], [8, 6, "O"],
    [7, 7, "K"], [8, 7, "K"], [9, 7, "K"],
    [6, 8, "K"], [7, 8, "O"], [8, 8, "O"], [9, 8, "O"], [10, 8, "K"],
  ];

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

  // ---------- garden: one foxglove per job still to collect (9 x 20, bottom row on the ground) ----------
  // A tall spike of drooping bells, smaller toward the top, with speckled throats (p). B and b are the petal
  // colours; each flower gets its own pair from PETALS.

  const FOXGLOVE = [
    "....g....",
    "....B....",
    "...BgB...",
    "....g....",
    "..BBg....",
    "..Bbg.BB.",
    "....gBb..",
    ".BBBg....",
    ".BpBgBBB.",
    "..b.gBpB.",
    "....g.b..",
    "BBB.g....",
    "BpBBg.BBB",
    ".b..gBBpB",
    "....g..b.",
    "....g....",
    ".GG.g.GG.",
    "GGG.g.GGG",
    ".GGGgGGG.",
    "....g....",
  ];

  // Now and then a really tall foxglove (9 x 30) grows instead.
  const GIANT_FOXGLOVE = [
    "....g....",
    "....B....",
    "....g....",
    "...BgB...",
    "....g....",
    "..BBg....",
    "....gBB..",
    "..Bbg....",
    "....gBb..",
    ".BBBg....",
    ".BpBgBBB.",
    "..b.gBpB.",
    "....g.b..",
    ".BBBg....",
    ".BpBgBBB.",
    "..b.gBpB.",
    "....g.b..",
    "BBB.g....",
    "BpBBg.BBB",
    ".b..gBBpB",
    "....g..b.",
    "BBB.g....",
    "BpBBg.BBB",
    ".b..gBBpB",
    "....g..b.",
    "....g....",
    ".GG.g.GG.",
    "GGG.g.GGG",
    ".GGGgGGG.",
    "....g....",
  ];

  // Bluebells (9 x 14): bells hanging along one side of an arching stem.
  const BLUEBELL = [
    "...g.....",
    "...g.BBB.",
    "...ggBBBb",
    "...g..bB.",
    ".BBBg....",
    "BBBbg....",
    ".Bb.g....",
    "....gBBB.",
    "....gBBBb",
    "....g.bB.",
    ".G..g....",
    "..G.g.G..",
    "...GgG...",
    "....g....",
  ];

  // ---------- the bee (9 x 6): yellow and black stripes, pale blue wings that flap ----------
  const BEE = [
    [
      "...qq....",
      "..qVVq...",
      ".KYYKYYK.",
      "KKYYKYYKK",
      ".KYYKYYK.",
      ".........",
    ],
    [
      ".........",
      "...qq....",
      ".KYYKYYK.",
      "KKYYKYYKK",
      ".KYqVqYK.",
      "....q....",
    ],
  ];

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
  // The knee row covers both the thigh's and the lower leg's columns, so a stepping leg bends instead of
  // touching only at a corner (which looked like the leg coming off).
  function leg(frame, x, top, dx = 0, lift = 0) {
    for (let y = top; y < top + 4; y += 1) {
      frame.set(`${x},${y}`, "D");
      frame.set(`${x + 1},${y}`, "D");
    }
    for (let i = Math.min(0, dx); i <= 1 + Math.max(0, dx); i += 1) frame.set(`${x + i},${top + 4}`, "K");
    for (let y = top + 4; y < top + 8 - lift; y += 1) {
      frame.set(`${x + dx},${y}`, "K");
      frame.set(`${x + dx + 1},${y}`, "K");
    }
    for (let i = 0; i < 3; i += 1) frame.set(`${x + dx + i},${top + 8 - lift}`, "K");
  }

  const LEG_X = [8, 11, 17, 20]; // back, back, front, front
  // Standing, the head (at 19,4) and body (at 6,13) only met at a corner, so the head looked loose: these pixels
  // fill the neck between them, with an outline on its back and front.
  const NECK = [
    [18, 12, "K"], [19, 12, "O"],
    [18, 13, "O"], [19, 13, "O"], [20, 13, "O"],
    [19, 14, "O"], [20, 14, "O"], [21, 14, "O"],
    [20, 15, "O"], [21, 15, "K"],
  ];
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
    dots(frame, NECK, 0, bob - rise);
    frame.head = [19, 4 + bob - rise, eyes];
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
    frame.head = [12, headY, eyes];
    return frame;
  }

  // Curled up: body low, no legs, head resting on its paws.
  function lie({ eyes = false, breathe = 0 } = {}) {
    const frame = new Map();
    stamp(frame, TAIL_DOWN, 0, 25);
    stamp(frame, BODY, 6, 22 - breathe);
    for (let i = 0; i < 5; i += 1) frame.set(`${21 + i},29`, "K");
    frame.head = [18, 18, eyes];
    return frame;
  }

  // Crouched, ready to pounce: like lying down but eyes open and tail up.
  function crouch() {
    const frame = lie({ eyes: true });
    stamp(frame, TAIL_UP, 0, 17);
    return frame;
  }

  // Every pose the fox uses, built once.
  // ---------- the detailed fox: each 32 x 32 pose doubled to 64 x 64, then shaded ----------

  // Scale2x (EPX): doubles a frame and rounds off the staircase on diagonal edges, so the bigger fox is smooth.
  function scale2x(frame, size) {
    const at = (x, y) => frame.get(`${x},${y}`) || ".";
    const out = new Map();
    const put = (x, y, ch) => {
      if (ch !== ".") out.set(`${x},${y}`, ch);
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const p = at(x, y);
        const a = at(x, y - 1);
        const b = at(x + 1, y);
        const c = at(x - 1, y);
        const d = at(x, y + 1);
        put(2 * x, 2 * y, c === a && c !== d && a !== b ? a : p);
        put(2 * x + 1, 2 * y, a === b && a !== c && b !== d ? b : p);
        put(2 * x, 2 * y + 1, d === c && d !== b && c !== a ? c : p);
        put(2 * x + 1, 2 * y + 1, b === d && b !== a && d !== c ? d : p);
      }
    }
    return out;
  }

  // Fur shading: a light band along the top of orange fur, a darker band underneath, a soft shadow on the cream.
  function shade(frame) {
    const at = (x, y) => frame.get(`${x},${y}`) || ".";
    const edge = (ch) => ch === "K" || ch === ".";
    const out = new Map(frame);
    for (const [key, ch] of frame) {
      const [x, y] = key.split(",").map(Number);
      if (ch === "O") {
        if (edge(at(x, y - 1))) out.set(key, "L");
        else if (edge(at(x, y + 1)) || edge(at(x, y + 2))) out.set(key, "D");
      } else if (ch === "C" && (edge(at(x, y + 1)) || edge(at(x, y + 2)))) {
        out.set(key, "c");
      }
    }
    return out;
  }

  // The head is drawn at full detail rather than doubled (doubling made it huge and lumpy). It's smaller than the
  // doubled one, its bottom-back corner where the old head's was, so it still sits on the neck.
  function detailed(frame) {
    const out = scale2x(frame, 32);
    const [hx, hy, eyes] = frame.head;
    const x = 2 * hx;
    const y = 2 * hy + 22 - HEAD_64.length;
    stamp(out, HEAD_64, x, y);
    if (!eyes) dots(out, EYE_64_CLOSED, x, y);
    return shade(out);
  }

  const FOX = {
    stand: detailed(stand()),
    standBlink: detailed(stand({ eyes: false })),
    walk: [0, 1, 2, 3].map((walk) => detailed(stand({ walk, bob: walk % 2 === 1 ? 1 : 0 }))),
    sit: detailed(sit()),
    sitBlink: detailed(sit({ eyes: false })),
    alert: detailed(sit({ alert: true })),
    sleep: [detailed(lie()), detailed(lie({ breathe: 1 }))],
    crouch: detailed(crouch()),
    leap: detailed(stand({ walk: 0, tail: "UP", rise: 4 })),
  };

  // Petal colours, [petal, lip] replacing B and b, for each kind of flower.
  const FOXGLOVE_COLOURS = [
    ["#a8327f", "#d77ab4"], // magenta
    ["#e0609f", "#f5a9cf"], // pink
    ["#9a6fd0", "#c9b0ef"], // lilac
    ["#ee9a5c", "#f7c9a0"], // apricot
    ["#eadbe6", "#ffffff"], // cream
    ["#c2305a", "#e88aa6"], // deep rose
  ];
  const BLUEBELL_COLOURS = [
    ["#4f6fd9", "#9fb2f5"], // blue
    ["#8a4fd9", "#c9a6f7"], // violet
    ["#e0559b", "#f7a8cf"], // pink
    ["#e04848", "#f7a0a0"], // red
    ["#e8a821", "#f7dc7a"], // gold
    ["#22a094", "#8be0d6"], // teal
  ];

  // Draws a frame onto a canvas context at (x, y) in canvas pixels. flip mirrors it to face left; colors replaces
  // palette letters (a flower's petal colours).
  function draw(ctx, frame, x, y, scale, flip = false, width = 32, colors = null) {
    for (const [key, ch] of frame) {
      const [px, py] = key.split(",").map(Number);
      ctx.fillStyle = (colors && colors[ch]) || PALETTE[ch];
      const fx = flip ? width - 1 - px : px;
      ctx.fillRect(Math.round(x + fx * scale), Math.round(y + py * scale), scale, scale);
    }
  }

  // A one-pixel dark outline around every coloured pixel, so thin stems and pale petals stand out on any page.
  // The flower moves one pixel in, making the frame 2 wider and 1 taller (no outline under the stem: it's in the
  // ground).
  function outlined(grid) {
    const frame = new Map();
    stamp(frame, grid, 1, 1);
    const ring = new Map();
    for (const key of frame.keys()) {
      const [x, y] = key.split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const near = `${x + dx},${y + dy}`;
        if (!frame.has(near) && y + dy <= grid.length) ring.set(near, "k");
      }
    }
    for (const [key, ch] of ring) frame.set(key, ch);
    return frame;
  }

  // Each kind of flower: its outlined frame, its size (with the outline) and its petal colours.
  const FLOWERS = {
    foxglove: { frame: outlined(FOXGLOVE), size: [11, FOXGLOVE.length + 1], colours: FOXGLOVE_COLOURS },
    giant: { frame: outlined(GIANT_FOXGLOVE), size: [11, GIANT_FOXGLOVE.length + 1], colours: FOXGLOVE_COLOURS },
    bluebell: { frame: outlined(BLUEBELL), size: [11, BLUEBELL.length + 1], colours: BLUEBELL_COLOURS },
  };
  const BEE_FRAMES = BEE.map((grid) => {
    const frame = new Map();
    stamp(frame, grid, 0, 0);
    return frame;
  });

  // A tuft of grass, 6 x 3, repeated along the ground.
  const GRASS = new Map();
  stamp(GRASS, ["..E..E", ".EeEEe", "eeeeee"], 0, 0);

  root.PetSprites = {
    PALETTE, FOX, FLOWERS, FLOWER_WIDTH: 11, BEE: BEE_FRAMES, BEE_SIZE: [9, 6], GRASS, FOX_SIZE: 64, draw,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
