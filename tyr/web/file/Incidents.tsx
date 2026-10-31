// Incidents: a fight, an arrest, a move. What I saw or was told stays an ordinary entry that points
// here, and only hearsay is written into the incident itself.
import { useRef, useState, type FormEvent } from "react";
import { INCIDENT_STATUSES, type Incident, type IncidentStatus, type Person } from "../../shared/protocol.ts";
import { DateField } from "../forms/DateTime.tsx";
import type { IncidentStep } from "../model.ts";
import { newId, usePage } from "../page.ts";
import { fullDate, showStamp } from "../time.ts";
import { Marker } from "../ui/Marker.tsx";
import { useSave } from "../ui/useSave.ts";
import { SOURCE_LONG, STATUS_LABEL } from "../vocab.ts";
import { HearsayForm, HearsayRow } from "./Hearsay.tsx";

const splitOn = (text: string, separator: string) =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);

function IncidentForm({ person, incident, onDone }: { person: Person; incident: Incident | null; onDone: () => void }) {
  const { ix, today, send, toast } = usePage();
  const [title, setTitle] = useState(incident?.title ?? "");
  const [people, setPeople] = useState(
    incident ? incident.people.flatMap((id) => ix.person(id)?.name ?? []).join(", ") : person.name,
  );
  const [mentions, setMentions] = useState(incident?.mentions.join("; ") ?? "");
  const [status, setStatus] = useState<IncidentStatus>("one");
  const [opened, setOpened] = useState(today);
  const { error, setError, saving, run } = useSave();
  const id = useRef(newId());
  const prefix = incident ? `if-${incident.id}` : "if-new";

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) return setError("Give it a title first.");
    const typed = splitOn(people, ",");
    const unknown = typed.find((name) => !ix.findPerson(name));
    if (unknown) return setError(`No file for ${unknown}. Someone with no file goes under mentions.`);
    const ids = [...new Set(typed.flatMap((name) => ix.findPerson(name)?.id ?? []))];
    if (ids.length === 0) return setError("An incident involves at least one file.");
    const openedOn = fullDate(opened, today);
    if (!openedOn) return setError("It needs a full date, like 2026-11-20.");
    const fields = { title, people: ids, mentions: splitOn(mentions, ";") };
    void run(async () => {
      if (incident) await send(`/api/incidents/${incident.id}`, "PATCH", fields);
      else await send("/api/incidents", "POST", { ...fields, id: id.current, status, opened: openedOn });
      toast(incident ? "Incident saved." : "Incident opened.");
      onDone();
    });
  };

  return (
    <form className="inline-form" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${prefix}-title`}>Title</label>
        <input
          id={`${prefix}-title`}
          value={title}
          placeholder="Argument over the old house"
          autoComplete="off"
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-people`}>Files it involves</label>
        <input
          id={`${prefix}-people`}
          list="dl-people"
          value={people}
          placeholder="Names, separated by commas"
          autoComplete="off"
          onChange={(e) => setPeople(e.target.value)}
        />
        {incident && <span className="help">A file taken out here takes its entries out of the incident.</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-mentions`}>Mentions</label>
        <input
          id={`${prefix}-mentions`}
          value={mentions}
          placeholder="Rodrigo, Marcos’s brother; their mother"
          autoComplete="off"
          onChange={(e) => setMentions(e.target.value)}
        />
        <span className="help">People with no file, separated by semicolons.</span>
      </div>
      {!incident && (
        <div className="grid2">
          <div className="field">
            <label htmlFor="if-status">What is known</label>
            <select id="if-status" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="if-opened">Opened</label>
            <DateField id="if-opened" value={opened} onChange={setOpened} />
          </div>
        </div>
      )}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit" disabled={saving}>
          {incident ? "Save" : "Open incident"}
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Step({ step }: { step: IncidentStep }) {
  const { ix, gotoEntry } = usePage();
  if (step.kind === "hearsay") {
    return (
      <li>
        <HearsayRow note={step.note} />
      </li>
    );
  }
  const { entry } = step;
  const place = ix.placeLabel(entry.place);
  return (
    <li>
      <span className="sd">
        <span>happened {showStamp(entry.hap)}</span>
        <span>told {showStamp(entry.told)}</span>
        {place && <span>{place}</span>}
      </span>
      <span>{entry.body}</span>
      <span className="sd">
        <Marker src={entry.src} /> {SOURCE_LONG[entry.src]} · {ix.person(entry.person)?.name} ·{" "}
        <button type="button" className="linkish" onClick={() => gotoEntry(entry.id)}>
          entry
        </button>
      </span>
    </li>
  );
}

function IncidentCard({ incident, person }: { incident: Incident; person: Person }) {
  const { ix, today, act, send, toast, setSheet } = usePage();
  const [form, setForm] = useState<"change" | "hearsay" | "close" | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const { error, setError, saving, run } = useSave();
  const steps = ix.incidentSteps(incident);
  const others = incident.people.flatMap((id) => ix.person(id)?.name ?? []).join(", ");

  const close = () => {
    if (!closeNote.trim()) return setError("Write a closing note first.");
    void run(async () => {
      await send(`/api/incidents/${incident.id}`, "PATCH", { closed: { on: today, note: closeNote } });
      toast(`Closed ${today}. The incident is kept.`);
      setForm(null);
    });
  };

  return (
    <div className="card">
      <div className="row spread">
        <h3>{incident.title}</h3>
        <div className="row">
          <span className={`istat ${incident.status}`}>{STATUS_LABEL[incident.status]}</span>
          {incident.closed && <span className="stamp closed sm">Closed {incident.closed}</span>}
        </div>
      </div>
      <p className="small muted mono">
        Opened {incident.opened} · {others}
      </p>
      {incident.mentions.length > 0 && (
        <div className="row">
          {incident.mentions.map((mention) => (
            <span key={mention} className="mention">
              {mention}{" "}
              <button
                type="button"
                className="linkish small"
                onClick={() => setSheet({ what: "muninn", tab: "met", name: mention.split(",")[0]!.trim() })}
              >
                Open a file
              </button>
            </span>
          ))}
        </div>
      )}
      {steps.length > 0 ? (
        <ol className="steps">
          {steps.map((step) => (
            <Step key={step.kind === "entry" ? step.entry.id : step.note.id} step={step} />
          ))}
        </ol>
      ) : (
        <p className="muted small">Nothing in it yet. Add an entry, or hearsay if that is all there is.</p>
      )}
      {incident.closed ? (
        <>
          {incident.closeNote && (
            <p className="small">
              <b>Closing note.</b> {incident.closeNote}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => act(`/api/incidents/${incident.id}`, "PATCH", { closed: null }, "Incident reopened.")}
            >
              Reopen
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <label className="flabel" htmlFor={`ist-${incident.id}`}>
              What is known
            </label>
            <select
              id={`ist-${incident.id}`}
              className="inline"
              value={incident.status}
              onChange={(e) => {
                const to = e.target.value as IncidentStatus;
                act(
                  `/api/incidents/${incident.id}`,
                  "PATCH",
                  { status: { to, on: today } },
                  `Status: ${STATUS_LABEL[to]}`,
                );
              }}
            >
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setSheet({ what: "entry", pid: person.id, mode: "new", incident: incident.id })}
            >
              Add entry
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setForm("hearsay")}>
              Add hearsay
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setForm("change")}>
              Change
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setForm("close")}>
              Close
            </button>
          </div>
          {form === "change" && <IncidentForm person={person} incident={incident} onDone={() => setForm(null)} />}
          {form === "hearsay" && (
            <HearsayForm
              prefix={`in-${incident.id}`}
              path={`/api/incidents/${incident.id}/notes`}
              placeholder="The hearing is set for mid-November."
              saveLabel="Save as hearsay"
              onDone={() => setForm(null)}
            />
          )}
          {form === "close" && (
            <div className="inline-form">
              <div className="field">
                <label htmlFor={`cl-${incident.id}`}>Closing note</label>
                <input
                  id={`cl-${incident.id}`}
                  value={closeNote}
                  placeholder="Settled between them. Nothing for me to carry."
                  autoComplete="off"
                  autoFocus
                  onChange={(e) => setCloseNote(e.target.value)}
                />
                <span className="help">Closed doesn’t mean deleted.</span>
              </div>
              {error && (
                <span className="err" role="alert">
                  {error}
                </span>
              )}
              <div className="row">
                <button type="button" className="btn sm" disabled={saving} onClick={close}>
                  Close the incident
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="small muted mono">
        Status history: {incident.history.map((h) => `${h.on} ${STATUS_LABEL[h.status]}`).join(" → ")}
      </p>
    </div>
  );
}

export function Incidents({ person }: { person: Person }) {
  const { ix } = usePage();
  const [adding, setAdding] = useState(false);
  const list = ix.incidentsOf(person.id);
  return (
    <div className="stack">
      {list.length > 0 ? (
        list.map((i) => <IncidentCard key={i.id} incident={i} person={person} />)
      ) : (
        <p className="muted">
          No incidents. An incident groups several entries into one story: a fight, an arrest, a move.
        </p>
      )}
      {adding ? (
        <IncidentForm person={person} incident={null} onDone={() => setAdding(false)} />
      ) : (
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
            Open an incident
          </button>
        </div>
      )}
    </div>
  );
}
