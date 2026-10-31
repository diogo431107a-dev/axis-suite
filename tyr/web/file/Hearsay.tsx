// Hearsay: what someone told me. Never an entry, always flagged, and never changed once written.
import { useRef, useState, type FormEvent } from "react";
import type { Hearsay } from "../../shared/protocol.ts";
import { happenedAfterTold } from "../../shared/time.ts";
import { DateTime } from "../forms/DateTime.tsx";
import { dateTimeFrom, readDateTime } from "../forms/moment.ts";
import { newId, usePage } from "../page.ts";
import { showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";
import { useSave } from "../ui/useSave.ts";

export function HearsayRow({ note }: { note: Hearsay }) {
  const { ix } = usePage();
  const place = ix.placeLabel(note.place);
  return (
    <div className="hearsay">
      <span className="sd">
        <span>happened {showStamp(note.hap)}</span>
        <span>told {showStamp(note.told)}</span>
        {place && <span>{place}</span>}
      </span>
      <span>{note.text}</span>
      <span className="sd">
        <Marker src="H" /> Someone told me{note.by && ` (${note.by})`}
        <span className="hearsay-note">Hearsay · do not reveal the source</span>
      </span>
    </div>
  );
}

/** A form for hearsay, wherever it is kept: `extra` says where. */
export function HearsayForm({
  prefix,
  path,
  extra,
  placeholder,
  saveLabel,
  onDone,
}: {
  prefix: string;
  path: string;
  extra?: Record<string, unknown>;
  placeholder: string;
  saveLabel: string;
  onDone: () => void;
}) {
  const { today, send, toast } = usePage();
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [told, setTold] = useState(() => dateTimeFrom(null));
  const [same, setSame] = useState(true);
  const [hap, setHap] = useState(() => dateTimeFrom(null));
  const [place, setPlace] = useState("");
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim()) return setError("Write what was said first.");
    const toldStamp = readDateTime(told, today);
    if (!toldStamp) return setError("Check the date I was told.");
    if (toldStamp.d > today) return setError("That date is in the future. Check it.");
    const hapStamp = same ? toldStamp : readDateTime(hap, today);
    if (!hapStamp) return setError("Check the date it happened.");
    if (happenedAfterTold(hapStamp, toldStamp)) return setError("Happened-at is later than told-at. Check the dates.");
    void run(async () => {
      await send(path, "POST", {
        ...extra,
        id: id.current,
        text,
        by,
        told: toldStamp,
        hap: hapStamp,
        place: place.trim() || null,
      });
      toast("Saved as hearsay. It can’t be changed.");
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <p className="hint p">Hearsay. It stays out of the profile and the timeline, and can’t be changed once saved.</p>
      <div className="field">
        <label htmlFor={`${prefix}-text`}>What was said</label>
        <textarea
          id={`${prefix}-text`}
          value={text}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor={`${prefix}-by`}>Who told me (optional)</label>
          <input id={`${prefix}-by`} value={by} autoComplete="off" onChange={(e) => setBy(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-place`}>Where (optional)</label>
          <input
            id={`${prefix}-place`}
            list="dl-places"
            value={place}
            autoComplete="off"
            onChange={(e) => setPlace(e.target.value)}
          />
        </div>
      </div>
      <DateTime id={`${prefix}-told`} label="Told at" value={told} onChange={setTold} />
      <label className="check">
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> It happened at that same
        moment
      </label>
      {!same && <DateTime id={`${prefix}-hap`} label="Happened at" value={hap} onChange={setHap} />}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          {saveLabel}
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
