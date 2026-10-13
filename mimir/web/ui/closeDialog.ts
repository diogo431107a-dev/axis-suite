/** Closes the <dialog> that contains an element (e.g. the button that was clicked). Its onClose then runs. */
export function closeDialog(element: Element): void {
  element.closest("dialog")?.close();
}
