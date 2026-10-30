/* =====================================================================
   SOUND — chiptune effects made by the browser, no sound files
   ===================================================================== */
// A note name ("C5", "Eb4", "G#5") as a pitch in Hz.
export function hz(name) {
  const [, l, acc, oct] = /^([A-G])([#b]?)(\d)$/.exec(name);
  const semi = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[l] + (acc === "#" ? 1 : acc === "b" ? -1 : 0);
  return 440 * Math.pow(2, semi / 12 + (+oct - 4));
}
const n = (wave, note, at, len, vol, to) => ({ wave, f0: hz(note), f1: to ? hz(to) : hz(note), at, len, vol });
const slide = (wave, f0, f1, at, len, vol) => ({ wave, f0, f1, at, len, vol });

// Each sound is a list of steps. wave: square, triangle, sawtooth or noise. f0 → f1 is a pitch slide
// (for noise, the filter's sweep). at and len are in ms, vol is the step's loudness at full volume.
export const SFX = {
  victory: [
    n("square", "C5", 0, 110, 0.22),
    n("square", "E5", 120, 110, 0.22),
    n("square", "G5", 240, 110, 0.22),
    n("square", "C6", 360, 900, 0.22),
    n("square", "E5", 360, 900, 0.12),
    n("square", "G5", 360, 900, 0.12),
    n("triangle", "C4", 360, 900, 0.45),
  ],
  foeDown: [slide("noise", 2400, 180, 0, 520, 0.5)],
  gameOver: [
    n("triangle", "G4", 0, 380, 0.5),
    n("triangle", "Eb4", 420, 380, 0.5),
    n("triangle", "C4", 840, 380, 0.5),
    n("triangle", "C3", 1260, 700, 0.6),
    n("square", "C3", 1260, 700, 0.08),
  ],
  buy: [n("square", "B5", 0, 70, 0.18), n("square", "E6", 70, 280, 0.18)],
  coins: [
    n("square", "E6", 0, 60, 0.14),
    n("square", "B5", 70, 60, 0.14),
    n("square", "G5", 140, 60, 0.14),
    n("square", "E5", 210, 140, 0.14),
  ],
  inn: [n("triangle", "C5", 0, 280, 0.4), n("triangle", "E5", 220, 280, 0.4), n("triangle", "G5", 440, 520, 0.4)],
  hit: [slide("noise", 3200, 700, 0, 90, 0.45), slide("square", 170, 60, 0, 120, 0.25)],
  crit: [
    slide("noise", 4200, 500, 0, 150, 0.6),
    slide("square", 220, 50, 0, 190, 0.3),
    n("square", "A6", 60, 160, 0.12),
  ],
  miss: [slide("noise", 500, 2600, 0, 170, 0.22)],
  hurt: [slide("square", 330, 110, 0, 170, 0.2)],
  spell: [
    n("triangle", "E5", 0, 100, 0.35),
    n("triangle", "G#5", 70, 100, 0.35),
    n("triangle", "B5", 140, 100, 0.35),
    n("triangle", "E6", 210, 340, 0.35),
    n("square", "E6", 210, 340, 0.06, "E7"),
  ],
  heal: [n("triangle", "G5", 0, 130, 0.4), n("triangle", "C6", 120, 280, 0.4)],
  guard: [slide("square", 1250, 1150, 0, 80, 0.12), slide("triangle", 2500, 2500, 0, 220, 0.25)],
  flee: [
    n("square", "C5", 0, 50, 0.15),
    n("square", "E5", 50, 50, 0.15),
    n("square", "G5", 100, 50, 0.15),
    n("square", "C6", 150, 90, 0.15),
  ],
  fleeFail: [slide("sawtooth", 110, 95, 0, 320, 0.22)],
  levelUp: [
    n("square", "C6", 0, 60, 0.13),
    n("square", "E6", 60, 60, 0.13),
    n("square", "G6", 120, 60, 0.13),
    n("square", "C7", 180, 280, 0.13),
    n("triangle", "C6", 180, 280, 0.3),
  ],
  vice: [n("sawtooth", "B3", 0, 180, 0.2), n("sawtooth", "F3", 180, 380, 0.2)],
  angel: [
    n("triangle", "A4", 0, 500, 0.3),
    n("triangle", "E5", 200, 500, 0.3),
    n("triangle", "A5", 400, 500, 0.3),
    n("triangle", "C#6", 600, 1100, 0.3),
    n("square", "E6", 600, 1100, 0.05),
    n("triangle", "A3", 600, 1100, 0.4),
  ],
};
// How long a sound lasts, in ms.
export const lengthOf = (name) => Math.max(...SFX[name].map((s) => s.at + s.len));

/* ---------- volume: 0–100, kept in this browser only ---------- */
const KEY = "saga.volume";
export const DEFAULT_VOLUME = 60;
let vol = null;
export function volume() {
  if (vol === null) {
    let v = NaN;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== null) v = Number(raw);
    } catch {
      // no storage: the default
    }
    vol = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_VOLUME;
  }
  return vol;
}
export function setVolume(v) {
  vol = Math.min(100, Math.max(0, Math.round(+v || 0)));
  try {
    localStorage.setItem(KEY, String(vol));
  } catch {
    // kept for this page only
  }
  if (master) master.gain.value = gainFor(vol);
}
// Squared, so the slider's steps sound even.
const gainFor = (v) => 0.5 * (v / 100) ** 2;

/* ---------- the synth ---------- */
let ac = null,
  master = null,
  noise = null;
function context() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = gainFor(volume());
    master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}
function step(c, t0, s) {
  const t = t0 + s.at / 1000,
    end = t + s.len / 1000;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(s.vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(master);
  let src, freq;
  if (s.wave === "noise") {
    src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    freq = f.frequency;
    src.connect(f);
    f.connect(g);
  } else {
    src = c.createOscillator();
    src.type = s.wave;
    freq = src.frequency;
    src.connect(g);
  }
  freq.setValueAtTime(s.f0, t);
  if (s.f1 !== s.f0) freq.exponentialRampToValueAtTime(s.f1, end);
  src.start(t);
  src.stop(end + 0.02);
}
// Plays a sound now, or `after` ms from now. Sound never gets in the game's way: with the volume at 0,
// no Web Audio, a hidden tab (where battles skip their animations) or any error, nothing plays.
export function play(name, after = 0) {
  try {
    if (!volume() || !SFX[name]) return;
    if (import.meta.env.DEV) console.debug("sfx", name);
    if (document.hidden) return;
    const c = context();
    if (!c) return;
    const t0 = c.currentTime + 0.01 + after / 1000;
    for (const s of SFX[name]) step(c, t0, s);
  } catch {
    // silent
  }
}
