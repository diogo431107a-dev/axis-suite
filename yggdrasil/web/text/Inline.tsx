// A bullet's text as shown when it isn't being edited. Every piece of text sits in an element
// with data-offset (where it starts in the source), so a click can put the caret on the
// character that was clicked.

export function Inline({ text }: { text: string }) {
  return <span data-offset={0}>{text}</span>;
}
