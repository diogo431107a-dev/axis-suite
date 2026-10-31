// The whole entry: writing a new one, amending one with a new one, or completing a quick capture.
import { useRef, useState, type FormEvent } from "react";
import {
  QUESTIONS,
  type Certainty,
  type EntryFields,
  type Question,
  type Setting,
  type Source,
  type Wording,
} from "../../shared/protocol.ts";
import { happenedAfterTold, stampKey } from "../../shared/time.ts";
import { describeError } from "../api.ts";
import { byToldDesc } from "../model.ts";
import { newId, usePage, type Sheet } from "../page.ts";
import { nowText, parseDateText } from "../time.ts";
import { Seg, SheetFrame } from "../ui/controls.tsx";
import { SourceSeg } from "../ui/Marker.tsx";
import { SOURCE_HINT, SOURCE_LABEL, TOLD_LABEL } from "../vocab.ts";
import { DateField, DateTime } from "./DateTime.tsx";
import { dateTimeFrom, readDateTime } from "./moment.ts";

/** The warning before saving what I asked for. It never blocks. */
export function PromptedWarning({ onBack }: { onBack: () => void }) {
  return (
    <div className="warn">
      <span>
        <b>You asked for this.</b> It won’t count towards the spontaneous profile; it goes to the prompted ledger.
      </span>
      <div className="row">
        <button className="btn" type="submit">
          Save to prompted ledger
        </button>
        <button className="btn ghost" type="button" onClick={onBack}>
          Change source
        </button>
      </div>
    </div>
  );
}

export function EntryForm({ sheet }: { sheet: Extract<Sheet, { what: "entry" }> }) {
  const { ix, today, setSheet, send, toast, showSaved } = usePage();
  const person = ix.person(sheet.pid);
  const eid = sheet.mode === "new" ? null : sheet.eid;
  const base = ix.entry(eid);
  const completing = sheet.mode === "complete" && base ? base : null;

  const [src, setSrc] = useState<Source>(completing ? completing.src : "U");
  const [wording, setWording] = useState<Wording>(completing?.wording ?? "para");
  const [body, setBody] = useState(completing?.body ?? "");
  const [cat, setCat] = useState<Question | "">(completing?.cat ?? "");
  const [told, setTold] = useState(() => dateTimeFrom(completing?.told ?? null));
  const [same, setSame] = useState(() => !completing || stampKey(completing.hap) === stampKey(completing.told));
  const [hap, setHap] = useState(() => dateTimeFrom(completing?.hap ?? null));
  const [place, setPlace] = useState(completing ? ix.placeName(completing.place) : "");
  const [setting, setSetting] = useState<Setting | "">(completing?.setting ?? "");
  const [ctx, setCtx] = useState(completing?.ctx ?? "");
  const [present, setPresent] = useState(completing?.present.join(", ") ?? "");
  const [cert, setCert] = useState<Certainty>(completing?.cert ?? "sure");
  const [conf, setConf] = useState(completing?.conf ?? false);
  const [fuDate, setFuDate] = useState(completing?.fu?.date ?? "");
  const [fuNote, setFuNote] = useState(completing?.fu?.note ?? "");
  const [contra, setContra] = useState(completing?.contra ?? "");
  const [warned, setWarned] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const newEntryId = useRef(newId());

  if (!person) return null;
  const others = ix
    .entriesOf(sheet.pid)
    .filter((e) => e.id !== eid)
    .sort(byToldDesc);
  const needsWarning = src === "P" && !warned && completing?.src !== "P";

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setError("");
    if (!body.trim()) return setError("Write the entry first: one idea, in a sentence or two.");
    const toldStamp = readDateTime(told, today);
    if (!toldStamp) return setError(`Check the date of “${TOLD_LABEL[src]}”.`);
    if (toldStamp.d > today) return setError(`“${TOLD_LABEL[src]}” is in the future. Check the date.`);
    const hapStamp = same ? toldStamp : readDateTime(hap, today);
    if (!hapStamp) return setError("Check the date of “Happened at”.");
    if (src !== "N" && happenedAfterTold(hapStamp, toldStamp)) {
      return setError("Happened-at is later than told-at. Check the dates.");
    }
    let fu: EntryFields["fu"] = null;
    if (fuDate.trim()) {
      const parsed = parseDateText(fuDate, today);
      if (parsed?.p !== "date") return setError("Follow-up needs a full date, like 2026-11-20.");
      fu = { date: parsed.d, note: fuNote.trim() || "Ask about this" };
    }
    if (needsWarning) return setWarned(true);

    const fields: EntryFields = {
      src,
      body,
      told: toldStamp,
      hap: hapStamp,
      wording,
      cat: cat || null,
      place: place.trim() || null,
      setting: setting || null,
      ctx,
      present: present
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      cert,
      conf,
      fu,
      contra: contra || null,
    };
    setSaving(true);
    try {
      if (completing) {
        await send(`/api/entries/${completing.id}/complete`, "POST", fields);
        toast(place.trim() && cat ? "Entry completed." : "Saved. Still missing a place or category.");
        setSheet(null);
        showSaved(sheet.pid, completing.id, src, true);
      } else {
        const id = newEntryId.current;
        await send("/api/entries", "POST", {
          ...fields,
          id,
          person: sheet.pid,
          amends: sheet.mode === "amend" ? eid : null,
          incomplete: false,
        });
        toast(`Logged ${nowText()} · ${SOURCE_LABEL[src]}`);
        setSheet(null);
        showSaved(sheet.pid, id, src, true);
      }
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  const sub = completing ? "Complete entry" : sheet.mode === "amend" ? "Amending entry" : "New entry";

  return (
    <SheetFrame
      sub={`${sub} · ${person.name}`}
      title={sheet.mode === "amend" ? "What changed?" : "What was said, when, and where"}
      onClose={() => setSheet(null)}
    >
      <form className="fs" noValidate onSubmit={(e) => void submit(e)}>
        {sheet.mode === "amend" && base && (
          <p className="hint">
            The original stays visible. This entry is linked to it: <b>{base.told.d}</b> · {base.body}
          </p>
        )}
        <div className="fs">
          <span className="flabel">Source</span>
          <SourceSeg
            value={src}
            onChange={(next) => {
              setSrc(next);
              setWarned(false);
            }}
          />
          <div className={`hint ${src === "P" ? "p" : ""}`}>
            {SOURCE_HINT[src]}
            {(src === "U" || src === "I" || src === "P") && (
              <span className="test">Would they have said this if I hadn’t asked?</span>
            )}
          </div>
        </div>
        <div className="fs">
          <span className="flabel">The entry</span>
          <Seg
            label="Wording"
            options={[
              ["para", "Paraphrase"],
              ["quote", "Their exact words"],
            ]}
            value={wording}
            onChange={setWording}
          />
          <div className="field">
            <label htmlFor="ef-body">One idea per entry</label>
            <textarea
              id="ef-body"
              value={body}
              placeholder="She said the garden is the one place her head goes quiet."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ef-cat">Category</label>
            <select id="ef-cat" value={cat} onChange={(e) => setCat(e.target.value as Question | "")}>
              <option value="">Assign later</option>
              {QUESTIONS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fs">
          <span className="flabel">When</span>
          <DateTime id="told" label={TOLD_LABEL[src]} value={told} onChange={setTold} />
          <label className="check">
            <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> It happened at that
            same moment
          </label>
          {!same && <DateTime id="hap" label="Happened at" value={hap} onChange={setHap} />}
          <p className="small muted">
            Logged at:{" "}
            {completing ? "fixed, from when it was captured." : "set by the system when you save, and never changes."}
          </p>
        </div>
        <div className="fs">
          <span className="flabel">Where</span>
          <div className="field">
            <label htmlFor="ef-place">Place</label>
            <input
              id="ef-place"
              list="dl-places"
              value={place}
              placeholder="Pick from the list or type a new label"
              autoComplete="off"
              onChange={(e) => setPlace(e.target.value)}
            />
            <span className="help">A label, never an address.</span>
          </div>
          <Seg
            label="Setting"
            options={[
              ["", "Not noted"],
              ["private", "In private"],
              ["group", "In a group"],
            ]}
            value={setting}
            onChange={setSetting}
          />
          <div className="field">
            <label htmlFor="ef-ctx">Occasion</label>
            <input
              id="ef-ctx"
              value={ctx}
              placeholder="lunch, bus ride, after the meeting"
              autoComplete="off"
              onChange={(e) => setCtx(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ef-present">Who else was there</label>
            <input
              id="ef-present"
              list="dl-people"
              value={present}
              placeholder="Names, separated by commas"
              autoComplete="off"
              onChange={(e) => setPresent(e.target.value)}
            />
          </div>
        </div>
        <div className="fs">
          <span className="flabel">Details</span>
          <div className="field">
            <span className="flabel">How sure is my memory</span>
            <Seg
              label="How sure is my memory"
              options={[
                ["sure", "Sure"],
                ["fair", "Fairly sure"],
                ["fuzzy", "Fuzzy"],
              ]}
              value={cert}
              onChange={setCert}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={conf} onChange={(e) => setConf(e.target.checked)} /> They asked me not to
            repeat it
          </label>
          <div className="grid2">
            <div className="field">
              <label htmlFor="ef-fu">Ask about it later</label>
              <DateField id="ef-fu" value={fuDate} onChange={setFuDate} />
            </div>
            <div className="field">
              <label htmlFor="ef-funote">Follow-up note</label>
              <input
                id="ef-funote"
                value={fuNote}
                placeholder="Ask how the exam went"
                autoComplete="off"
                onChange={(e) => setFuNote(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ef-contra">Contradicts an earlier entry</label>
            <select id="ef-contra" value={contra} onChange={(e) => setContra(e.target.value)}>
              <option value="">None</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.told.d} · {o.body.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="m-foot">
          {warned && <PromptedWarning onBack={() => setWarned(false)} />}
          {error && (
            <span className="err" role="alert">
              {error}
            </span>
          )}
          {!warned && (
            <div className="row">
              <button className="btn" type="submit" disabled={saving}>
                {completing ? "Save details" : "Log entry"}
              </button>
              <button className="btn ghost" type="button" onClick={() => setSheet(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </form>
    </SheetFrame>
  );
}
