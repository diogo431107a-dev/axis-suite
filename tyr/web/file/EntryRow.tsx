import { useState } from "react";
import { QUESTIONS, type Entry, type Question } from "../../shared/protocol.ts";
import { usePage } from "../page.ts";
import { PRECISION_LABEL, localInstant, showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";
import { CERTAINTY_LABEL, SOURCE_LABEL, SOURCE_LONG, TOLD_LABEL, questionLabel } from "../vocab.ts";

function EntryDetails({ entry }: { entry: Entry }) {
  const { ix, today, setSheet, send, act, toast, gotoEntry } = usePage();
  const [discarding, setDiscarding] = useState(false);
  const incidents = ix.incidentsOf(entry.person).filter((i) => !i.closed || i.id === entry.incident);
  const amends = ix.entry(entry.amends);
  const contra = ix.entry(entry.contra);
  const amendedBy = ix.entriesOf(entry.person).filter((x) => x.amends === entry.id);
  const guard: string[] = [];
  if (entry.src === "P") guard.push("I asked for this. Don’t present it as something they volunteered.");
  if (entry.src === "I") guard.push("They chose to share it after an open question.");
  if (entry.src === "N") guard.push("My reading. Not their words, not something I saw.");
  if (entry.conf) guard.push("They asked me not to repeat it.");
  if (entry.setting === "private" && entry.src !== "N") guard.push("Said to me in private.");
  if (entry.setting === "group") guard.push("Said or seen in front of others.");

  const link = (e: Entry) => (
    <button key={e.id} type="button" className="linkish" onClick={() => gotoEntry(e.id)}>
      {e.told.d}: {e.body}
    </button>
  );

  return (
    <div className="details">
      <dl className="clocks">
        <div>
          <dt>Happened at</dt>
          <dd>
            {showStamp(entry.hap)}
            <span className="lock">{PRECISION_LABEL[entry.hap.p]}</span>
          </dd>
        </div>
        <div>
          <dt>{TOLD_LABEL[entry.src]}</dt>
          <dd>
            {showStamp(entry.told)}
            <span className="lock">{CERTAINTY_LABEL[entry.cert]}</span>
          </dd>
        </div>
        <div>
          <dt>Logged at</dt>
          <dd>
            {localInstant(entry.logged)}
            <span className="lock">set by the system, fixed</span>
          </dd>
        </div>
      </dl>
      {guard.length > 0 && (
        <div className="guard">
          <b>Before mentioning it</b>
          {guard.map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
      )}
      <dl className="kv">
        <dt>Source</dt>
        <dd>
          <Marker src={entry.src} /> {SOURCE_LONG[entry.src]} ·{" "}
          {entry.wording === "quote" ? "their exact words" : "paraphrased"}
        </dd>
        <dt>
          <label htmlFor={`file-${entry.id}`}>Filed under</label>
        </dt>
        <dd>
          <select
            id={`file-${entry.id}`}
            className="inline"
            value={entry.cat ?? ""}
            onChange={(e) =>
              act(`/api/entries/${entry.id}`, "PATCH", { cat: (e.target.value || null) as Question | null })
            }
          >
            <option value="">Not filed</option>
            {QUESTIONS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </dd>
        <dt>
          <label htmlFor={`credit-${entry.id}`}>To their credit</label>
        </dt>
        <dd>
          <input
            id={`credit-${entry.id}`}
            type="checkbox"
            checked={entry.credit}
            onChange={(e) => act(`/api/entries/${entry.id}`, "PATCH", { credit: e.target.checked })}
          />
        </dd>
        {incidents.length > 0 && (
          <>
            <dt>
              <label htmlFor={`inc-${entry.id}`}>Incident</label>
            </dt>
            <dd>
              <select
                id={`inc-${entry.id}`}
                className="inline"
                value={entry.incident ?? ""}
                onChange={(e) => act(`/api/entries/${entry.id}`, "PATCH", { incident: e.target.value || null })}
              >
                <option value="">None</option>
                {incidents.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
            </dd>
          </>
        )}
        {entry.ctx && (
          <>
            <dt>Occasion</dt>
            <dd>{entry.ctx}</dd>
          </>
        )}
        {entry.fu && (
          <>
            <dt>Follow-up</dt>
            <dd>
              <span className="mono">{entry.fu.date}</span> · {entry.fu.note}
              {entry.fu.done ? ` · done ${entry.fu.done} ` : " "}
              <button
                type="button"
                className="btn ghost sm"
                onClick={() =>
                  act(
                    `/api/entries/${entry.id}`,
                    "PATCH",
                    { fuDone: entry.fu?.done ? null : today },
                    entry.fu?.done ? "Follow-up open again." : `Follow-up done · ${today}`,
                  )
                }
              >
                {entry.fu.done ? "Not done after all" : "Mark done"}
              </button>
            </dd>
          </>
        )}
        {amends && (
          <>
            <dt>Amends</dt>
            <dd>{link(amends)}</dd>
          </>
        )}
        {amendedBy.length > 0 && (
          <>
            <dt>Amended by</dt>
            <dd className="stack">{amendedBy.map(link)}</dd>
          </>
        )}
        {contra && (
          <>
            <dt>Contradicts</dt>
            <dd>{link(contra)}</dd>
          </>
        )}
      </dl>
      <div className="row">
        {entry.incomplete && (
          <button
            type="button"
            className="btn sm"
            onClick={() => setSheet({ what: "entry", pid: entry.person, mode: "complete", eid: entry.id })}
          >
            Complete this entry
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setSheet({ what: "entry", pid: entry.person, mode: "amend", eid: entry.id })}
        >
          Amend with a new entry
        </button>
        {entry.incomplete && !discarding && (
          <button type="button" className="btn ghost sm" onClick={() => setDiscarding(true)}>
            Discard this capture
          </button>
        )}
        {discarding && (
          <>
            <button
              type="button"
              className="btn danger sm"
              onClick={() => {
                send(`/api/entries/${entry.id}`, "DELETE")
                  .then(() => toast("Capture discarded."))
                  .catch(() => toast("That capture could not be discarded. Try again."));
              }}
            >
              Discard for good
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setDiscarding(false)}>
              Keep it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function EntryRow({ entry, who, plain }: { entry: Entry; who?: boolean; plain?: boolean }) {
  const { ix, ui, patch } = usePage();
  const open = ui.open.has(entry.id);
  const shown = ui.order === "hap" && !plain ? entry.hap : entry.told;
  const amendedLater = ix.entriesOf(entry.person).some((x) => x.amends === entry.id);
  const amended = ix.entry(entry.amends);
  const place = ix.placeLabel(entry.place);
  const meta = [
    place,
    entry.setting && (entry.setting === "private" ? "in private" : "in a group"),
    entry.cat && questionLabel(entry.cat),
    entry.cert !== "sure" && CERTAINTY_LABEL[entry.cert],
    entry.present.length > 0 && `with ${entry.present.join(", ")}`,
  ].filter(Boolean);
  const incidentTitle = ix.dossier.incidents.find((i) => i.id === entry.incident)?.title;
  const hasFlags = entry.conf || entry.incomplete || !!amended || amendedLater || entry.credit || !!incidentTitle;

  const toggle = () => {
    const next = new Set(ui.open);
    if (open) next.delete(entry.id);
    else next.add(entry.id);
    patch({ open: next });
  };

  return (
    <article className={`entry ${ui.flash === entry.id ? "flash" : ""}`} id={`en-${entry.id}`}>
      <div className="en-date mono">{showStamp(shown)}</div>
      <div className="en-main">
        <button type="button" className="en-head" aria-expanded={open} onClick={toggle}>
          <span className="src">
            <Marker src={entry.src} />
            {SOURCE_LABEL[entry.src]}
          </span>
          {who && <span className="en-who">{ix.person(entry.person)?.name}</span>}
          <span className="en-body">
            {entry.wording === "quote" ? (
              <q className="quote">{entry.body}</q>
            ) : (
              <span className="para">{entry.body}</span>
            )}
          </span>
        </button>
        {(meta.length > 0 || hasFlags) && (
          <div className="en-meta">
            {meta.join(" · ")}
            {entry.conf && <span className="flag conf">Asked me not to repeat</span>}
            {entry.incomplete && <span className="flag inc">Incomplete</span>}
            {amended && <span className="flag">Amends {amended.told.d}</span>}
            {amendedLater && <span className="flag">Amended later</span>}
            {entry.credit && <span className="flag credit">To their credit</span>}
            {incidentTitle && <span className="flag">{incidentTitle}</span>}
          </div>
        )}
        {open && <EntryDetails entry={entry} />}
      </div>
    </article>
  );
}
