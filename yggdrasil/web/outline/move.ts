// Moving bullets far away: Move to… (Alt+Shift+M, the bullet menu) and drops on the sidebar.
// The bullets go first under their target, with everything under them; when they leave the
// zoomed-in bullet, the caret goes where it would if they were deleted.
import * as cmd from "../model/commands.ts";
import { refusal, type Outliner } from "../model/outliner.ts";
import type { Focus } from "../model/undo.ts";
import { plainText } from "../text/plain.ts";

/** A bullet's name for messages and titles, cut short. */
export function shortName(o: Outliner, id: string | null): string {
  if (id === null) return "Home";
  const name = plainText(o.store.get(id)?.content ?? "") || "Untitled";
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

/** Alt+Shift+M and Move to…: opens the dialog that asks where, unless the bullets can't move. */
export function askWhereToMove(o: Outliner, ids: readonly string[]): void {
  if (ids.length === 0) return;
  // The same check a move gets when it is made: read only, or the top of a bullet shared with them.
  const refused = refusal(
    ids.map((id) => ({ op: "move", id, parentId: null, rank: "a0" })),
    (id, parents) => o.store.roleOf(id, parents),
    (id) => o.store.get(id)?.parentId === null && o.store.sharedWithMe(id) !== undefined,
  );
  if (refused) return o.notice(refused);
  o.history.seal();
  o.ui.setDialog({ kind: "move", ids: [...ids], before: o.focus() });
}

/**
 * Moves the bullets under `target` (null: the top level). `before` is the caret or selection
 * the user had when they asked (a dialog may have taken the focus since). Returns whether
 * anything moved.
 */
export function moveBullets(
  o: Outliner,
  ids: readonly string[],
  target: string | null,
  before: Focus = o.focus(),
): boolean {
  const ctx = o.ctx();
  const result = cmd.moveInto(ctx, ids, target);
  if (!result) return false;
  const zoom = ctx.root;
  // Whether the bullets are still inside the zoomed-in bullet once moved.
  const staysShown = zoom === null || (target !== null && cmd.isAncestorOrSelf(ctx, zoom, target));
  const moved = (id: string) => ids.some((m) => cmd.isAncestorOrSelf(ctx, m, id));
  let after: Focus = before;
  if (!staysShown && before) {
    const leaving = before.kind === "caret" ? moved(before.id) : before.ids.some(moved);
    if (leaving) {
      const caret = cmd.remove(ctx, ids)?.caret;
      after = caret ? { kind: "caret", id: caret.id, field: "content", start: caret.offset, end: caret.offset } : null;
    }
  }
  o.history.seal();
  if (!o.commit(result, { before, after })) return false;
  o.history.seal();
  if (after) o.restore(after);
  else {
    o.ui.clearCaret();
    o.ui.clearSelection();
  }
  o.notice(`Moved to “${shortName(o, target)}”`);
  return true;
}
