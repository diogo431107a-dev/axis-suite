/** Hands the browser a file to save. */
export function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a board's name: "Work" → "Work.json". */
export const fileName = (name: string, ext: string) => `${name.replace(/[\\/:*?"<>|]+/g, "").trim() || "board"}.${ext}`;
