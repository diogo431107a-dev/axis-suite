import type { Entry } from "../../shared/protocol.ts";
import { showStamp } from "../time.ts";
import { SOURCE_LABEL } from "../vocab.ts";
import { Marker } from "./Marker.tsx";

/** Choosing the entries something rests on. */
export function EntryPicklist({
  entries,
  picked,
  onChange,
}: {
  entries: readonly Entry[];
  picked: ReadonlySet<string>;
  onChange: (picked: ReadonlySet<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="picklist">
      {entries.map((e) => (
        <label key={e.id}>
          <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
          <span>
            <span className="when">
              <Marker src={e.src} />
              {SOURCE_LABEL[e.src]} · {showStamp(e.told)}
              {e.src === "P" && <span className="note">prompted</span>}
            </span>
            {e.body}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Choosing the one entry something came from, if any. */
export function EntryPicker({
  id,
  entries,
  value,
  onChange,
}: {
  id: string;
  entries: readonly Entry[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {entries.map((e) => (
        <option key={e.id} value={e.id}>
          {e.told.d} · {e.body.slice(0, 60)}
        </option>
      ))}
    </select>
  );
}
