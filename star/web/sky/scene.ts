// Draws the sky and answers the pointer: the starfield on a canvas, the constellations in SVG, pan,
// zoom, pinch and drag. This isn't React, because the layout moves every star on every frame.
// Page styles go through element.style, never a style attribute, which the suite's CSP refuses.
import type { SkyChange, SkyStore } from "./store.ts";
import { step, type Motions } from "./layout.ts";
import { PALETTE, colourOf, descendants, hueOf, isMain, nameOf, phraseText, relationOf } from "./model.ts";

const NS = "http://www.w3.org/2000/svg";
const TILE = 1400;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

export interface SceneEvents {
  starClicked(id: string): void;
  /** A click on empty sky. */
  skyClicked(): void;
  /** A double click on empty sky, at this place in the sky. */
  skyDoubleClicked(x: number, y: number): void;
}

export interface SceneElements {
  svg: SVGSVGElement;
  field: HTMLCanvasElement;
  tip: HTMLDivElement;
  /** The sky left visible around these is where stars are flown to. */
  bar: () => HTMLElement | null;
  panel: () => HTMLElement | null;
}

/** What the sky shows as marked. */
export interface Marks {
  selected: string | null;
  connectFrom: string | null;
  flash: string | null;
}

interface Tied {
  g: SVGGElement;
  line: SVGLineElement;
  text: SVGTextElement;
}

type Drag =
  | { type: "star"; id: string; sx: number; sy: number; moved: boolean; last: { x: number; y: number } }
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean };

interface Pinch {
  d: number;
  m: { x: number; y: number };
  v: { x: number; y: number; k: number };
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Numbers that repeat, for a starfield that is the same every time. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Speck {
  x: number;
  y: number;
  s: number;
  a: number;
  p: number;
  w: number;
  tint: string;
}

function makeDust(): Speck[] {
  const r = rng(7);
  const dust: Speck[] = [];
  for (let i = 0; i < 520; i++) {
    const big = r() < 0.06;
    dust.push({
      x: r() * TILE,
      y: r() * TILE,
      s: big ? 1.4 + r() * 0.8 : 0.5 + r() * 0.8,
      a: big ? 0.55 + r() * 0.35 : 0.15 + r() * 0.4,
      p: r() * Math.PI * 2,
      w: 0.4 + r() * 1.4,
      tint: r() < 0.2 ? (r() < 0.5 ? "255,228,190" : "190,210,255") : "230,232,255",
    });
  }
  return dust;
}

export class Scene {
  private readonly store: SkyStore;
  private readonly elements: SceneElements;
  private readonly events: SceneEvents;
  private readonly reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly mobile = matchMedia("(max-width: 767px)");
  private readonly stopListening = new AbortController();
  private readonly unsubscribe: () => void;

  private readonly world = el("g");
  private readonly bridgesG = el("g");
  private readonly tiesG = el("g");
  private readonly starsG = el("g");
  private starEls = new Map<string, { g: SVGGElement; label: SVGTextElement }>();
  private tieEls = new Map<string, Tied>();
  private bridgeEls = new Map<string, Tied>();
  private marks: Marks = { selected: null, connectFrom: null, flash: null };

  private readonly view = { x: 0, y: 0, k: 1 };
  private viewFrame: number | null = null;

  private readonly motions: Motions = new Map();
  private alpha = 0;
  private running = false;
  private layoutFrame: number | null = null;

  private readonly fctx: CanvasRenderingContext2D;
  private readonly dust = makeDust();
  private fieldDirty = true;
  private fieldWidth = 0;
  private fieldHeight = 0;
  private fieldFrame: number | null = null;
  private fieldDrawnAt = 0;

  private drag: Drag | null = null;
  private pinch: Pinch | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(store: SkyStore, elements: SceneElements, events: SceneEvents) {
    this.store = store;
    this.elements = elements;
    this.events = events;
    this.fctx = elements.field.getContext("2d")!;

    const { svg } = elements;
    const defs = el("defs");
    PALETTE.forEach((colour, i) => {
      const glow = el("radialGradient", { id: `glow${i}` });
      for (const [offset, opacity] of [
        [0, 0.55],
        [0.28, 0.2],
        [0.6, 0.06],
        [1, 0],
      ] as const) {
        glow.append(el("stop", { offset, "stop-color": colour, "stop-opacity": opacity }));
      }
      defs.append(glow);
    });
    this.world.append(this.bridgesG, this.tiesG, this.starsG);
    svg.replaceChildren(defs, this.world);

    const { signal } = this.stopListening;
    svg.addEventListener("pointerdown", (e) => this.pointerDown(e), { signal });
    svg.addEventListener("pointermove", (e) => this.pointerMove(e), { signal });
    svg.addEventListener("pointerup", (e) => this.pointerEnd(e), { signal });
    svg.addEventListener("pointercancel", (e) => this.pointerEnd(e), { signal });
    svg.addEventListener(
      "pointerleave",
      () => {
        if (!this.drag) elements.tip.hidden = true;
      },
      { signal },
    );
    svg.addEventListener("dblclick", (e) => this.doubleClick(e), { signal });
    svg.addEventListener("wheel", (e) => this.wheel(e), { passive: false, signal });
    window.addEventListener("resize", () => this.sizeField(), { signal });

    this.unsubscribe = store.subscribe((change) => this.storeChanged(change));
    this.sizeField();
    this.rebuild();
    this.fit(true);
    this.fieldFrame = requestAnimationFrame((t) => this.fieldLoop(t));
  }

  destroy(): void {
    this.stopListening.abort();
    this.unsubscribe();
    for (const frame of [this.viewFrame, this.layoutFrame, this.fieldFrame]) {
      if (frame !== null) cancelAnimationFrame(frame);
    }
    this.running = false;
    this.elements.svg.replaceChildren();
  }

  // ---- Drawing -------------------------------------------------------------------------------

  private storeChanged(change: SkyChange): void {
    if (change.kind === "structure") {
      this.rebuild();
      return;
    }
    const star = this.store.index.byId.get(change.id);
    if (!star) return;
    const label = this.starEls.get(star.id)?.label;
    if (label) label.textContent = isMain(star) ? nameOf(star).toUpperCase() : nameOf(star);
    const tie = this.tieEls.get(star.id)?.text;
    if (tie) tie.textContent = relationOf(star).toUpperCase();
  }

  private tied(className: string, words: string): Tied {
    const g = el("g", { class: className });
    const line = el("line");
    const text = el("text");
    text.textContent = words;
    g.append(line, text);
    return { g, line, text };
  }

  private rebuild(): void {
    const { stars, links, index } = this.store;
    this.tiesG.textContent = "";
    this.bridgesG.textContent = "";
    this.starsG.textContent = "";
    this.starEls = new Map();
    this.tieEls = new Map();
    this.bridgeEls = new Map();

    for (const s of stars) {
      if (isMain(s)) continue;
      const tie = this.tied("tie", relationOf(s).toUpperCase());
      this.tiesG.append(tie.g);
      this.tieEls.set(s.id, tie);
    }
    for (const l of links) {
      const bridge = this.tied("bridge", (l.relation || "related").toUpperCase());
      this.bridgesG.append(bridge.g);
      this.bridgeEls.set(l.id, bridge);
    }
    stars.forEach((s, i) => {
      const main = isMain(s);
      const depth = index.depth.get(s.id) ?? 0;
      const colour = colourOf(index, s.id);
      const g = el("g", { class: `star${main ? " main" : ""}`, "data-id": s.id });
      const body = el("g", { class: "body" });
      const halo = el("circle", {
        class: "halo",
        r: main ? 46 : depth === 1 ? 19 : 14,
        fill: `url(#glow${hueOf(index, s.id)})`,
      });
      halo.style.setProperty("--d", `${(-(i * 1.37) % 6).toFixed(2)}s`);
      body.append(halo);
      if (main) {
        body.append(el("path", { class: "spikes", d: "M-28 0H28M0 -28V28", stroke: colour }));
        body.append(el("path", { class: "spikes minor", d: "M-10 -10L10 10M-10 10L10 -10", stroke: colour }));
      }
      body.append(
        el("circle", { class: "core", r: main ? 6 : depth === 1 ? 4.2 : depth === 2 ? 3.3 : 2.7, fill: colour }),
      );
      body.append(el("circle", { class: "ring", r: main ? 17 : 9.5 }));
      body.append(el("circle", { class: "hit", r: main ? 24 : 14 }));
      const label = el("text", { class: "name", y: main ? 40 : 21 });
      label.textContent = main ? nameOf(s).toUpperCase() : nameOf(s);
      g.append(body, label);
      this.starsG.append(g);
      this.starEls.set(s.id, { g, label });
    });
    this.applyMarks();
    this.updatePositions();
  }

  private updatePositions(): void {
    const { stars, links, index } = this.store;
    for (const s of stars) {
      this.starEls.get(s.id)?.g.setAttribute("transform", `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`);
    }
    this.tieEls.forEach((tie, id) => {
      const s = index.byId.get(id);
      const p = s?.parent != null ? index.byId.get(s.parent) : undefined;
      if (s && p) this.setLine(tie, p, s);
    });
    for (const l of links) {
      const bridge = this.bridgeEls.get(l.id);
      const a = index.byId.get(l.a);
      const b = index.byId.get(l.b);
      if (bridge && a && b) this.setLine(bridge, a, b);
    }
  }

  private setLine(tie: Tied, a: { x: number; y: number }, b: { x: number; y: number }): void {
    tie.line.setAttribute("x1", String(a.x));
    tie.line.setAttribute("y1", String(a.y));
    tie.line.setAttribute("x2", String(b.x));
    tie.line.setAttribute("y2", String(b.y));
    tie.text.setAttribute("x", ((a.x + b.x) / 2).toFixed(1));
    tie.text.setAttribute("y", ((a.y + b.y) / 2 + 3).toFixed(1));
  }

  setMarks(marks: Marks): void {
    this.marks = marks;
    this.applyMarks();
  }

  private applyMarks(): void {
    const { selected, connectFrom, flash } = this.marks;
    const { index, links } = this.store;
    // The ties from the selected star back to its main star.
    const path = new Set<string>();
    for (let s = selected ? index.byId.get(selected) : undefined; s;) {
      path.add(s.id);
      s = s.parent !== null ? index.byId.get(s.parent) : undefined;
    }
    this.starEls.forEach((e, id) => {
      e.g.classList.toggle("selected", id === selected);
      e.g.classList.toggle("source", id === connectFrom);
      e.g.classList.toggle("born", id === flash);
    });
    this.tieEls.forEach((e, id) => e.g.classList.toggle("path", path.has(id)));
    for (const l of links) {
      this.bridgeEls.get(l.id)?.g.classList.toggle("path", l.a === selected || l.b === selected);
    }
    this.elements.svg.classList.toggle("connecting", connectFrom !== null);
  }

  // ---- Layout --------------------------------------------------------------------------------

  /** Starts the layout, or gives it more energy. When it comes to rest, moved stars are saved. */
  kick(energy = 0.6): void {
    this.alpha = Math.max(this.alpha, energy);
    if (this.running) return;
    this.running = true;
    const loop = () => {
      const { stars, links, index } = this.store;
      step(stars, links, index, this.motions, this.alpha);
      this.alpha *= 0.985;
      this.updatePositions();
      if (this.alpha > 0.012 || this.drag) {
        this.layoutFrame = requestAnimationFrame(loop);
      } else {
        this.running = false;
        this.layoutFrame = null;
        this.store.savePositions();
      }
    };
    this.layoutFrame = requestAnimationFrame(loop);
  }

  // ---- View ----------------------------------------------------------------------------------

  private applyView(): void {
    const { view } = this;
    this.elements.svg.style.setProperty("--ls", Math.pow(Math.max(1, 1 / view.k), 0.7).toFixed(3));
    this.world.setAttribute(
      "transform",
      `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(4)})`,
    );
    this.fieldDirty = true;
  }

  private toWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.elements.svg.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.k, y: (cy - r.top - this.view.y) / this.view.k };
  }

  private zoomAt(px: number, py: number, factor: number): void {
    const { view } = this;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
    const wx = (px - view.x) / view.k;
    const wy = (py - view.y) / view.k;
    view.k = k;
    view.x = px - wx * k;
    view.y = py - wy * k;
    this.applyView();
  }

  /** Zooms about the middle of the visible sky. */
  zoomBy(factor: number): void {
    const b = this.visibleBox();
    this.zoomAt(b.x0 + b.w / 2, b.y0 + b.h / 2, factor);
  }

  /** The part of the screen not under the bar and the panel. */
  private visibleBox(): { x0: number; y0: number; w: number; h: number } {
    const r = this.elements.svg.getBoundingClientRect();
    const bar = this.elements.bar()?.offsetHeight ?? 0;
    const panel = this.elements.panel();
    let w = r.width;
    let h = r.height - bar;
    if (this.mobile.matches) h -= panel?.offsetHeight ?? 0;
    else w -= (panel?.offsetWidth ?? 0) + 32;
    return { x0: 0, y0: bar, w: Math.max(w, 120), h: Math.max(h, 120) };
  }

  /** The place in the sky at the middle of what is visible. */
  visibleCentre(): { x: number; y: number } {
    const b = this.visibleBox();
    const r = this.elements.svg.getBoundingClientRect();
    return this.toWorld(r.left + b.x0 + b.w / 2, r.top + b.y0 + b.h / 2);
  }

  private animateView(tx: number, ty: number, tk: number): void {
    const { view } = this;
    if (this.viewFrame !== null) cancelAnimationFrame(this.viewFrame);
    this.viewFrame = null;
    if (this.reduceMotion) {
      view.x = tx;
      view.y = ty;
      view.k = tk;
      this.applyView();
      return;
    }
    const from = { ...view };
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 650);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view.x = from.x + (tx - from.x) * e;
      view.y = from.y + (ty - from.y) * e;
      view.k = from.k + (tk - from.k) * e;
      this.applyView();
      this.viewFrame = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.viewFrame = requestAnimationFrame(tick);
  }

  /** Shows the whole sky. An empty one is centred, so the first star lands in view. */
  fit(instant = false): void {
    const { stars } = this.store;
    const b = this.visibleBox();
    let tx = b.x0 + b.w / 2;
    let ty = b.y0 + b.h / 2;
    let k = 1;
    if (stars.length > 0) {
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const s of stars) {
        x1 = Math.min(x1, s.x);
        y1 = Math.min(y1, s.y);
        x2 = Math.max(x2, s.x);
        y2 = Math.max(y2, s.y);
      }
      const pad = 90;
      k = Math.min(1.3, Math.max(MIN_ZOOM, Math.min(b.w / (x2 - x1 + pad * 2), b.h / (y2 - y1 + pad * 2))));
      tx -= ((x1 + x2) / 2) * k;
      ty -= ((y1 + y2) / 2) * k;
    }
    if (instant) {
      this.view.x = tx;
      this.view.y = ty;
      this.view.k = k;
      this.applyView();
    } else {
      this.animateView(tx, ty, k);
    }
  }

  flyTo(id: string): void {
    const s = this.store.index.byId.get(id);
    if (!s) return;
    const b = this.visibleBox();
    const k = Math.max(this.view.k, 1.05);
    this.animateView(b.x0 + b.w / 2 - s.x * k, b.y0 + b.h / 2 - s.y * k, k);
  }

  // ---- Starfield -----------------------------------------------------------------------------

  private sizeField(): void {
    const { field } = this.elements;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.fieldWidth = field.clientWidth;
    this.fieldHeight = field.clientHeight;
    field.width = this.fieldWidth * dpr;
    field.height = this.fieldHeight * dpr;
    this.fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fieldDirty = true;
  }

  private drawField(t: number): void {
    const { fctx, view, fieldWidth: FW, fieldHeight: FH } = this;
    fctx.clearRect(0, 0, FW, FH);
    const ox = (((view.x * 0.12) % TILE) + TILE) % TILE;
    const oy = (((view.y * 0.12) % TILE) + TILE) % TILE;
    for (const d of this.dust) {
      const twinkle = this.reduceMotion ? 1 : 0.7 + 0.3 * Math.sin((t / 1000) * d.w + d.p);
      fctx.fillStyle = `rgba(${d.tint},${(d.a * twinkle).toFixed(3)})`;
      for (let x = d.x + ox - TILE; x < FW; x += TILE) {
        if (x < -2) continue;
        for (let y = d.y + oy - TILE; y < FH; y += TILE) {
          if (y < -2) continue;
          if (d.s > 1.3) {
            fctx.beginPath();
            fctx.arc(x, y, d.s * 0.7, 0, 6.283);
            fctx.fill();
          } else {
            fctx.fillRect(x, y, d.s, d.s);
          }
        }
      }
    }
  }

  private fieldLoop(t: number): void {
    // A page that stays open all day: the twinkling needs no more than 15 frames a second.
    const twinkleDue = !this.reduceMotion && t - this.fieldDrawnAt > 66;
    if (this.fieldDirty || twinkleDue) {
      this.drawField(t);
      this.fieldDirty = false;
      this.fieldDrawnAt = t;
    }
    this.fieldFrame = requestAnimationFrame((next) => this.fieldLoop(next));
  }

  // ---- Pointer -------------------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const { svg, tip } = this.elements;
    svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tip.hidden = true;
    if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const r = svg.getBoundingClientRect();
      if (this.drag?.type === "star") this.motions.delete(this.drag.id);
      this.drag = null;
      this.pinch = {
        d: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        m: { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top },
        v: { ...this.view },
      };
      return;
    }
    const g = (e.target as Element).closest<SVGGElement>(".star");
    this.drag = g
      ? {
          type: "star",
          id: g.dataset.id!,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          last: this.toWorld(e.clientX, e.clientY),
        }
      : { type: "pan", sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
  }

  private pointerMove(e: PointerEvent): void {
    const { svg } = this.elements;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const r = svg.getBoundingClientRect();
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const m = { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top };
      const { v } = this.pinch;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (v.k * d) / this.pinch.d));
      const wx = (this.pinch.m.x - v.x) / v.k;
      const wy = (this.pinch.m.y - v.y) / v.k;
      this.view.k = k;
      this.view.x = m.x - wx * k;
      this.view.y = m.y - wy * k;
      this.applyView();
      return;
    }
    const { drag } = this;
    if (!drag) {
      this.hover(e);
      return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
      drag.moved = true;
      if (drag.type === "pan") svg.classList.add("panning");
    }
    if (!drag.moved) return;
    if (drag.type === "pan") {
      this.view.x = drag.vx + (e.clientX - drag.sx);
      this.view.y = drag.vy + (e.clientY - drag.sy);
      this.applyView();
      return;
    }
    const { index } = this.store;
    const s = index.byId.get(drag.id);
    if (!s) return;
    const w = this.toWorld(e.clientX, e.clientY);
    const dx = w.x - drag.last.x;
    const dy = w.y - drag.last.y;
    drag.last = w;
    if (isMain(s)) {
      // A main star takes its whole constellation with it.
      for (const id of [s.id, ...descendants(index, s.id)]) {
        const t = index.byId.get(id)!;
        t.x += dx;
        t.y += dy;
      }
    } else {
      s.x += dx;
      s.y += dy;
      this.motions.set(s.id, { vx: 0, vy: 0, fx: 0, fy: 0, dragging: true });
    }
    this.updatePositions();
    this.kick(0.25);
  }

  private pointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    const { drag } = this;
    if (!drag) return;
    this.drag = null;
    this.elements.svg.classList.remove("panning");
    if (drag.type === "star") {
      this.motions.delete(drag.id);
      if (!drag.moved) this.events.starClicked(drag.id);
      else this.kick(0.35);
    } else if (!drag.moved) {
      this.events.skyClicked();
    }
  }

  private doubleClick(e: MouseEvent): void {
    // Not e.target: the pointer capture from pointerDown makes that the whole sky.
    if (document.elementFromPoint(e.clientX, e.clientY)?.closest(".star")) return;
    const w = this.toWorld(e.clientX, e.clientY);
    this.events.skyDoubleClicked(w.x, w.y);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.elements.svg.getBoundingClientRect();
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }

  private hover(e: PointerEvent): void {
    if (e.pointerType === "touch") return;
    const { tip, svg } = this.elements;
    const g = (e.target as Element).closest?.<SVGGElement>(".star");
    const s = g ? this.store.index.byId.get(g.dataset.id!) : undefined;
    if (!s) {
      tip.hidden = true;
      return;
    }
    const name = document.createElement("b");
    name.textContent = nameOf(s);
    const phrase = document.createElement("span");
    phrase.textContent = phraseText(this.store.index, s.id);
    tip.replaceChildren(name, phrase);
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    let x = e.clientX - box.left + 14;
    const y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width - 8) x = e.clientX - box.left - tip.offsetWidth - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
}
