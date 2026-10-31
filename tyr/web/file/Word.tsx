// Word given, both ways, and trust watch without a witch hunt: concerns wait for their review, a
// file with one open also shows what is to their credit, and my own errors are on record.
import { useRef, useState, type FormEvent } from "react";
import type { Concern, Person, WordGiven } from "../../shared/protocol.ts";
import { evidenceCanProveBreach } from "../../shared/rules.ts";
import { DateField } from "../forms/DateTime.tsx";
import { byToldDesc } from "../model.ts";
import { newId, usePage } from "../page.ts";
import { addDays, fullDate } from "../time.ts";
import { EntryPicker, EntryPicklist } from "../ui/EntryPicklist.tsx";
import { Marker } from "../ui/Marker.tsx";
import { useSave } from "../ui/useSave.ts";
import { HearsayForm, HearsayRow } from "./Hearsay.tsx";

function WordRow({ word }: { word: WordGiven }) {
  const { today, act, gotoEntry } = usePage();
  const overdue = word.outcome === "pending" && word.due !== null && word.due < today;
  const settle = (outcome: string, done: string) => act(`/api/words/${word.id}`, "PATCH", { outcome, on: today }, done);
  return (
    <div className="prom">
      <q className="words">{word.words}</q>
      <div className="pm">
        <span>made {word.made}</span>
        {word.due && <span>due {word.due}</span>}
        <span className={`out ${overdue ? "overdue" : word.outcome}`}>{overdue ? "Overdue" : word.outcome}</span>
        {word.outcomeOn && <span>{word.outcomeOn}</span>}
        {word.source && (
          <button type="button" className="linkish" onClick={() => gotoEntry(word.source!)}>
            entry
          </button>
        )}
      </div>
      {word.outcome === "pending" ? (
        <div className="row">
          {(["kept", "broken", "released"] as const).map((outcome) => (
            <button
              key={outcome}
              type="button"
              className="btn ghost sm"
              onClick={() => settle(outcome, `Marked ${outcome} · ${today}`)}
            >
              {outcome[0]!.toUpperCase() + outcome.slice(1)}
            </button>
          ))}
        </div>
      ) : (
        word.outcomeOn === today && (
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => settle("pending", "Outcome undone.")}>
              Undo
            </button>
          </div>
        )
      )}
    </div>
  );
}

function WordForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const { ix, today, send, toast } = usePage();
  const [dir, setDir] = useState<"they" | "me">("they");
  const [words, setWords] = useState("");
  const [made, setMade] = useState(today);
  const [due, setDue] = useState("");
  const [source, setSource] = useState("");
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());
  const entries = [...ix.entriesOf(person.id)].sort(byToldDesc);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!words.trim()) return setError("Write the words first.");
    const madeOn = fullDate(made, today);
    if (!madeOn) return setError("When it was given needs a full date, like 2026-11-20.");
    const dueOn = due.trim() ? fullDate(due, today) : null;
    if (due.trim() && !dueOn) return setError("Due needs a full date, or none at all.");
    void run(async () => {
      await send("/api/words", "POST", {
        id: id.current,
        person: person.id,
        dir,
        words,
        made: madeOn,
        due: dueOn,
        source: source || null,
      });
      toast("Word given, recorded.");
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="pf-words">The words</label>
        <input
          id="pf-words"
          value={words}
          placeholder="As close to what was said as I can"
          autoComplete="off"
          autoFocus
          onChange={(e) => setWords(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pf-dir">Who gave their word</label>
        <select id="pf-dir" value={dir} onChange={(e) => setDir(e.target.value as "they" | "me")}>
          <option value="they">They did</option>
          <option value="me">I did</option>
        </select>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="pf-made">Given on</label>
          <DateField id="pf-made" value={made} onChange={setMade} />
        </div>
        <div className="field">
          <label htmlFor="pf-due">Due (optional)</label>
          <DateField id="pf-due" value={due} onChange={setDue} />
        </div>
      </div>
      {entries.length > 0 && (
        <div className="field">
          <label htmlFor="pf-source">Source entry (optional)</label>
          <EntryPicker id="pf-source" entries={entries} value={source} onChange={setSource} />
        </div>
      )}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          Save
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConcernForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const { ix, today, send, toast } = usePage();
  const [text, setText] = useState("");
  const [review, setReview] = useState(addDays(today, 30));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());
  const entries = [...ix.entriesOf(person.id)].sort(byToldDesc);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim()) return setError("Write the worry first, as a fact I can check.");
    const reviewOn = fullDate(review, today);
    if (!reviewOn || reviewOn <= today) return setError("Give the concern a review date after today.");
    void run(async () => {
      await send("/api/concerns", "POST", {
        id: id.current,
        person: person.id,
        text,
        opened: today,
        review: reviewOn,
        ev: [...picked],
      });
      toast(`Concern opened. Review on ${reviewOn}.`);
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="kf-text">The worry, as a fact I can check</label>
        <input
          id="kf-text"
          value={text}
          placeholder="On … they …"
          autoComplete="off"
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="kf-rev">Review on</label>
        <DateField id="kf-rev" value={review} onChange={setReview} />
        <span className="help">Review is mandatory. Nothing becomes a breach before this date.</span>
      </div>
      {entries.length > 0 && (
        <div className="field">
          <span className="flabel">Evidence, so far</span>
          <EntryPicklist entries={entries} picked={picked} onChange={setPicked} />
        </div>
      )}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          Open concern
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConcernReview({ concern }: { concern: Concern }) {
  const { ix, today, send, toast } = usePage();
  const [note, setNote] = useState("");
  const { error, setError, saving, run } = useSave();
  const sources = concern.ev.flatMap((id) => ix.entry(id)?.src ?? []);
  const canBreach = evidenceCanProveBreach(sources);

  const decide = (state: "dismissed" | "breach") => {
    if (!note.trim()) return setError("Write what the review found first.");
    void run(async () => {
      await send(`/api/concerns/${concern.id}/review`, "POST", { state, note, on: today });
      toast(state === "breach" ? "Recorded as a breach." : "Concern dismissed.");
    });
  };

  return (
    <div className="review-form">
      <div className="field">
        <label htmlFor={`rev-${concern.id}`}>What the review found</label>
        <textarea id={`rev-${concern.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button type="button" className="btn ghost sm" disabled={saving} onClick={() => decide("dismissed")}>
          Dismiss after review
        </button>
        <button
          type="button"
          className="btn danger sm"
          disabled={saving || !canBreach}
          onClick={() => decide("breach")}
        >
          Record as breach
        </button>
        {!canBreach && <span className="note">A breach needs evidence beyond my own conclusions.</span>}
      </div>
    </div>
  );
}

function ConcernCard({ concern, person }: { concern: Concern; person: Person }) {
  const { ix, today, send, gotoEntry, toast } = usePage();
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(concern.ev));
  const { error, saving, run } = useSave();
  const evidence = concern.ev.flatMap((id) => ix.entry(id) ?? []);
  const credits = ix.creditsOf(person.id);
  const reports = ix.reportsOf(person.id);
  const entries = [...ix.entriesOf(person.id)].sort(byToldDesc);

  const saveEvidence = () =>
    void run(async () => {
      await send(`/api/concerns/${concern.id}`, "PATCH", { ev: [...picked] });
      toast("Evidence saved.");
      setChanging(false);
    });

  return (
    <div className="card">
      <div className="row spread">
        <span className={`cstate ${concern.state}`}>{concern.state === "open" ? "Concern · open" : concern.state}</span>
        <span className="mono small muted">
          opened {concern.opened} · review {concern.review}
        </span>
      </div>
      <p>{concern.text}</p>
      {evidence.length > 0 && (
        <div className="q-meta">
          <span className="note">Evidence</span>
          {evidence.map((e) => (
            <button key={e.id} type="button" className="ev" title={e.body} onClick={() => gotoEntry(e.id)}>
              <Marker src={e.src} />
              {e.told.d}
            </button>
          ))}
        </div>
      )}
      {concern.state === "open" ? (
        <>
          {changing ? (
            <div className="stack">
              <EntryPicklist entries={entries} picked={picked} onChange={setPicked} />
              {error && (
                <span className="err" role="alert">
                  {error}
                </span>
              )}
              <div className="row">
                <button type="button" className="btn sm" disabled={saving} onClick={saveEvidence}>
                  Save evidence
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setChanging(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              <button type="button" className="btn ghost sm" onClick={() => setChanging(true)}>
                Change evidence
              </button>
            </div>
          )}
          {reports.length > 0 && (
            <div className="fair">
              <h4>Said about me · hearsay, not evidence</h4>
              <ul className="plain">
                {reports.map((r) => (
                  <li key={r.id} className="small">
                    <Marker src="H" /> <span className="mono">{r.told.d}</span> {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="fair">
            <h4>Also true, recently</h4>
            {credits.length > 0 ? (
              <ul className="plain">
                {credits.map((e) => (
                  <li key={e.id} className="small">
                    <Marker src={e.src} /> <span className="mono">{e.told.d}</span> {e.body}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Nothing marked to their credit yet. Look for it before judging.</p>
            )}
          </div>
          {today >= concern.review ? (
            <ConcernReview concern={concern} />
          ) : (
            <span className="note">Review opens on {concern.review}. Until then it stays a concern.</span>
          )}
        </>
      ) : (
        <p className="small">
          <span className="mono">{concern.reviewed}</span> {concern.reviewNote}
        </p>
      )}
    </div>
  );
}

function CorrectionForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const { ix, today, send, toast } = usePage();
  const [text, setText] = useState("");
  const [on, setOn] = useState(today);
  const [entry, setEntry] = useState("");
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());
  const entries = [...ix.entriesOf(person.id)].sort(byToldDesc);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!text.trim()) return setError("Write what I got wrong first.");
    const onDate = fullDate(on, today);
    if (!onDate) return setError("It needs a full date, like 2026-11-20.");
    void run(async () => {
      await send("/api/corrections", "POST", {
        id: id.current,
        person: person.id,
        on: onDate,
        text,
        entry: entry || null,
      });
      toast("Correction logged.");
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor="cr-text">How I read them wrong</label>
        <input
          id="cr-text"
          value={text}
          placeholder="I read her absence as avoidance. She had changed shifts."
          autoComplete="off"
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="cr-on">When I saw it</label>
          <DateField id="cr-on" value={on} onChange={setOn} />
        </div>
        {entries.length > 0 && (
          <div className="field">
            <label htmlFor="cr-entry">The entry (optional)</label>
            <EntryPicker id="cr-entry" entries={entries} value={entry} onChange={setEntry} />
          </div>
        )}
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          Save
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Word({ person }: { person: Person }) {
  const { ix, gotoEntry } = usePage();
  const [form, setForm] = useState<"word" | "concern" | "report" | "correction" | null>(null);
  const words = ix.wordsOf(person.id);
  const they = words.filter((w) => w.dir === "they");
  const me = words.filter((w) => w.dir === "me");
  const concerns = ix.concernsOf(person.id);
  const reports = ix.reportsOf(person.id);
  const corrections = ix.correctionsOf(person.id);
  const close = () => setForm(null);
  const opener = (which: NonNullable<typeof form>, label: string) => (
    <div className="row">
      <button type="button" className="btn ghost sm" onClick={() => setForm(which)}>
        {label}
      </button>
    </div>
  );

  return (
    <div className="stack-lg">
      <div className="two">
        <fieldset>
          <legend>They gave their word</legend>
          {they.length > 0 ? (
            they.map((w) => <WordRow key={w.id} word={w} />)
          ) : (
            <p className="muted small">Nothing recorded.</p>
          )}
        </fieldset>
        <fieldset>
          <legend>I gave my word</legend>
          {me.length > 0 ? (
            me.map((w) => <WordRow key={w.id} word={w} />)
          ) : (
            <p className="muted small">Nothing recorded.</p>
          )}
        </fieldset>
      </div>
      {form === "word" ? <WordForm person={person} onDone={close} /> : opener("word", "Record word given")}

      <section className="section">
        <h4 className="sub-h">Concerns</h4>
        <p className="small muted">
          A worry starts as a concern with a review date. Only after review can it become a breach, with evidence
          attached.
        </p>
        {concerns.length > 0 ? (
          concerns.map((c) => <ConcernCard key={c.id} concern={c} person={person} />)
        ) : (
          <p className="muted small">No concerns.</p>
        )}
        {form === "concern" ? <ConcernForm person={person} onDone={close} /> : opener("concern", "Open a concern")}
      </section>

      <section className="section">
        <h4 className="sub-h">Said about me</h4>
        <p className="small muted">
          What I was told they said about me to others. Hearsay: kept apart, never evidence, and the source isn’t to be
          revealed. If I hear it myself, it is an Observed entry.
        </p>
        {reports.length > 0 ? (
          <div>
            {reports.map((r) => (
              <HearsayRow key={r.id} note={r} />
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing recorded.</p>
        )}
        {form === "report" ? (
          <HearsayForm
            prefix="rp"
            path="/api/said-about-me"
            extra={{ person: person.id }}
            placeholder="Told Jussara I’m hard to work with."
            saveLabel="Save as hearsay"
            onDone={close}
          />
        ) : (
          opener("report", "Record something said about me")
        )}
      </section>

      <section className="section">
        <h4 className="sub-h">Where I read them wrong</h4>
        {corrections.length > 0 ? (
          <ul className="plain">
            {corrections.map((c) => (
              <li key={c.id}>
                <span className="mono small">{c.on}</span> · {c.text}
                {c.entry && (
                  <>
                    {" "}
                    <button type="button" className="linkish" onClick={() => gotoEntry(c.entry!)}>
                      entry
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No corrections logged. A record of my own errors protects against grudges.</p>
        )}
        {form === "correction" ? (
          <CorrectionForm person={person} onDone={close} />
        ) : (
          opener("correction", "Log a correction")
        )}
      </section>
    </div>
  );
}
