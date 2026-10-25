import { afterEach, describe, expect, it, vi } from "vitest";

// sound.js remembers the volume once read, so each test loads a fresh copy.
async function fresh() {
  vi.resetModules();
  return import("./sound.js");
}
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the sounds", () => {
  it("are well formed and short", async () => {
    const { SFX, lengthOf } = await fresh();
    for (const [name, steps] of Object.entries(SFX)) {
      expect(steps.length, name).toBeGreaterThan(0);
      for (const s of steps) {
        expect(["square", "triangle", "sawtooth", "noise"], name).toContain(s.wave);
        for (const k of ["f0", "f1", "len", "vol"])
          expect(s[k] > 0 && Number.isFinite(s[k]), `${name}.${k}`).toBe(true);
        expect(s.at >= 0, name).toBe(true);
      }
      expect(lengthOf(name), name).toBeLessThan(2500);
    }
  });
  it("name notes by their pitch", async () => {
    const { hz } = await fresh();
    expect(hz("A4")).toBe(440);
    expect(hz("C5")).toBeCloseTo(523.25, 1);
    expect(hz("Eb4")).toBeCloseTo(311.13, 1);
  });
  it("play quietly where there is no Web Audio", async () => {
    const { play } = await fresh();
    expect(() => play("victory")).not.toThrow();
    expect(() => play("no such sound")).not.toThrow();
  });
});

describe("the volume", () => {
  it("starts at 60", async () => {
    const { volume } = await fresh();
    expect(volume()).toBe(60);
  });
  it("is remembered in this browser, between 0 and 100", async () => {
    let m = await fresh();
    m.setVolume(35);
    m = await fresh();
    expect(m.volume()).toBe(35);
    m.setVolume(250);
    expect(m.volume()).toBe(100);
    m.setVolume(-4);
    expect(m.volume()).toBe(0);
  });
  it("falls back to 60 when the stored value is broken or storage is blocked", async () => {
    localStorage.setItem("saga.volume", "loud");
    expect((await fresh()).volume()).toBe(60);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect((await fresh()).volume()).toBe(60);
  });
});
