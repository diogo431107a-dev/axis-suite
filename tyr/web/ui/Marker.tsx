import { SOURCES, type Source } from "../../shared/protocol.ts";
import { SOURCE_LABEL } from "../vocab.ts";
import { Seg } from "./controls.tsx";

/** A source's mark. Shape carries the meaning; colour only groups "their words" and "mine". */
export function Marker({ src }: { src: Source }) {
  return (
    <svg className={`mk mk-${src}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {src === "U" && <circle cx="6" cy="6" r="4.6" fill="currentColor" />}
      {src === "I" && (
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.75a4.25 4.25 0 0 0 0 8.5z" fill="currentColor" />
        </>
      )}
      {src === "P" && <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {src === "O" && <rect x="1.6" y="1.6" width="8.8" height="8.8" fill="currentColor" />}
      {src === "N" && <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

/** The choice of source, each with its mark. */
export function SourceSeg({ value, onChange }: { value: Source; onChange: (src: Source) => void }) {
  return (
    <Seg
      label="Source"
      options={SOURCES.map(
        (s) =>
          [
            s,
            <>
              <Marker src={s} />
              {SOURCE_LABEL[s]}
            </>,
          ] as const,
      )}
      value={value}
      onChange={onChange}
    />
  );
}
