// Companions write in the convention of the page: what is set between asterisks is action or
// ambience, and everything else is spoken aloud. This splits a turn's text into those two
// registers, so the page can draw them apart and reading aloud can say them apart. The asterisks
// are kept, so what is on screen stays what was written — only its weight changes.

export type Segment = { text: string; action: boolean };

// A run of asterisks of any length is one delimiter, so **this** is a single run and not two
// empty ones.
const RUN = /(\*+)/;
// A blank line ends a paragraph, and with it any action left open.
const PARAGRAPH = /(\n{2,})/;

const isRun = (piece: string) => /^\*+$/.test(piece);
const isBreak = (piece: string) => /^\n{2,}$/.test(piece);

/**
 * The text in order, each piece marked as action or as speech. Adjacent pieces of a kind arrive
 * merged, and nothing empty is returned.
 *
 * An action left unclosed runs to the end of its paragraph. That is what a reply still being
 * written looks like, so it reads the same arriving as it does once saved; and a stray asterisk
 * costs one paragraph rather than the rest of the turn.
 */
export function segmentsOf(text: string): Segment[] {
  const segments: Segment[] = [];

  const add = (piece: string, action: boolean) => {
    if (!piece) return;
    const last = segments.at(-1);
    if (last && last.action === action) last.text += piece;
    else segments.push({ text: piece, action });
  };

  for (const paragraph of text.split(PARAGRAPH)) {
    // split keeps the separators it matched; the blank line itself is never part of an action.
    if (isBreak(paragraph)) {
      add(paragraph, false);
      continue;
    }
    let action = false;
    for (const piece of paragraph.split(RUN)) {
      if (isRun(piece)) {
        // An opening run belongs to the action it begins, a closing one to the action it ends.
        add(piece, true);
        action = !action;
      } else {
        add(piece, action);
      }
    }
  }

  return segments;
}
