// Muninn, the quick capture: ten seconds after a conversation, the rest can wait. And Just met.
import { useRef, useState, type FormEvent } from "react";
import type { EntryFields, Source, Stamp } from "../../shared/protocol.ts";
import { describeError } from "../api.ts";
import { parseCapture } from "../model.ts";
import { newId, usePage } from "../page.ts";
import { clock, isoDate, nowText } from "../time.ts";
import { Seg, SheetFrame } from "../ui/controls.tsx";
import { SOURCE_HINT } from "../vocab.ts";
import { DateTime } from "./DateTime.tsx";
import { PromptedWarning } from "./EntryForm.tsx";
import { dateTimeFrom, readDateTime } from "./moment.ts";
import { SourceSeg } from "../ui/Marker.tsx";

const blankFields = (when: Stamp): Omit<EntryFields, "src" | "body"> => ({
  told: when,
  hap: when,
  place: null,
  setting: null,
  wording: "para",
  cat: null,
  cert: "sure",
  conf: false,
  present: [],
  ctx: "",
  fu: null,
  contra: null,
  credit: false,
  incident: null,
});

export function Muninn({ tab, name }: { tab: "capture" | "met"; name?: string | undefined }) {
  const { setSheet } = usePage();
  return (
    <SheetFrame
      sub="Muninn · quick capture"
      title={tab === "capture" ? "Ten seconds, then back to life" : "Just met someone"}
      onClose={() => setSheet(null)}
    >
      <Seg
        label="Muninn"
        options={[
          ["capture", "Capture"],
          ["met", "Just met"],
        ]}
        value={tab}
        onChange={(next) => setSheet({ what: "muninn", tab: next })}
      />
      {tab === "capture" ? <Capture /> : <JustMet firstName={name ?? ""} />}
    </SheetFrame>
  );
}

function Capture() {
  const { ix, ui, setSheet, send, toast, showSaved } = usePage();
  const [who, setWho] = useState(ui.view === "file" ? (ix.person(ui.pid)?.name ?? "") : "");
  const [src, setSrc] = useState<Source>("U");
  const [line, setLine] = useState("");
  const [warned, setWarned] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useRef(newId());

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setError("");
    const person = ix.findPerson(who);
    if (!person) return setError("No file with that name. Use “Just met” to open one.");
    const { body, cat, present, care } = parseCapture(line, (typed) => ix.findPerson(typed)?.name);
    if (!body) return setError("Write one line first.");
    if (src === "P" && !warned) return setWarned(true);
    const now = new Date();
    const when: Stamp = { d: isoDate(now), t: clock(now), p: "date" };
    setSaving(true);
    try {
      await send("/api/entries", "POST", {
        ...blankFields(when),
        id: id.current,
        person: person.id,
        src,
        body,
        cat,
        present,
        care,
        amends: null,
        incomplete: true,
      });
      toast(`Captured for ${person.name}${care ? ", with a care note" : ""}. Complete it later from Threads.`);
      setSheet(null);
      showSaved(person.id, id.current, src, false);
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <form className="fs" noValidate onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="cap-person">Who</label>
        <input
          id="cap-person"
          list="dl-people"
          value={who}
          placeholder="Start typing a name"
          autoComplete="off"
          onChange={(e) => setWho(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="flabel">Source</span>
        <SourceSeg
          value={src}
          onChange={(next) => {
            setSrc(next);
            setWarned(false);
          }}
        />
        <p className="small muted">{SOURCE_HINT[src]}</p>
      </div>
      <div className="field">
        <label htmlFor="cap-text">One line</label>
        <input
          id="cap-text"
          value={line}
          placeholder="Exam on Friday, nervous #chapter"
          autoComplete="off"
          onChange={(e) => setLine(e.target.value)}
        />
        <span className="help">
          Shortcuts: <span className="mono">@name</span> who else was there ·{" "}
          <span className="mono">#fear #joy #want #value #like</span> sets the category ·{" "}
          <span className="mono">!care</span> also files a care note.
        </span>
      </div>
      <p className="small">
        When: <span className="mono">{nowText()}</span>{" "}
        <span className="muted">(now). Place, category and certainty can be added later from Threads.</span>
      </p>
      {warned && <PromptedWarning onBack={() => setWarned(false)} />}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      {!warned && (
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            Save
          </button>
          <button className="btn ghost" type="button" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </div>
      )}
    </form>
  );
}

function JustMet({ firstName }: { firstName: string }) {
  const { today, setSheet, send, toast, openFile } = usePage();
  const [name, setName] = useState(firstName);
  const [role, setRole] = useState("");
  const [place, setPlace] = useState("");
  const [when, setWhen] = useState(() => dateTimeFrom(null));
  const [first, setFirst] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileId = useRef(newId());
  const entryId = useRef(newId());

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setError("");
    if (!name.trim()) return setError("A first name is enough.");
    const stamp = readDateTime(when, today);
    if (!stamp) return setError("Check the date of “When”.");
    if (stamp.d > today) return setError("“When” is in the future. Check the date.");
    setSaving(true);
    try {
      await send("/api/people", "POST", {
        id: fileId.current,
        name,
        role,
        opened: today,
        entry: {
          ...blankFields(stamp),
          id: entryId.current,
          place: place.trim() || null,
          src: first.trim() ? "U" : "O",
          body: first.trim() || "We met.",
          ctx: "first meeting",
          incomplete: !place.trim(),
        },
      });
      toast(`File opened for ${name.trim()}.`);
      setSheet(null);
      openFile(fileId.current);
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <form className="fs" noValidate onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="met-name">First name</label>
        <input
          id="met-name"
          value={name}
          placeholder="As they introduced themselves"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="help">Filed by first name. Students don’t get a file.</span>
      </div>
      <div className="field">
        <label htmlFor="met-role">How I know them</label>
        <input
          id="met-role"
          value={role}
          placeholder="Friend of Camila, chess club…"
          autoComplete="off"
          onChange={(e) => setRole(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="met-place">Where</label>
        <input
          id="met-place"
          list="dl-places"
          value={place}
          placeholder="Bakery on the corner"
          autoComplete="off"
          onChange={(e) => setPlace(e.target.value)}
        />
      </div>
      <DateTime id="met" label="When" value={when} onChange={setWhen} />
      <div className="field">
        <label htmlFor="met-text">First thing they told me (optional)</label>
        <input
          id="met-text"
          value={first}
          placeholder="Just moved here from Belém"
          autoComplete="off"
          onChange={(e) => setFirst(e.target.value)}
        />
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={saving}>
          Open the file
        </button>
        <button className="btn ghost" type="button" onClick={() => setSheet(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
