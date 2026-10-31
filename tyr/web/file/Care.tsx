// Handle with care: what to do, not the story behind it. First thing on a file.
import { useRef, useState, type FormEvent } from "react";
import { CARE_LEVELS, type CareLevel, type CareNote, type Person } from "../../shared/protocol.ts";
import { isMonthDay } from "../../shared/time.ts";
import { byToldDesc, nextOccurrence } from "../model.ts";
import { newId, usePage } from "../page.ts";
import { EntryPicker } from "../ui/EntryPicklist.tsx";
import { useSave } from "../ui/useSave.ts";
import { CARE_LABEL } from "../vocab.ts";

const inOrder = (a: CareNote, b: CareNote) => CARE_LEVELS.indexOf(a.level) - CARE_LEVELS.indexOf(b.level);

/** The notes as a list. With `full`, also since when, and what can be done with each. */
export function CareList({ person, full }: { person: Person; full?: boolean }) {
  const { ix, today, act, gotoEntry } = usePage();
  const [changing, setChanging] = useState<string | null>(null);
  const notes = ix.careOf(person.id).sort(inOrder);
  if (notes.length === 0) return <p className="muted small">No care notes yet.</p>;
  return (
    <ul className="carelist">
      {notes.map((c) =>
        changing === c.id ? (
          <li key={c.id} className="care-editing">
            <CareForm person={person} note={c} onDone={() => setChanging(null)} />
          </li>
        ) : (
          <li key={c.id}>
            <span className={`lvl ${c.level}`}>{c.date ? `Date · ${c.date}` : CARE_LABEL[c.level]}</span>
            <span>
              {c.text}
              {full && (
                <>
                  <span className="care-sub">
                    {c.date && `next ${nextOccurrence(c.date, today)} · `}
                    since {c.since} · confirmed {c.confirmed}
                    {c.source && (
                      <>
                        {" · "}
                        <button type="button" className="linkish" onClick={() => gotoEntry(c.source!)}>
                          source entry
                        </button>
                      </>
                    )}
                  </span>
                  <span className="care-actions">
                    <button type="button" className="btn ghost sm" onClick={() => setChanging(c.id)}>
                      Change
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() =>
                        act(`/api/care/${c.id}`, "PATCH", { confirmed: today }, `Still true · confirmed ${today}`)
                      }
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => act(`/api/care/${c.id}`, "PATCH", { retired: today }, "Care note retired.")}
                    >
                      Retire
                    </button>
                  </span>
                </>
              )}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

function CareForm({ person, note, onDone }: { person: Person; note: CareNote | null; onDone: () => void }) {
  const { ix, today, send, toast } = usePage();
  const [level, setLevel] = useState<CareLevel>(note?.level ?? "careful");
  const [text, setText] = useState(note?.text ?? "");
  const [date, setDate] = useState(note?.date ?? "");
  const [source, setSource] = useState(note?.source ?? "");
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());
  const prefix = note ? `cf-${note.id}` : "cf-new";
  const entries = [...ix.entriesOf(person.id)].sort(byToldDesc);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim()) return setError("Write the instruction first.");
    const hardDate = date.trim();
    if (hardDate && !isMonthDay(hardDate)) return setError("A hard date is a day of the year, like 11-15.");
    void run(async () => {
      const fields = { level, text, date: hardDate || null, source: source || null };
      if (note) await send(`/api/care/${note.id}`, "PATCH", fields);
      else await send("/api/care", "POST", { ...fields, id: id.current, person: person.id, since: today });
      toast("Care note saved.");
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${prefix}-level`}>Level</label>
        <select id={`${prefix}-level`} value={level} onChange={(e) => setLevel(e.target.value as CareLevel)}>
          {CARE_LEVELS.map((l) => (
            <option key={l} value={l}>
              {CARE_LABEL[l]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-text`}>Instruction, in my words</label>
        <input
          id={`${prefix}-text`}
          value={text}
          placeholder="Don’t mention … / Sit on her right / Topic they love"
          autoComplete="off"
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <span className="help">Write what to do, not the story behind it.</span>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-date`}>A day that is hard for them (optional)</label>
        <input
          id={`${prefix}-date`}
          className="mono"
          value={date}
          placeholder="MM-DD"
          maxLength={5}
          autoComplete="off"
          onChange={(e) => setDate(e.target.value)}
        />
        <span className="help">Open threads shows it from 30 days before.</span>
      </div>
      {entries.length > 0 && (
        <div className="field">
          <label htmlFor={`${prefix}-source`}>Source entry (optional)</label>
          <EntryPicker id={`${prefix}-source`} entries={entries} value={source} onChange={setSource} />
        </div>
      )}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          Save care note
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CareBox({ person }: { person: Person }) {
  const { ix, act } = usePage();
  const [adding, setAdding] = useState(false);
  const retired = ix.retiredCareOf(person.id);
  return (
    <fieldset className="care">
      <legend>Handle with care</legend>
      <CareList person={person} full />
      <div className="row mt">
        {adding ? (
          <CareForm person={person} note={null} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
            Add care note
          </button>
        )}
      </div>
      {retired.length > 0 && (
        <details className="retired mt">
          <summary>Retired ({retired.length})</summary>
          <ul>
            {retired.map((c) => (
              <li key={c.id}>
                <span className="mono small">{c.retired}</span> {c.text}{" "}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => act(`/api/care/${c.id}`, "PATCH", { retired: null }, "Care note back in force.")}
                >
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}
