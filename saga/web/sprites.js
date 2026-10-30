import { ANGELS, ATTR, AVATARS, CLASSES, ENEMY_BY_KEY, ITEMS, SKINS } from "./data.js";
import { BGS, GRIDS, HAND, PROPS, PROP_PAL } from "./grids.js";
import { findHabit } from "./rules.js";
import { RM, state } from "./views.js";

/* =====================================================================
   SPRITES — grids → resolved pixel cells (cached) → painted at any scale
   ===================================================================== */
export const DEF_COL = {
  o: "#1b1424",
  k: "#0d0a12",
  w: "#f4ecd8",
  r: "#e07a8a",
  f: "#ffb43a",
  s: "#f1c7a0",
  y: "@a",
  b: "@a",
  c: "@a",
};
export function resolveCol(pal, ch) {
  if (ch === "n") return pal.g ? resolveCol(pal, "o") : null;
  let v = ch in pal ? pal[ch] : DEF_COL[ch];
  if (typeof v === "string" && v[0] === "@") v = resolveCol(pal, v[1]);
  return v || null;
}
export const CELL_CACHE = new Map();
export function cellsFor(key, layers) {
  if (CELL_CACHE.has(key)) return CELL_CACHE.get(key);
  const cells = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const L of layers) {
    L.rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const ch = row[xx];
        if (ch === ".") continue;
        const col = resolveCol(L.pal, ch);
        if (!col) continue;
        const X = xx + (L.x || 0),
          Y = yy + (L.y || 0);
        cells.push([X, Y, col]);
        if (X < minX) minX = X;
        if (Y < minY) minY = Y;
        if (X > maxX) maxX = X;
        if (Y > maxY) maxY = Y;
      }
    });
  }
  const base = layers[0].rows;
  const sp = { cells, minX, minY, maxX, maxY, gw: base[0].length, gh: base.length };
  CELL_CACHE.set(key, sp);
  return sp;
}
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255;
  const t = amt < 0 ? 0 : 255,
    p = Math.abs(amt);
  r = Math.round(r + (t - r) * p);
  g = Math.round(g + (t - g) * p);
  b = Math.round(b + (t - b) * p);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
export function hashId(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}
export const cellNoise = (x, y) => (((Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0) % 1000) / 1000;

export function enemySprite(def) {
  return cellsFor("e:" + def.key, [{ rows: GRIDS[def.base], pal: def.pal }]);
}
export function propLayer(name, tint) {
  const P = PROPS[name];
  return {
    rows: P.rows,
    pal: Object.assign({}, PROP_PAL, { d: P.d || tint }, P.pal || {}),
    x: HAND.x - P.gx,
    y: HAND.y - P.gy,
  };
}
export function companionSprite(h) {
  const a = ATTR[h.attr],
    cls = CLASSES[a.cls];
  const skin = SKINS[hashId(h.id) % SKINS.length];
  const pal = {
    o: "#1b1424",
    e: "#1b1424",
    h: cls.hair,
    s: skin,
    a: a.color,
    c: shade(a.color, 0.3),
    b: shade(a.color, -0.5),
  };
  return cellsFor("c:" + h.attr + ":" + skin, [
    { rows: GRIDS.humanoid, pal },
    propLayer(cls.prop, shade(a.color, -0.15)),
  ]);
}
export function heroSprite(avatarId) {
  const av = AVATARS.find((a) => a.id === avatarId) || AVATARS[0];
  const pal = Object.assign({ o: "#1b1424", e: "#1b1424" }, av.pal);
  return cellsFor("hero:" + av.id, [{ rows: GRIDS.hero, pal }, propLayer(av.prop, av.d || shade(av.pal.a, -0.2))]);
}
export const tombSprite = () =>
  cellsFor("tomb", [{ rows: GRIDS.tomb, pal: { a: "#8a8698", b: "#4a4658", c: "#b5b2c2", d: "#4f7a3a" } }]);
export const itemSprite = (key) => cellsFor("i:" + key, [{ rows: GRIDS[ITEMS[key].grid], pal: ITEMS[key].pal }]);
export const angelSprite = (who) => cellsFor("a:" + who, [{ rows: GRIDS[who], pal: ANGELS[who].pal }]);
export function paint(g, sp, x, y, s, opt) {
  x = Math.round(x);
  y = Math.round(y);
  const white = opt && opt.white,
    dis = opt && opt.dissolve;
  for (const [cx, cy, col] of sp.cells) {
    if (dis && cellNoise(cx, cy) < dis) continue;
    g.fillStyle = white ? "#ffffff" : col;
    g.fillRect(x + cx * s, y + cy * s, s, s);
  }
}
// Place a sprite by the bottom-centre of its base grid (its "feet").
export function paintAtFeet(g, sp, fx, fy, s, opt) {
  paint(g, sp, fx - (sp.gw * s) / 2, fy - sp.gh * s, s, opt);
}
export function spriteFor(spec) {
  const [kind, id] = spec.split(":");
  if (kind === "hero") return heroSprite(state.hero.avatar);
  if (kind === "avatar") return heroSprite(id);
  if (kind === "enemy") return ENEMY_BY_KEY[id] && enemySprite(ENEMY_BY_KEY[id]);
  if (kind === "comp") {
    const h = findHabit(state, id);
    return h && companionSprite(h);
  }
  if (kind === "item") return ITEMS[id] && itemSprite(id);
  if (kind === "angel") return ANGELS[id] && angelSprite(id);
  return null;
}
// Paint every <canvas data-sprite="…" data-s="scale"> inside root.
export function hydrate(root) {
  root.querySelectorAll("canvas[data-sprite]").forEach((cv) => {
    const sp = spriteFor(cv.dataset.sprite);
    if (!sp) return;
    const s = +cv.dataset.s || 2;
    const w = sp.maxX - sp.minX + 1,
      h = sp.maxY - sp.minY + 1;
    cv.width = w;
    cv.height = h;
    cv.style.width = w * s + "px";
    const g = cv.getContext("2d");
    g.clearRect(0, 0, w, h);
    paint(g, sp, -sp.minX, -sp.minY, 1);
  });
}

/* ---------- battle backgrounds (pre-rendered per tier, ambient layer animated) ---------- */
export const SW = 320,
  SH = 180,
  HZ = 100;
export function seeded(n) {
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export const BG_CACHE = {};
export function makeBg(key) {
  if (BG_CACHE[key]) return BG_CACHE[key];
  const c = document.createElement("canvas");
  c.width = SW;
  c.height = SH;
  const g = c.getContext("2d");
  const B = BGS[key],
    R = seeded(hashId(key) + 7);
  const bandH = Math.ceil(HZ / 3);
  B.sky.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, i * bandH, SW, bandH);
  });
  for (let i = 1; i < 3; i++) {
    // dithered seams between sky bands
    g.fillStyle = B.sky[i - 1];
    for (let x = 0; x < SW; x += 2) {
      g.fillRect(x, i * bandH, 1, 1);
      g.fillRect(x + 1, i * bandH + 2, 1, 1);
    }
  }
  if (B.stars) {
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 60; i++) g.fillRect(Math.floor(R() * SW), Math.floor(R() * HZ * 0.6), 1, 1);
  }
  DECO[B.deco](g, B, R);
  const gh = [12, 26, SH - HZ - 38];
  let y = HZ;
  B.ground.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, y, SW, gh[i]);
    y += gh[i];
  });
  for (let i = 0; i < 260; i++) {
    // ground speckle
    const yy = HZ + Math.floor(R() * (SH - HZ));
    g.fillStyle = R() < 0.5 ? shade(B.ground[1], -0.25) : shade(B.ground[0], 0.12);
    g.fillRect(Math.floor(R() * SW), yy, R() < 0.3 ? 2 : 1, 1);
  }
  if (B.deco === "tombs") drawTombs(g, R);
  BG_CACHE[key] = c;
  return c;
}
export function tri(g, cx, top, h, col, slope) {
  g.fillStyle = col;
  for (let r = 0; r < h; r++) {
    const w = Math.max(1, Math.round(r * slope));
    g.fillRect(Math.round(cx - w / 2), top + r, w, 1);
  }
}
export const DECO = {
  hills(g, B) {
    g.fillStyle = B.far;
    for (let x = 0; x < SW; x++) {
      const h = 12 + Math.round(6 * Math.sin(x / 27) + 4 * Math.sin(x / 9 + 1));
      g.fillRect(x, HZ - h, 1, h);
    }
    g.fillStyle = "#ffffff";
    [
      [40, 18],
      [150, 30],
      [250, 14],
    ].forEach(([x, y]) => {
      g.fillRect(x, y, 26, 4);
      g.fillRect(x + 5, y - 3, 14, 3);
      g.fillRect(x + 3, y + 4, 18, 2);
    });
  },
  pines(g, B, R) {
    g.fillStyle = shade(B.far, 0.15);
    for (let x = 0; x < SW; x++) {
      const h = 8 + Math.round(4 * Math.sin(x / 19));
      g.fillRect(x, HZ - h, 1, h);
    }
    for (let i = 0; i < 16; i++) {
      const x = 8 + i * 20 + Math.floor(R() * 10),
        h = 22 + Math.floor(R() * 20);
      tri(g, x, HZ - h, h, B.far, 0.5);
      g.fillStyle = "#2a1d14";
      g.fillRect(x - 1, HZ - 2, 2, 3);
    }
  },
  grove(g, B, R) {
    g.fillStyle = "#e9e2ff";
    g.fillRect(52, 14, 8, 8);
    g.fillRect(50, 16, 12, 4);
    g.fillRect(54, 12, 4, 12);
    g.fillStyle = B.far;
    for (let i = 0; i < 12; i++) {
      const x = i * 28 + Math.floor(R() * 12),
        r = 10 + Math.floor(R() * 8),
        cy = HZ - r - 4;
      for (let yy = -r; yy <= r; yy++) {
        const w = Math.round(Math.sqrt(r * r - yy * yy)) * 2;
        g.fillRect(x - w / 2, cy + yy, w, 1);
      }
      g.fillRect(x - 1, HZ - 6, 3, 6);
    }
  },
  tombs(g, B) {
    g.fillStyle = "#e8e4d0";
    for (let yy = -11; yy <= 11; yy++) {
      const w = Math.round(Math.sqrt(121 - yy * yy)) * 2;
      g.fillRect(252 - w / 2, 26 + yy, w, 1);
    }
    g.fillStyle = B.sky[0];
    for (let yy = -9; yy <= 9; yy++) {
      const w = Math.round(Math.sqrt(81 - yy * yy)) * 2;
      g.fillRect(258 - w / 2, 23 + yy, w, 1);
    }
    g.fillStyle = B.far;
    for (let x = 0; x < SW; x++) {
      const h = 6 + Math.round(3 * Math.sin(x / 15));
      g.fillRect(x, HZ - h, 1, h);
    }
  },
  pillars(g, B, R) {
    g.fillStyle = shade(B.far, 0.2);
    for (let x = 0; x < SW; x++) {
      const h = 5 + Math.round(2 * Math.sin(x / 12));
      g.fillRect(x, HZ - h, 1, h);
    }
    for (let i = 0; i < 7; i++) {
      const x = 10 + i * 46 + Math.floor(R() * 10),
        h = 26 + Math.floor(R() * 34);
      g.fillStyle = B.far;
      g.fillRect(x, HZ - h, 12, h);
      g.fillRect(x - 2, HZ - 4, 16, 4);
      g.fillStyle = shade(B.far, 0.2);
      g.fillRect(x + 2, HZ - h, 2, h - 4);
      g.fillRect(x + 7, HZ - h, 1, h - 4);
      g.fillStyle = B.sky[2];
      g.fillRect(x + 8 + Math.floor(R() * 3), HZ - h, 4, 3); // broken top
      if (R() < 0.5) {
        g.fillStyle = B.far;
        g.fillRect(x - 2, HZ - h - 3, 16, 3);
      }
    }
  },
  mountains(g, B) {
    [
      [50, 58],
      [130, 72],
      [215, 62],
      [295, 54],
    ].forEach(([x, h]) => {
      tri(g, x, HZ - h, h, B.far, 1.6);
      tri(g, x, HZ - h, Math.round(h * 0.28), "#f4f7fb", 1.6);
    });
    g.fillStyle = shade(B.far, -0.15);
    for (let x = 0; x < SW; x++) {
      const h = 10 + Math.round(5 * Math.sin(x / 21 + 2));
      g.fillRect(x, HZ - h, 1, h);
    }
  },
  crags(g, B, R) {
    for (let i = 0; i < 9; i++) {
      const x = 12 + i * 36 + Math.floor(R() * 14),
        h = 30 + Math.floor(R() * 46);
      tri(g, x, HZ - h, h, B.far, 0.45 + R() * 0.25);
    }
    g.fillStyle = "#f7e9c4";
    for (let yy = -9; yy <= 9; yy++) {
      const w = Math.round(Math.sqrt(81 - yy * yy)) * 2;
      g.fillRect(160 - w / 2, 40 + yy, w, 1);
    }
  },
  lava(g, B, R) {
    for (let i = 0; i < 18; i++) {
      const x = i * 19 + Math.floor(R() * 8),
        h = 8 + Math.floor(R() * 22);
      g.fillStyle = "#0e0507";
      for (let r = 0; r < h; r++) {
        const w = Math.max(1, Math.round((h - r) * 0.5));
        g.fillRect(Math.round(x - w / 2), r, w, 1);
      }
    }
    g.fillStyle = B.far;
    for (let x = 0; x < SW; x++) {
      const h = 10 + Math.round(6 * Math.sin(x / 13) + 3 * Math.sin(x / 5));
      g.fillRect(x, HZ - h, 1, h);
    }
    g.fillStyle = "#ff5a1a";
    g.fillRect(0, HZ - 3, SW, 3);
    g.fillStyle = "#ffb43a";
    for (let x = 0; x < SW; x += 3) g.fillRect(x, HZ - 2, 1, 1);
  },
};
export function drawTombs(g, R) {
  for (let i = 0; i < 6; i++) {
    const x = 18 + i * 52 + Math.floor(R() * 14),
      y = HZ + 4 + Math.floor(R() * 8);
    if (x > 170 && x < 300) continue;
    g.fillStyle = "#2a2638";
    g.fillRect(x - 1, y - 1, 10, 13);
    g.fillStyle = "#6a6580";
    g.fillRect(x, y + 1, 8, 10);
    g.fillRect(x + 1, y, 6, 1);
    g.fillStyle = "#4a4560";
    g.fillRect(x + 3, y + 3, 2, 5);
    g.fillRect(x + 2, y + 4, 4, 1);
  }
}
export function ambient(g, key, now) {
  if (RM) return;
  if (key === "grove") {
    for (let i = 0; i < 14; i++) {
      const x = (i * 47 + Math.sin(now / 1300 + i) * 18 + 320) % SW;
      const y = 70 + ((i * 29) % 70) + Math.sin(now / 900 + i * 2) * 6;
      if (Math.sin(now / 400 + i * 3) > -0.2) {
        g.fillStyle = "#e8ff8a";
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  } else if (key === "lair") {
    for (let i = 0; i < 18; i++) {
      const life = ((now / 30 + i * 53) % 120) / 120;
      const x = (i * 37 + Math.sin(now / 700 + i) * 6) % SW;
      const y = HZ + 70 - life * 150;
      g.fillStyle = life < 0.6 ? "#ffb43a" : "#ff5a1a";
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  } else if (key === "crypt") {
    g.fillStyle = "rgba(200,200,230,0.10)";
    const off = (now / 60) % SW;
    g.fillRect(Math.round(off) - 80, HZ + 2, 120, 4);
    g.fillRect(Math.round((off * 0.7 + 160) % SW) - 60, HZ + 10, 90, 3);
  }
}
