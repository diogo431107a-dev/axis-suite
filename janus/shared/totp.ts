// Time-based one-time passwords (RFC 6238, on top of HOTP, RFC 4226), the otpauth:// URIs that
// sites hand out as QR codes, and the base32 their secrets are written in (RFC 4648).
// Uses no Node or DOM APIs beyond WebCrypto, so the server and the page share it: the server makes
// the codes for stored entries, the page previews a code while a TOTP is being set up.

export const TOTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

/** Everything needed to make codes, as stored (sealed) with an entry. */
export interface TotpParams {
  /** base32, upper case, no spaces or padding */
  secret: string;
  algorithm: TotpAlgorithm;
  /** 6 to 8 */
  digits: number;
  /** seconds each code lasts */
  period: number;
  /** who issued it, e.g. "GitHub" (may be empty) */
  issuer: string;
  /** the account at the issuer, e.g. "alice@example.com" (may be empty) */
  label: string;
}

export const TOTP_DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 } as const;
const MAX_PERIOD = 3600;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A secret as people type it ("jbsw y3dp-ehpk 3pxp====") in canonical form ("JBSWY3DPEHPK3PXP"). */
export function normalizeSecret(secret: string): string {
  return secret.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

/** Decodes base32 (any case; spaces, hyphens and padding are ignored). Throws on other characters. */
export function decodeBase32(text: string): Uint8Array<ArrayBuffer> {
  const clean = normalizeSecret(text);
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`"${char}" is not a base32 character`);
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >>> bits) & 0xff;
    }
  }
  return out;
}

/** Encodes bytes as base32 without padding, as otpauth:// URIs carry it. */
export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

const HASH = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" } as const;

/** The HOTP code for one counter value (RFC 4226 section 5.3). */
export async function hotp(
  key: Uint8Array<ArrayBuffer>,
  counter: number,
  digits: number,
  algorithm: TotpAlgorithm,
): Promise<string> {
  // The counter is 8 bytes, big-endian. Past 2^32 (T = 20000000000 in RFC 6238's tests) it needs both halves.
  const message = new DataView(new ArrayBuffer(8));
  message.setUint32(0, Math.floor(counter / 2 ** 32));
  message.setUint32(4, counter >>> 0);
  const hmacKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: HASH[algorithm] }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, message));
  // Dynamic truncation: the low 4 bits of the last byte pick where 31 bits are read from.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface TotpCode {
  code: string;
  /** seconds each code lasts */
  period: number;
  /** seconds until this code is replaced (1 to period) */
  remaining: number;
}

/** The code at `now` (milliseconds since 1970). */
export async function totp(params: TotpParams, now: number = Date.now()): Promise<TotpCode> {
  const seconds = Math.floor(now / 1000);
  const counter = Math.floor(seconds / params.period);
  const code = await hotp(decodeBase32(params.secret), counter, params.digits, params.algorithm);
  return { code, period: params.period, remaining: params.period - (seconds % params.period) };
}

/** Checks parameters from anywhere (a form, an import). Returns them cleaned up, or what is wrong. */
export function checkTotpParams(p: {
  secret: string;
  algorithm?: string;
  digits?: number;
  period?: number;
  issuer?: string;
  label?: string;
}): TotpParams | string {
  const secret = normalizeSecret(p.secret);
  if (!secret) return "The secret key is empty";
  if (![...secret].every((c) => ALPHABET.includes(c))) {
    return "The secret key must be base32: letters A–Z and digits 2–7";
  }
  if (decodeBase32(secret).length === 0) return "The secret key is too short";
  const algorithm = (p.algorithm ?? TOTP_DEFAULTS.algorithm).toUpperCase().replace("-", "");
  if (!(TOTP_ALGORITHMS as readonly string[]).includes(algorithm)) {
    return `Unknown algorithm "${p.algorithm}" (use SHA1, SHA256 or SHA512)`;
  }
  const digits = p.digits ?? TOTP_DEFAULTS.digits;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) return "Codes must have 6, 7 or 8 digits";
  const period = p.period ?? TOTP_DEFAULTS.period;
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) {
    return `The period must be a whole number of seconds from 1 to ${MAX_PERIOD}`;
  }
  return {
    secret,
    algorithm: algorithm as TotpAlgorithm,
    digits,
    period,
    issuer: (p.issuer ?? "").trim(),
    label: (p.label ?? "").trim(),
  };
}

/** Reads an otpauth://totp/… URI (Google Authenticator's key URI format). Returns the parameters or what is wrong. */
export function parseOtpauth(uri: string): TotpParams | string {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return "Not a valid otpauth:// link";
  }
  if (url.protocol !== "otpauth:") return "Not an otpauth:// link";
  if (url.hostname === "hotp") return "Counter-based codes (HOTP) are not supported, only time-based ones (TOTP)";
  if (url.hostname !== "totp") return "Not a TOTP link";

  // The label is "Issuer:account", "Issuer: account" or just "account". The separator is the first
  // literal colon (so an encoded one, %3A, can be part of the issuer), or else the first encoded one.
  const raw = url.pathname.replace(/^\//, "");
  let labelIssuer: string;
  let label: string;
  try {
    const literal = raw.indexOf(":");
    if (literal >= 0) {
      labelIssuer = decodeURIComponent(raw.slice(0, literal));
      label = decodeURIComponent(raw.slice(literal + 1));
    } else {
      const path = decodeURIComponent(raw);
      const colon = path.indexOf(":");
      labelIssuer = colon >= 0 ? path.slice(0, colon) : "";
      label = colon >= 0 ? path.slice(colon + 1) : path;
    }
  } catch {
    return "The link's label is not properly encoded";
  }

  const q = url.searchParams;
  const secret = q.get("secret");
  if (!secret) return "The link has no secret";
  const number = (name: string) => {
    const value = q.get(name);
    return value === null ? undefined : /^\d+$/.test(value) ? Number(value) : NaN;
  };
  return checkTotpParams({
    secret,
    algorithm: q.get("algorithm") ?? undefined,
    digits: number("digits"),
    period: number("period"),
    issuer: q.get("issuer") ?? labelIssuer,
    label,
  });
}

/** Writes the parameters as an otpauth:// URI, to move the TOTP to another authenticator. */
export function formatOtpauth(p: TotpParams): string {
  const label = p.issuer
    ? `${encodeURIComponent(p.issuer)}:${encodeURIComponent(p.label)}`
    : encodeURIComponent(p.label);
  const query = new URLSearchParams({ secret: p.secret });
  if (p.issuer) query.set("issuer", p.issuer);
  query.set("algorithm", p.algorithm);
  query.set("digits", String(p.digits));
  query.set("period", String(p.period));
  return `otpauth://totp/${label}?${query}`;
}

/** What someone pastes into the TOTP field: an otpauth:// link, or just the secret key (default settings). */
export function parseTotpInput(input: string): TotpParams | string {
  const text = input.trim();
  if (/^otpauth:/i.test(text)) return parseOtpauth(text);
  return checkTotpParams({ secret: text });
}
