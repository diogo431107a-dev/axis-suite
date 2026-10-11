// Importing an OPML file: everything lands under a new bullet in the zoomed-in one, as a single
// undo step. The sync queue sends it parent-first in batches of at most 2,000 ops.
import { insertDrafts } from "../model/commands.ts";
import type { Outliner } from "../model/outliner.ts";
import { localDate } from "../text/dates.ts";
import { OpmlError, countDrafts, parseOpml } from "./opml.ts";

/** Imports OPML text under a new bullet named after `fileName`. Returns how many bullets came in. */
export function importOpml(o: Outliner, xml: string, fileName: string): number {
  const { drafts } = parseOpml(xml);
  const label = `Imported ${fileName} ${localDate()}`;
  o.run((ctx) => {
    const last = ctx.shown(ctx.root).at(-1) ?? null;
    const result = insertDrafts(ctx, ctx.root, last, [{ content: label, children: drafts }]);
    // Collapsed, so a big import doesn't draw thousands of bullets at once.
    const first = result.ops[0];
    if (first?.op === "create" && drafts.length > 0) first.collapsed = true;
    return { ops: result.ops, caret: { id: result.ids[0]!, offset: label.length } };
  });
  return countDrafts(drafts);
}

/** Imports an OPML file the user picked or dropped, telling them if it can't be read. */
export async function importFile(o: Outliner, file: File): Promise<void> {
  try {
    importOpml(o, await file.text(), file.name);
  } catch (err) {
    o.notice(err instanceof OpmlError ? `${file.name}: ${err.message}` : `Could not import ${file.name}.`);
    if (!(err instanceof OpmlError)) console.error(err);
  }
}
