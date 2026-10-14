/** Hands the browser a file to save: text, or a Blob (a picture). */
export function download(name: string, type: string, content: string | Blob): void {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a map's name: "Holidays" → "Holidays.opml". Characters no file name may hold go. */
export function fileName(name: string, ext: string): string {
  const safe = [...name]
    .filter((c) => c >= " " && !'\\/:*?"<>|'.includes(c))
    .join("")
    .trim()
    .slice(0, 100);
  return `${safe || "map"}.${ext}`;
}
