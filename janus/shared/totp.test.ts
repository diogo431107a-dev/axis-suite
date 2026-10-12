import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  encodeBase32,
  formatOtpauth,
  parseOtpauth,
  parseTotpInput,
  totp,
  type TotpAlgorithm,
  type TotpParams,
} from "./totp.ts";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("base32 (RFC 4648 section 10)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  it.each(vectors)("%j encodes to %s", (plain, encoded) => {
    expect(encodeBase32(ascii(plain))).toBe(encoded);
  });
  it.each(vectors)("%j decodes from %s, with or without padding", (plain, encoded) => {
    expect(new TextDecoder().decode(decodeBase32(encoded))).toBe(plain);
    expect(new TextDecoder().decode(decodeBase32(encoded.padEnd(Math.ceil(encoded.length / 8) * 8, "=")))).toBe(plain);
  });
  it("ignores case, spaces and hyphens", () => {
    expect(decodeBase32("mzxw 6ytb-oi")).toEqual(decodeBase32("MZXW6YTBOI"));
  });
  it("refuses other characters", () => {
    expect(() => decodeBase32("MZXW1")).toThrow(/base32/);
  });
});

describe("totp (RFC 6238 appendix B)", () => {
  const seeds: Record<TotpAlgorithm, string> = {
    SHA1: "12345678901234567890",
    SHA256: "12345678901234567890123456789012",
    SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
  };
  const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  const params = (algorithm: TotpAlgorithm): TotpParams => ({
    secret: encodeBase32(ascii(seeds[algorithm])),
    algorithm,
    digits: 8,
    period: 30,
    issuer: "",
    label: "",
  });
  it.each(vectors)("at T=%i: SHA1 %s, SHA256 %s, SHA512 %s", async (time, sha1, sha256, sha512) => {
    expect((await totp(params("SHA1"), time * 1000)).code).toBe(sha1);
    expect((await totp(params("SHA256"), time * 1000)).code).toBe(sha256);
    expect((await totp(params("SHA512"), time * 1000)).code).toBe(sha512);
  });
  it("counts down the time left in the period, to the millisecond", async () => {
    expect((await totp(params("SHA1"), 59_000)).remaining).toBe(1);
    expect((await totp(params("SHA1"), 59_999)).remaining).toBeCloseTo(0.001);
    expect((await totp(params("SHA1"), 60_000)).remaining).toBe(30);
    expect((await totp(params("SHA1"), 60_999)).remaining).toBeCloseTo(29.001);
  });
  it("pads short codes with zeros", async () => {
    // 07081804 has a leading zero at 8 digits; at 6 it is the last six digits.
    expect((await totp({ ...params("SHA1"), digits: 6 }, 1111111109_000)).code).toBe("081804");
  });
});

describe("otpauth URIs", () => {
  it("reads Google Authenticator's example", () => {
    expect(parseOtpauth("otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example")).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      issuer: "Example",
      label: "alice@google.com",
    });
  });
  it("reads every parameter, and encoded labels", () => {
    expect(
      parseOtpauth(
        "otpauth://totp/ACME%20Co:john.doe%40email.com?secret=hxdmvjecjjwsrb3hwizr4ifugftmxboz&issuer=ACME%20Co&algorithm=sha256&digits=8&period=60",
      ),
    ).toEqual({
      secret: "HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      issuer: "ACME Co",
      label: "john.doe@email.com",
    });
  });
  it("takes the issuer from the label when there is no issuer parameter", () => {
    expect(parseOtpauth("otpauth://totp/GitHub:%20octocat?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      issuer: "GitHub",
      label: "octocat",
    });
  });
  it("prefers the issuer parameter over the label's", () => {
    expect(parseOtpauth("otpauth://totp/Old:me?secret=JBSWY3DPEHPK3PXP&issuer=New")).toMatchObject({ issuer: "New" });
  });
  it("accepts a label without an issuer", () => {
    expect(parseOtpauth("otpauth://totp/me?secret=JBSWY3DPEHPK3PXP")).toMatchObject({ issuer: "", label: "me" });
  });
  it.each([
    ["https://example.com/?secret=JBSWY3DPEHPK3PXP", /otpauth/],
    ["otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1", /HOTP/],
    ["otpauth://totp/x?issuer=nosecret", /no secret/],
    ["otpauth://totp/x?secret=NOT-BASE32-189", /base32/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5", /algorithm/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=10", /digits/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=six", /digits/],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0", /period/],
    ["not a link", /otpauth/],
  ])("refuses %s", (uri, error) => {
    expect(parseOtpauth(uri)).toMatch(error);
  });
  it("round-trips through formatOtpauth", () => {
    const params: TotpParams = {
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA512",
      digits: 7,
      period: 45,
      issuer: "Ünïcode & Co: Ltd",
      label: "a b@c.d",
    };
    // The issuer's own colon survives because the parameter, not the label, is read for it.
    expect(parseOtpauth(formatOtpauth(params))).toEqual(params);
  });
});

describe("parseTotpInput", () => {
  it("takes a bare secret with the default settings", () => {
    expect(parseTotpInput(" jbsw y3dp ehpk 3pxp ")).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      issuer: "",
      label: "",
    });
  });
  it("takes an otpauth link", () => {
    expect(parseTotpInput("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8")).toMatchObject({ digits: 8 });
  });
  it("explains an empty secret", () => {
    expect(parseTotpInput("   ")).toMatch(/empty/);
  });
});
