import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS,
  CHARSETS,
  DEFAULT_PASSWORD,
  generatePassphrase,
  generatePassword,
  parseWordlist,
  passphraseBits,
  passwordBits,
  randomIndex,
  type RandomSource,
} from "./generate.ts";
import effList from "./eff_large_wordlist.txt?raw";

/** A random source that returns these values in turn. */
function scripted(...values: number[]): RandomSource {
  return (array) => {
    array[0] = values.shift()!;
    return array;
  };
}

describe("randomIndex", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const n = 1 + (i % 97);
      const value = randomIndex(n);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(n);
    }
  });
  it("draws again above the last whole multiple of n", () => {
    // n = 3: 2^32 % 3 = 1, so 2^32 - 1 is refused and the next value is used.
    expect(randomIndex(3, scripted(2 ** 32 - 1, 7))).toBe(1);
  });
  it("refuses impossible ranges", () => {
    expect(() => randomIndex(0)).toThrow(RangeError);
  });
});

describe("generatePassword", () => {
  it("has the length asked for, within limits", () => {
    expect(generatePassword({ ...DEFAULT_PASSWORD, length: 32 })).toHaveLength(32);
    expect(generatePassword({ ...DEFAULT_PASSWORD, length: 2 })).toHaveLength(8);
    expect(generatePassword({ ...DEFAULT_PASSWORD, length: 1000 })).toHaveLength(128);
  });
  it("uses only the chosen sets, and each of them", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({
        length: 8,
        sets: { lower: false, upper: true, digits: true, symbols: false },
        avoidAmbiguous: false,
      });
      expect(password).toMatch(/^[A-Z0-9]{8}$/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });
  it("can leave out look-alike characters", () => {
    const passwords = Array.from({ length: 200 }, () =>
      generatePassword({ ...DEFAULT_PASSWORD, length: 64, avoidAmbiguous: true }),
    ).join("");
    for (const c of AMBIGUOUS) expect(passwords).not.toContain(c);
  });
  it("needs at least one set", () => {
    expect(() =>
      generatePassword({ ...DEFAULT_PASSWORD, sets: { lower: false, upper: false, digits: false, symbols: false } }),
    ).toThrow(/at least one/);
  });
  it("counts bits", () => {
    const size = Object.values(CHARSETS).join("").length;
    expect(passwordBits(DEFAULT_PASSWORD)).toBeCloseTo(20 * Math.log2(size));
  });
});

describe("passphrases", () => {
  const list = parseWordlist("11111\tabacus\n11112\tabdomen\r\n11113\tabdominal\n\n");

  it("reads the EFF list format", () => {
    expect(list).toEqual(["abacus", "abdomen", "abdominal"]);
  });
  it("has the EFF's 7,776 different words", () => {
    const words = parseWordlist(effList);
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);
  });
  it("joins the number of words asked for", () => {
    const phrase = generatePassphrase({ words: 6, separator: "-", capitalize: false, number: false }, list);
    expect(phrase.split("-")).toHaveLength(6);
    for (const word of phrase.split("-")) expect(list).toContain(word);
  });
  it("capitalizes and adds a digit", () => {
    const phrase = generatePassphrase({ words: 4, separator: " ", capitalize: true, number: true }, list);
    expect(phrase.split(" ").every((w) => /^[A-Z][a-z]+\d?$/.test(w))).toBe(true);
    expect(phrase.match(/\d/g)).toHaveLength(1);
  });
  it("counts bits", () => {
    expect(passphraseBits({ words: 5, separator: "-", capitalize: false, number: false }, 7776)).toBeCloseTo(
      5 * Math.log2(7776),
    );
  });
});
