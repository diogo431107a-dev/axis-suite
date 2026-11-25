/**
 * Copies text. The Clipboard API first; where the browser refuses it (some embedded browsers, or
 * a page that isn't https), the older way: select the text in a hidden box and copy that.
 */
export async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.append(box);
    box.select();
    try {
      // Deprecated, but still the only way where the Clipboard API is refused.
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
}
