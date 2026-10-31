import type { Entry, Person } from "../../shared/protocol.ts";
import { usePage } from "../page.ts";
import { showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";
import { SOURCES } from "../../shared/protocol.ts";
import { SOURCE_LABEL } from "../vocab.ts";
import { Profile } from "./Profile.tsx";
import { Timeline } from "./Timeline.tsx";

/** The pane when no file is open. */
export function NoFile() {
  const { ix, today, setSheet } = usePage();
  const entries = ix.dossier.entries;
  const words = entries.filter((e) => e.src === "U" || e.src === "I").length;
  const files = ix.openFiles().length;

  if (ix.dossier.people.length === 0) {
    return (
      <div className="sheet anim">
        <div className="empty">
          <div className="file-meta">Drawer · empty</div>
          <h1>No files yet.</h1>
          <p className="muted">
            A file starts when you meet someone: a first name, where, and when. Entries are added, never overwritten.
          </p>
          <button type="button" className="btn" onClick={() => setSheet({ what: "muninn", tab: "met" })}>
            Open the first file
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sheet anim">
      <div className="empty">
        <div className="file-meta">Drawer · {files} files</div>
        <h1>No file open.</h1>
        <p className="muted">
          Pick a name from the drawer. Files open in read mode; entries are added, never overwritten.
        </p>
        <div className="stats">
          <div className="stat">
            <b className="mono">{entries.length}</b>
            <span>Entries</span>
          </div>
          <div className="stat">
            <b className="mono">{entries.length ? Math.round((words / entries.length) * 100) : 0}%</b>
            <span>In their own words</span>
          </div>
          <div className="stat">
            <b className="mono">{ix.overdueCount(today)}</b>
            <span>Overdue threads</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Balance({ entries }: { entries: Entry[] }) {
  const total = entries.length || 1;
  const counts = Object.fromEntries(SOURCES.map((s) => [s, entries.filter((e) => e.src === s).length]));
  const own = Math.round((((counts.U ?? 0) + (counts.I ?? 0)) / total) * 100);
  return (
    <fieldset>
      <legend>Whose voice</legend>
      <div className="balance">
        <div className="bal-bar" role="img" aria-label={`${own}% in their own words`}>
          {SOURCES.map((s) =>
            counts[s] ? (
              <span key={s} className={`bal-${s}`} style={{ width: `${((counts[s] ?? 0) / total) * 100}%` }} />
            ) : null,
          )}
        </div>
        <div className="bal-legend">
          {SOURCES.map((s) => (
            <span key={s}>
              <Marker src={s} />
              {SOURCE_LABEL[s]} <b>{counts[s]}</b>
            </span>
          ))}
          <span className="muted">· {own}% in their own words</span>
        </div>
      </div>
    </fieldset>
  );
}

function Pinned({ person }: { person: Person }) {
  const { ix, today, setSheet, act, gotoEntry } = usePage();
  const threads = ix.threads(person.id, today);
  return (
    <div className="pinned">
      <fieldset>
        <legend>Matters most to them</legend>
        {person.matters.length > 0 ? (
          <ul className="plain">
            {person.matters.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Not yet known.</p>
        )}
        <div className="row mt">
          <button type="button" className="btn ghost sm" onClick={() => setSheet({ what: "details", pid: person.id })}>
            Change
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Open threads</legend>
        {threads.length > 0 ? (
          <ul className="plain threads">
            {threads.map((t) => (
              <li key={`${t.kind}-${t.entry}`}>
                <span className={`tk ${t.over ? "overdue" : ""}`}>
                  {t.due ? `${t.over ? "overdue " : ""}${t.due}` : t.kind}
                </span>
                <span className="small">
                  <b>{t.kind}.</b>{" "}
                  <button type="button" className="linkish" onClick={() => gotoEntry(t.entry)}>
                    {t.text}
                  </button>
                  {t.kind === "Follow-up" && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() =>
                          act(`/api/entries/${t.entry}`, "PATCH", { fuDone: today }, `Follow-up done · ${today}`)
                        }
                      >
                        Done
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing open.</p>
        )}
      </fieldset>
    </div>
  );
}

export function FileView({ person }: { person: Person }) {
  const { ix, today, ui, patch, setSheet } = usePage();
  const status = ix.status(person, today);
  const last = ix.lastContact(person.id);
  const entries = ix.entriesOf(person.id);
  const prompted = entries.filter((e) => e.src === "P").length;

  return (
    <div className="sheet anim">
      <div className="file-meta">
        <button type="button" className="btn ghost sm back" onClick={() => patch({ pid: null, view: "file" })}>
          ← Drawer
        </button>
        <span>File TYR-{String(person.no).padStart(4, "0")}</span>
        <span>Opened {person.opened}</span>
        <span className={`stamp ${status}`}>{status}</span>
      </div>
      <div className="file-head">
        <div>
          <h1 className="file-name">
            {person.name}
            {person.aliases.length > 0 && <span className="alias">{person.aliases.join(", ")}</span>}
          </h1>
          <p className="file-role">{person.role}</p>
          <p className="lastc">
            {person.closed ? (
              <>
                Closed <span className="mono">{person.closed}</span>
                {person.closeNote && ` · ${person.closeNote}`}
              </>
            ) : last ? (
              <>
                Last contact <span className="mono">{showStamp(last.told)}</span>
                {last.place && ` · ${ix.placeLabel(last.place)}`}
                {status === "dormant" && <span className="muted"> · no contact in over six months</span>}
              </>
            ) : (
              "No contact logged yet."
            )}
          </p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setSheet({ what: "entry", pid: person.id, mode: "new" })}
          >
            Add entry
          </button>
          <button type="button" className="btn ghost" onClick={() => setSheet({ what: "details", pid: person.id })}>
            File details
          </button>
          <button type="button" className="btn ghost" onClick={() => patch({ pid: null, view: "file" })}>
            Return to drawer
          </button>
        </div>
      </div>
      <Pinned person={person} />
      <Balance entries={entries} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={ui.tab === "profile"} onClick={() => patch({ tab: "profile" })}>
          Profile
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={ui.tab === "timeline"}
          onClick={() => patch({ tab: "timeline" })}
        >
          Timeline<span className="n">{entries.length}</span>
        </button>
      </div>
      <div className="tabbody">{ui.tab === "profile" ? <Profile person={person} /> : <Timeline person={person} />}</div>
      <p className="readmode">
        Read mode. Entries are appended; corrections are new entries that amend old ones.
        {prompted > 0 && ` ${prompted} prompted entr${prompted === 1 ? "y" : "ies"} kept in a separate ledger.`}
      </p>
    </div>
  );
}
