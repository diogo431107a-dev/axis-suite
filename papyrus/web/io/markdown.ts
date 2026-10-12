// A Markdown copy of every journal, to read or print elsewhere. Not for importing back: the JSON
// export is the backup.
import { MOOD_NAMES, type ExportFile } from "../../shared/protocol.ts";
import { weekdayName } from "../format.ts";

/** Plain text as Markdown that shows it as typed: no accidental headings, quotes or rules, line breaks kept. */
export function markdownText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  return lines
    .map((line, i) => {
      const escaped = line
        .replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, "$1\\$2")
        .replace(/^(\s{0,3})>/, "$1\\>")
        // A line of only - or = under a paragraph makes it a heading; three -, * or _ make a rule.
        .replace(/^(\s{0,3})([-=])(?=\2*\s*$)/, "$1\\$2")
        .replace(/^(\s{0,3})([-*_])(?=(\s*\2){2,}\s*$)/, "$1\\$2");
      // A line followed by another in the same paragraph ends with two spaces: a line break.
      const next = lines[i + 1];
      return next !== undefined && next.trim() && line.trim() ? `${escaped}  ` : escaped;
    })
    .join("\n");
}

export function toMarkdown(file: ExportFile): string {
  const out: string[] = [];
  for (const journal of file.journals) {
    out.push(`# ${journal.name.replace(/^#/, "\\#")}`, "");
    for (const page of journal.pages) {
      out.push(`## ${page.date}, ${weekdayName(page.date)}`, "");
      if (page.mood) out.push(`*Mood: ${MOOD_NAMES[page.mood]}*`, "");
      if (page.text.trim()) out.push(markdownText(page.text), "");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
