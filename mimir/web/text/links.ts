// Web and mail addresses in a node's text, shown underlined and opened with a click (or O). A long
// address may be wrapped over several lines; every piece of it opens the whole address.

const URL_PATTERN = /\b(?:https?:\/\/|mailto:)[^\s<>"]+/gi;
/** Punctuation that ends a sentence rather than an address: "see https://x.org." */
const TRAILING = /[.,;:!?'")\]}]+$/;

/** Only these open: no javascript: or data: addresses, whatever the text says. */
export const isSafeUrl = (url: string) => /^(https?:\/\/|mailto:)/i.test(url);

/** The addresses in a text, in order. */
export function findUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_PATTERN)) {
    let url = m[0];
    // Keep a closing bracket that has its opening one in the address (Wikipedia's).
    const trail = TRAILING.exec(url)?.[0] ?? "";
    if (trail) {
      url = url.slice(0, -trail.length);
      if (trail.startsWith(")") && url.includes("(") && !url.includes(")")) url += ")";
    }
    if (url.length > 0 && isSafeUrl(url) && !/^(https?:\/\/|mailto:)$/i.test(url)) out.push(url);
  }
  return out;
}

/** A piece of a line: plain text, or part of an address. */
export interface Piece {
  text: string;
  href: string | null;
}

/**
 * The lines of a wrapped text cut into plain pieces and address pieces. `urls` are the addresses
 * of the whole text (findUrls), so a piece of an address broken over lines still knows all of it.
 */
export function linkPieces(lines: readonly string[], urls: readonly string[]): Piece[][] {
  if (urls.length === 0) return lines.map((text) => [{ text, href: null }]);
  let next = 0; // the next address to look for
  let carry: { rest: string; href: string } | null = null; // an address that goes on to the next line
  return lines.map((line) => {
    const pieces: Piece[] = [];
    let at = 0;
    if (carry) {
      const take = carry.rest.startsWith(line) ? line.length : line.startsWith(carry.rest) ? carry.rest.length : 0;
      if (take > 0) {
        pieces.push({ text: line.slice(0, take), href: carry.href });
        at = take;
        carry = take < carry.rest.length ? { rest: carry.rest.slice(take), href: carry.href } : null;
        if (carry) return pieces;
      } else carry = null;
    }
    while (next < urls.length) {
      const url = urls[next]!;
      // The whole address on this line, or its beginning at the end of the line.
      let found = line.indexOf(url, at);
      let length = url.length;
      if (found < 0) {
        // At least the scheme ("https:"), so a word ending in "h" isn't taken for one.
        const min = url.indexOf(":") + 1;
        for (let n = Math.min(url.length - 1, line.length - at); n >= min; n--) {
          if (line.endsWith(url.slice(0, n)) && line.length - n >= at) {
            found = line.length - n;
            length = n;
            break;
          }
        }
      }
      if (found < 0) break;
      if (found > at) pieces.push({ text: line.slice(at, found), href: null });
      pieces.push({ text: line.slice(found, found + length), href: url });
      at = found + length;
      next++;
      if (length < url.length) {
        carry = { rest: url.slice(length), href: url };
        break;
      }
    }
    if (at < line.length || pieces.length === 0) pieces.push({ text: line.slice(at), href: null });
    return pieces;
  });
}
