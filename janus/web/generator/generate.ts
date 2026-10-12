// Password and passphrase generation. All randomness comes from crypto.getRandomValues, and
// picking from n choices uses rejection sampling, so no choice is more likely than another
// (plain `random % n` would favour the first few when 2^32 isn't a multiple of n).

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!#$%&()*+,-./:;<=>?@[]^_{|}~",
} as const;
export type Charset = keyof typeof CHARSETS;

/** Characters easily confused with one another when read or typed by hand. */
export const AMBIGUOUS = "Il1O0o|";

export interface PasswordOptions {
  length: number;
  sets: Record<Charset, boolean>;
  avoidAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  /** add a digit to one of the words */
  number: boolean;
}

export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;
export const PASSPHRASE_WORDS = { min: 3, max: 10 } as const;

export const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  sets: { lower: true, upper: true, digits: true, symbols: true },
  avoidAmbiguous: false,
};
export const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 5, separator: "-", capitalize: false, number: false };

/** Fills an array with random 32-bit numbers. Replaceable in tests. */
export type RandomSource = (array: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;
const cryptoRandom: RandomSource = (array) => crypto.getRandomValues(array);

/** A uniformly random whole number from 0 to n - 1. */
export function randomIndex(n: number, random: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`Can't pick from ${n} choices`);
  // The largest multiple of n that fits in 32 bits: values at or above it are drawn again.
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = random(buffer)[0]!;
    if (value < limit) return value % n;
  }
}

/** The characters each chosen set contributes. */
function chosenSets(options: PasswordOptions): string[] {
  return (Object.keys(CHARSETS) as Charset[])
    .filter((name) => options.sets[name])
    .map((name) =>
      options.avoidAmbiguous ? [...CHARSETS[name]].filter((c) => !AMBIGUOUS.includes(c)).join("") : CHARSETS[name],
    );
}

/** A random password with at least one character of every chosen set. */
export function generatePassword(options: PasswordOptions, random: RandomSource = cryptoRandom): string {
  const sets = chosenSets(options);
  if (sets.length === 0) throw new RangeError("Choose at least one kind of character");
  const length = Math.min(Math.max(options.length, PASSWORD_LENGTH.min, sets.length), PASSWORD_LENGTH.max);
  const all = sets.join("");
  const chars = sets.map((set) => set[randomIndex(set.length, random)]!);
  while (chars.length < length) chars.push(all[randomIndex(all.length, random)]!);
  // Shuffle (Fisher–Yates), so the guaranteed characters aren't always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** About how many bits of randomness a password with these options has. */
export function passwordBits(options: PasswordOptions): number {
  const size = chosenSets(options).join("").length;
  return size === 0 ? 0 : options.length * Math.log2(size);
}

/** The words of the EFF's word list file ("11111\tabacus" per line). */
export function parseWordlist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).pop() ?? "")
    .filter(Boolean);
}

/** A random passphrase: words from the list, joined by the separator. */
export function generatePassphrase(
  options: PassphraseOptions,
  wordlist: readonly string[],
  random: RandomSource = cryptoRandom,
): string {
  const count = Math.min(Math.max(options.words, PASSPHRASE_WORDS.min), PASSPHRASE_WORDS.max);
  const words = Array.from({ length: count }, () => {
    const word = wordlist[randomIndex(wordlist.length, random)]!;
    return options.capitalize ? word[0]!.toUpperCase() + word.slice(1) : word;
  });
  if (options.number) {
    const at = randomIndex(count, random);
    words[at] += String(randomIndex(10, random));
  }
  return words.join(options.separator);
}

/** About how many bits of randomness a passphrase with these options has. */
export function passphraseBits(options: PassphraseOptions, listSize: number): number {
  return options.words * Math.log2(listSize) + (options.number ? Math.log2(10 * options.words) : 0);
}

/** How a number of bits reads to people. */
export function strength(bits: number): "weak" | "fair" | "strong" | "very strong" {
  if (bits < 50) return "weak";
  if (bits < 70) return "fair";
  if (bits < 100) return "strong";
  return "very strong";
}
