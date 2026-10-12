// Copying secrets. What Janus copies is cleared from the clipboard after a while, so a password
// doesn't wait there to be pasted somewhere by mistake.
//
// Best effort: a page may only write the clipboard while it has focus, and it can't read it
// without asking, so the clearing happens only if Janus has focus then, and only if nothing else
// was copied from Janus since. (Whatever was copied from another app in between is overwritten.)

export const CLEAR_AFTER_SECONDS = 30;

let pending: ReturnType<typeof setTimeout> | undefined;
let copies = 0;

/** Copies `text`. With `secret`, clears the clipboard again after CLEAR_AFTER_SECONDS. */
export async function copy(text: string, secret: boolean): Promise<void> {
  await navigator.clipboard.writeText(text);
  clearTimeout(pending);
  const copy = ++copies;
  if (!secret) return;
  const clear = () => {
    if (copy !== copies) return;
    if (document.hasFocus()) navigator.clipboard.writeText("").catch(() => {});
    else window.addEventListener("focus", clear, { once: true });
  };
  pending = setTimeout(clear, CLEAR_AFTER_SECONDS * 1000);
}
