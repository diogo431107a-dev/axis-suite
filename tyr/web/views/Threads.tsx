import { EntryRow } from "../file/EntryRow.tsx";
import type { Thread } from "../model.ts";
import { usePage } from "../page.ts";
import { showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";

export function Threads() {
  const { ix, today, setSheet, act, openFile, gotoEntry } = usePage();
  const live = ix.openFiles();
  const followUps = live.flatMap((p) => ix.threads(p.id, today)).filter((t) => t.kind === "Follow-up");
  const over = followUps.filter((t) => t.over);
  const soon = followUps.filter((t) => !t.over);
  const closedIds = new Set(ix.dossier.people.filter((p) => p.closed).map((p) => p.id));
  const inbox = ix.dossier.entries.filter((e) => e.incomplete && !closedIds.has(e.person));
  const monthDay = today.slice(5);
  const onThisDay = ix.dossier.entries.filter(
    (e) => e.told.p === "date" && e.told.d.slice(5) === monthDay && e.told.d < today.slice(0, 4),
  );
  const dormant = live.filter((p) => ix.status(p, today) === "dormant");

  const table = (rows: Thread[]) =>
    rows.length > 0 ? (
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>File</th>
              <th>Follow-up</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.entry}>
                <td className="mono">{t.due}</td>
                <td>
                  <button type="button" className="linkish" onClick={() => openFile(t.person)}>
                    {ix.person(t.person)?.name}
                  </button>
                </td>
                <td>
                  <button type="button" className="linkish" onClick={() => gotoEntry(t.entry)}>
                    {t.text}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() =>
                      act(`/api/entries/${t.entry}`, "PATCH", { fuDone: today }, `Follow-up done · ${today}`)
                    }
                  >
                    Done
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="muted small">None.</p>
    );

  return (
    <div className="sheet anim">
      <div className="view-h">
        <h1>Threads</h1>
        <p>
          Everything left open across the drawer: follow-ups and entries to complete. Tyr keeps its own list; it sends
          nothing to other apps.
        </p>
      </div>
      <section className="section">
        <h4 className="sub-h over">Overdue · {over.length}</h4>
        {table(over)}
      </section>
      <section className="section">
        <h4 className="sub-h">Coming up · {soon.length}</h4>
        {table(soon)}
      </section>
      <section className="section">
        <h4 className="sub-h">Incomplete entries · {inbox.length}</h4>
        <p className="small muted">Quick captures waiting for a place, a category or a time.</p>
        {inbox.length > 0 ? (
          inbox.map((e) => (
            <div key={e.id} className="row inbox-row">
              <span>
                <Marker src={e.src} /> <b>{ix.person(e.person)?.name}</b> ·{" "}
                <span className="mono small">{showStamp(e.told)}</span> · {e.body}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => setSheet({ what: "entry", pid: e.person, mode: "complete", eid: e.id })}
              >
                Complete
              </button>
            </div>
          ))
        ) : (
          <p className="muted small">Inbox empty.</p>
        )}
      </section>
      <section className="section">
        <h4 className="sub-h">On this day · {monthDay}</h4>
        {onThisDay.length > 0 ? (
          onThisDay.map((e) => <EntryRow key={e.id} entry={e} who plain />)
        ) : (
          <p className="muted small">Nothing logged on this day in earlier years.</p>
        )}
      </section>
      <section className="section">
        <h4 className="sub-h">Dormant · no contact in six months</h4>
        {dormant.length > 0 ? (
          <ul className="plain">
            {dormant.map((p) => (
              <li key={p.id}>
                <button type="button" className="linkish" onClick={() => openFile(p.id)}>
                  {p.name}
                </button>{" "}
                <span className="mono small muted">last {ix.lastContact(p.id)?.told.d ?? "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">None.</p>
        )}
      </section>
    </div>
  );
}
