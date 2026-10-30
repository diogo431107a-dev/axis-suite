// Relatives spread around their star by themselves; main stars stay where the user puts them.
import type { Link, Star } from "../../shared/protocol.ts";
import { isMain, type SkyIndex } from "./model.ts";

/** The speed and force of a star while the layout runs. Never saved. */
export interface Motion {
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  dragging: boolean;
}

export type Motions = Map<string, Motion>;

function motionOf(motions: Motions, id: string): Motion {
  let m = motions.get(id);
  if (!m) {
    m = { vx: 0, vy: 0, fx: 0, fy: 0, dragging: false };
    motions.set(id, m);
  }
  return m;
}

/** One step of the layout, moving the stars in place. `alpha` is how much energy is left. */
export function step(stars: readonly Star[], links: readonly Link[], index: SkyIndex, motions: Motions, alpha: number) {
  const n = stars.length;
  const motion = stars.map((s) => {
    const m = motionOf(motions, s.id);
    m.fx = 0;
    m.fy = 0;
    return m;
  });

  // Stars push each other apart when near.
  for (let i = 0; i < n; i++) {
    const a = stars[i]!;
    const ma = motion[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = stars[j]!;
      const mb = motion[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 90000) continue;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 0.5;
      }
      const d = Math.sqrt(d2);
      const f = 2600 / Math.max(d2, 120);
      const ux = dx / d;
      const uy = dy / d;
      ma.fx -= ux * f;
      ma.fy -= uy * f;
      mb.fx += ux * f;
      mb.fy += uy * f;
    }
  }

  // A tie pulls a star to its resting distance from its parent.
  stars.forEach((s, i) => {
    if (isMain(s)) return;
    const p = index.byId.get(s.parent!);
    if (!p) return;
    const m = motion[i]!;
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const rest = index.depth.get(s.id) === 1 ? 128 : 98;
    const f = (d - rest) * 0.06;
    m.fx -= (dx / d) * f;
    m.fy -= (dy / d) * f;
    // Lean away from the grandparent, so branches fan outward.
    const gp = p.parent !== null ? index.byId.get(p.parent) : undefined;
    if (gp) {
      const gx = s.x - gp.x;
      const gy = s.y - gp.y;
      const gd = Math.hypot(gx, gy) || 0.01;
      m.fx += (gx / gd) * 0.6;
      m.fy += (gy / gd) * 0.6;
    }
  });

  for (const l of links) {
    const a = index.byId.get(l.a);
    const b = index.byId.get(l.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const f = (d - 190) * 0.004;
    if (!isMain(a)) {
      const m = motionOf(motions, a.id);
      m.fx += (dx / d) * f;
      m.fy += (dy / d) * f;
    }
    if (!isMain(b)) {
      const m = motionOf(motions, b.id);
      m.fx -= (dx / d) * f;
      m.fy -= (dy / d) * f;
    }
    // Keep other stars clear of the connection's label.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    stars.forEach((s, i) => {
      if (isMain(s) || s === a || s === b) return;
      const sx = s.x - mx;
      const sy = s.y - my;
      const sd = Math.hypot(sx, sy) || 0.01;
      if (sd < 60) {
        const push = (60 - sd) * 0.12;
        motion[i]!.fx += (sx / sd) * push;
        motion[i]!.fy += (sy / sd) * push;
      }
    });
  }

  stars.forEach((s, i) => {
    const m = motion[i]!;
    if (isMain(s) || m.dragging) {
      m.vx = 0;
      m.vy = 0;
      return;
    }
    m.vx = (m.vx + m.fx * alpha) * 0.7;
    m.vy = (m.vy + m.fy * alpha) * 0.7;
    const speed = Math.hypot(m.vx, m.vy);
    if (speed > 24) {
      m.vx *= 24 / speed;
      m.vy *= 24 / speed;
    }
    s.x += m.vx;
    s.y += m.vy;
  });
}

/** Where a new relative starts: close to its star, in any direction. */
export function placeNear(parent: Pick<Star, "x" | "y">): { x: number; y: number } {
  const a = Math.random() * Math.PI * 2;
  return { x: parent.x + Math.cos(a) * 46, y: parent.y + Math.sin(a) * 46 };
}

/** The nearest place to (x, y) with room for a new constellation. */
export function freeSpotNear(stars: readonly Star[], x: number, y: number): { x: number; y: number } {
  for (let r = 0, angle = 0; r < 1200; r += 40, angle += 2.4) {
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (stars.every((s) => Math.hypot(s.x - px, s.y - py) > 230)) return { x: px, y: py };
  }
  return { x, y };
}
