import { useState } from "react";
import { QUESTIONS, type Entry, type Person, type Question } from "../../shared/protocol.ts";
import { DORMANT_DAYS, basisOf } from "../model.ts";
import { usePage } from "../page.ts";
import { daysBetween, showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";
import { SOURCE_LABEL, SOURCE_LONG, questionLabel } from "../vocab.ts";

const FIRST_SECTION = 9;

function EvidenceChip({ entry }: { entry: Entry }) {
  const { gotoEntry } = usePage();
  return (
    <button
      type="button"
      className="ev"
      title={`${SOURCE_LONG[entry.src]}: ${entry.body}`}
      onClick={() => gotoEntry(entry.id)}
    >
      <Marker src={entry.src} />
      {entry.told.d}
    </button>
  );
}

/** Two statements side by side with their dates, and never a verdict, unless what I saw outweighs words. */
function ContradictionPair({ earlier, later }: { earlier: Entry; later: Entry }) {
  const side = (e: Entry) => (
    <div>
      <span className="side">
        <Marker src={e.src} />
        {SOURCE_LABEL[e.src].toUpperCase()} · {showStamp(e.told)}
      </span>
      {e.wording === "quote" ? <q className="quote">{e.body}</q> : e.body}
    </div>
  );
  const seen = earlier.src === "O" || later.src === "O";
  return (
    <div className="contra">
      {side(earlier)}
      {side(later)}
      <p className="contra-rule">
        {Math.abs(daysBetween(earlier.told.d, later.told.d))} days apart.{" "}
        {seen ? "Observed behaviour outweighs words." : "No verdict; people change, and the dates show it."}
      </p>
    </div>
  );
}

function QuestionBlock({ person, q, label, sub }: { person: Person; q: Question; label: string; sub: string }) {
  const { ix, today, setSheet } = usePage();
  const [showOlder, setShowOlder] = useState(false);
  const versions = ix.answersTo(person.id, q);
  const answer = versions.at(-1);
  const older = versions.slice(0, -1).reverse();
  const entries = ix.entriesOf(person.id);
  const filed = entries.filter((e) => e.cat === q && e.src !== "P");
  const pairs = q === "contra" ? entries.filter((e) => e.contra) : [];
  const write = () => setSheet({ what: "answer", pid: person.id, q });

  if (!answer && filed.length === 0 && pairs.length === 0) {
    return (
      <div className="q gap">
        <div className="q-l">
          {label}
          {sub && <small>{sub}</small>}
        </div>
        <div className="q-a">
          <div className="row">
            <span className="unknown">Not yet known</span>
            <button type="button" className="btn ghost sm" onClick={write}>
              Write answer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cited = answer ? answer.ev.flatMap((id) => ix.entry(id) ?? []) : entries.filter((e) => e.cat === q);
  const evidence = answer ? cited.filter((e) => e.src !== "P") : filed;
  const promptedLeftOut = cited.filter((e) => e.src === "P").length;
  const basis = basisOf(evidence);
  const stale = answer ? daysBetween(answer.revised, today) > DORMANT_DAYS : false;

  return (
    <div className="q">
      <div className="q-l">
        {label}
        {sub && <small>{sub}</small>}
      </div>
      <div className="q-a">
        {answer ? (
          <p>{answer.text}</p>
        ) : (
          <p className="noans">
            No answer written yet. {filed.length} entr{filed.length === 1 ? "y" : "ies"} filed here.
          </p>
        )}
        <div className="q-meta">
          <span className={`basis ${basis.kind}`}>{basis.label}</span>
          {evidence.map((e) => (
            <EvidenceChip key={e.id} entry={e} />
          ))}
          {answer && <span className="rev mono">revised {answer.revised}</span>}
          {stale && <span className="stale">Check if still true</span>}
          {promptedLeftOut > 0 && (
            <span className="note">
              {promptedLeftOut} prompted entr{promptedLeftOut === 1 ? "y" : "ies"} left out
            </span>
          )}
          <button type="button" className="btn ghost sm" onClick={write}>
            {answer ? "Revise" : "Write answer"}
          </button>
          {older.length > 0 && (
            <button type="button" className="linkish small" onClick={() => setShowOlder(!showOlder)}>
              {showOlder ? "Hide earlier versions" : `Earlier versions (${older.length})`}
            </button>
          )}
        </div>
        {showOlder && (
          <div className="older">
            {older.map((v) => (
              <div key={v.id}>
                <div className="mono">{v.revised}</div>
                {v.text}
              </div>
            ))}
          </div>
        )}
        {pairs.map((e) => {
          const other = ix.entry(e.contra);
          return other ? <ContradictionPair key={e.id} earlier={other} later={e} /> : null;
        })}
      </div>
    </div>
  );
}

export function Profile({ person }: { person: Person }) {
  const { ix } = usePage();
  const gaps = ix.gaps(person.id);
  const block = ([q, label, sub]: (typeof QUESTIONS)[number]) => (
    <QuestionBlock key={q} person={person} q={q} label={label} sub={sub} />
  );
  return (
    <div className="stack-lg">
      {gaps.length > 0 && (
        <p className="gapline">
          <b>Not heard yet:</b> {gaps.map((g) => questionLabel(g as Question).toLowerCase()).join("; ")}. Gaps are for
          listening, not for asking.
        </p>
      )}
      <section className="qsec">
        <h2>Profile</h2>
        {QUESTIONS.slice(0, FIRST_SECTION).map(block)}
      </section>
      <section className="qsec">
        <h2>Added questions</h2>
        {QUESTIONS.slice(FIRST_SECTION).map(block)}
      </section>
    </div>
  );
}
