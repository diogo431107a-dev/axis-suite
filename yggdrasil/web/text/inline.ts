// Inline markup, as Dynalist writes it, so imported Dynalist bullets look as they did there:
//   **bold**  __italic__  ~~strike~~  `code`  [text](url)  bare URLs
//   #tag  @mention  !(2026-10-11)  !(2026-10-11 14:30)
// Every token keeps its offsets in the source, so a click on rendered text can put the caret
// on the same character in the editor.

export type Token =
  | { type: "text"; start: number; text: string }
  | { type: "bold" | "italic" | "strike"; start: number; end: number; children: Token[] }
  | { type: "code"; start: number; end: number; text: string; textStart: number }
  | { type: "link"; start: number; end: number; text: string; textStart: number; url: string }
  | { type: "url"; start: number; end: number; url: string }
  | { type: "tag" | "mention"; start: number; end: number; text: string; name: string }
  | { type: "date"; start: number; end: number; date: string; time: string | null };

const PAIRS: Record<string, "bold" | "italic" | "strike"> = { "**": "bold", __: "italic", "~~": "strike" };
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+)\)/;
const DATE = /^!\((\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\)/;
// A URL ends before whitespace, and trailing punctuation belongs to the sentence.
const URL = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/;
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_\-/.]*/u;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Whether a link may point there: web pages and mail only (never javascript: and the like). */
export function isSafeUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url);
}

/** Splits text (starting at `offset` in the whole source) into tokens. */
export function tokenize(text: string, offset = 0): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let run = "";
  let runStart = offset;
  const flush = () => {
    if (run) tokens.push({ type: "text", start: runStart, text: run });
    run = "";
  };
  const push = (token: Token, length: number) => {
    flush();
    tokens.push(token);
    i += length;
    runStart = offset + i;
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const at = offset + i;
    const ch = text[i]!;
    const prev = i > 0 ? text[i - 1]! : "";

    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i + 1) {
        const inner = text.slice(i + 1, close);
        push({ type: "code", start: at, end: offset + close + 1, text: inner, textStart: at + 1 }, close + 1 - i);
        continue;
      }
    }

    const pair = PAIRS[rest.slice(0, 2)];
    if (pair) {
      const marker = rest.slice(0, 2);
      const close = text.indexOf(marker, i + 2);
      if (close > i + 2) {
        const children = tokenize(text.slice(i + 2, close), at + 2);
        push({ type: pair, start: at, end: offset + close + 2, children }, close + 2 - i);
        continue;
      }
    }

    if (ch === "[") {
      const m = LINK.exec(rest);
      if (m && isSafeUrl(m[2]!)) {
        push(
          { type: "link", start: at, end: at + m[0].length, text: m[1]!, textStart: at + 1, url: m[2]! },
          m[0].length,
        );
        continue;
      }
    }

    if (ch === "!" && text[i + 1] === "(") {
      const m = DATE.exec(rest);
      if (m) {
        push({ type: "date", start: at, end: at + m[0].length, date: m[1]!, time: m[2] ?? null }, m[0].length);
        continue;
      }
    }

    if ((ch === "#" || ch === "@") && !WORD_CHAR.test(prev)) {
      const m = NAME.exec(text.slice(i + 1));
      if (m) {
        // A trailing dot or slash ends the sentence or path rather than the name.
        const name = m[0].replace(/[./-]+$/, "");
        if (name) {
          const type = ch === "#" ? "tag" : "mention";
          push({ type, start: at, end: at + 1 + name.length, text: ch + name, name }, 1 + name.length);
          continue;
        }
      }
    }

    if (ch === "h" && !WORD_CHAR.test(prev)) {
      const m = URL.exec(rest);
      if (m) {
        push({ type: "url", start: at, end: at + m[0].length, url: m[0] }, m[0].length);
        continue;
      }
    }

    if (!run) runStart = at;
    run += ch;
    i++;
  }
  flush();
  return tokens;
}

/** Every tag (without "#") in text, lowercased. */
export function tagsOf(text: string): string[] {
  const out: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "tag") out.push(t.name.toLowerCase());
      else if (t.type === "bold" || t.type === "italic" || t.type === "strike") walk(t.children);
    }
  };
  walk(tokenize(text));
  return out;
}

/** Every date in text, as { date, time }. */
export function datesOf(text: string): { date: string; time: string | null }[] {
  const out: { date: string; time: string | null }[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "date") out.push({ date: t.date, time: t.time });
      else if (t.type === "bold" || t.type === "italic" || t.type === "strike") walk(t.children);
    }
  };
  walk(tokenize(text));
  return out;
}
