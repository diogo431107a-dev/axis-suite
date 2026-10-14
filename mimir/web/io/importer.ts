// OPML files coming in: as a new map (sent to the server as a one-map backup), or into the open
// map under the selected node (one undo step).
import { LIMITS, type ExportFile, type ExportNode } from "../../shared/protocol.ts";
import { countDrafts, type Draft } from "../model/commands.ts";
import { count } from "../format.ts";
import type { OpmlFile } from "./opml.ts";
import { clip } from "./plaintext.ts";

/** A file name without its extension: "Ideas.opml" → "Ideas". */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || name;

/** A file as a new map: one top-level outline is the root; several hang from a root named after the file. */
export function opmlAsBackup(file: OpmlFile, fileName: string): ExportFile {
  const top: Draft =
    file.drafts.length === 1
      ? file.drafts[0]!
      : { text: clip(file.title ?? baseName(fileName)), children: file.drafts };
  const root: ExportNode = { text: top.text };
  const stack: { draft: Draft; node: ExportNode }[] = [{ draft: top, node: root }];
  while (stack.length > 0) {
    const { draft, node } = stack.pop()!;
    if (draft.children.length === 0) continue;
    node.children = draft.children.map((d) => ({ text: d.text }));
    // Deep branches arrive folded, so a big file doesn't open as a wall of nodes.
    if (node !== root && countDrafts(draft.children) > 20) node.collapsed = true;
    draft.children.forEach((d, i) => stack.push({ draft: d, node: node.children![i]! }));
  }
  return { format: "mimir", version: 1, exportedAt: new Date().toISOString(), maps: [{ root, arrows: [] }] };
}

/** Why a file can't come into a map, or null. `room` is how many nodes the map can still take. */
export function tooBig(file: OpmlFile, room: number = LIMITS.mapNodes): string | null {
  const n = countDrafts(file.drafts) + (file.drafts.length === 1 ? 0 : 1);
  return n > room ? `This file has ${n} outlines; a map holds at most ${LIMITS.mapNodes} nodes.` : null;
}

/** What was left out of a file, for the user, or "". */
export function leftOut(file: OpmlFile): string {
  const parts = [
    file.notes > 0 ? count(file.notes, "note", "notes") : "",
    file.completed > 0 ? count(file.completed, "completion mark", "completion marks") : "",
  ].filter(Boolean);
  return parts.length > 0 ? ` Left out ${parts.join(" and ")}: maps don't have them.` : "";
}
