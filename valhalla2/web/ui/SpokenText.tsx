// A message's words as the chat shows them.
import { Fragment } from "react";
import { segmentsOf } from "./emphasis.ts";

/** Spoken text, with action and ambience set a step back from the dialogue. */
export function SpokenText({ text }: { text: string }) {
  return (
    <p className="spoken leading-relaxed">
      {segmentsOf(text).map((segment, at) =>
        segment.action ? (
          <em key={at} className="italic text-faint">
            {segment.text}
          </em>
        ) : (
          <Fragment key={at}>{segment.text}</Fragment>
        ),
      )}
    </p>
  );
}
