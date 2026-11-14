// Memory files as text a model reads: each in a tag naming its path, the most important first.
import { byImportance, type MemoryFile } from "./store.ts";

export function renderFiles(files: MemoryFile[]): string {
  return [...files]
    .sort(byImportance)
    .map((file) => `<memory_file path="${file.path}">\n${file.content.replace(/\n$/, "")}\n</memory_file>`)
    .join("\n\n");
}
