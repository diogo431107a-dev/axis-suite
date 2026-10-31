import { useState, type FormEvent } from "react";
import type { Place } from "../../shared/protocol.ts";
import { stampKey } from "../../shared/time.ts";
import { describeError } from "../api.ts";
import { EntryRow } from "../file/EntryRow.tsx";
import { byToldDesc } from "../model.ts";
import { usePage } from "../page.ts";
import { Marker } from "../ui/Marker.tsx";

function PlaceForm({ place, onDone }: { place: Place | null; onDone: () => void }) {
  const { send, toast } = usePage();
  const [label, setLabel] = useState(place?.label ?? "");
  const [city, setCity] = useState(place?.city ?? "");
  const [error, setError] = useState("");

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError("");
    if (!label.trim()) return setError("Write a label first.");
    try {
      if (place) await send(`/api/places/${place.id}`, "PATCH", { label, city });
      else await send("/api/places", "POST", { label, city });
      toast(place ? "Place renamed everywhere." : "Place added.");
      onDone();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <form className="inline-form" noValidate onSubmit={(e) => void submit(e)}>
      <div className="grid2">
        <div className="field">
          <label htmlFor="plf-label">Label</label>
          <input
            id="plf-label"
            value={label}
            placeholder="The bench by the gate"
            autoComplete="off"
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plf-city">City (optional)</label>
          <input id="plf-city" value={city} autoComplete="off" onChange={(e) => setCity(e.target.value)} />
        </div>
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
      <div className="row">
        <button className="btn sm" type="submit">
          {place ? "Save place" : "Add place"}
        </button>
        <button className="btn ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Places() {
  const { ix, ui, patch, act, openFile } = usePage();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rows = ix.dossier.places
    .map((place) => {
      const entries = ix.dossier.entries.filter((e) => e.place === place.id);
      const closed = (id: string) => !!ix.person(id)?.closed;
      const who = [...new Set(entries.map((e) => e.person))].filter((id) => !closed(id));
      const last = entries
        .map((e) => stampKey(e.told))
        .sort()
        .at(-1);
      return { place, entries, who, last };
    })
    .sort((a, b) => b.entries.length - a.entries.length);
  const selected = rows.find((r) => r.place.id === ui.place);
  // Hearsay logged here: never shown among the entries, but it keeps the place on the list.
  const hearsayAt = (place: string) => [
    ...ix.dossier.reports.filter((r) => r.place === place).map((r) => ({ key: r.id, text: r.text })),
    ...ix.dossier.incidents.flatMap((i) =>
      i.notes.filter((n) => n.place === place).map((n) => ({ key: n.id, text: n.text })),
    ),
  ];
  const hearsay = selected ? hearsayAt(selected.place.id) : [];

  return (
    <div className="sheet anim">
      <div className="view-h">
        <h1>Places</h1>
        <p>Labels, not addresses. The same place is spelled the same way every time.</p>
      </div>
      {rows.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Place</th>
                <th>Entries</th>
                <th>Who I meet there</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.place.id} className={ui.place === r.place.id ? "sel" : ""}>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        setRenaming(false);
                        patch({ place: ui.place === r.place.id ? null : r.place.id });
                      }}
                    >
                      {r.place.label}
                    </button>
                    {r.place.city && <span className="muted small"> {r.place.city}</span>}
                  </td>
                  <td className="mono">{r.entries.length}</td>
                  <td>
                    {r.who.length > 0 ? (
                      r.who.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <button type="button" className="linkish" onClick={() => openFile(id)}>
                            {ix.person(id)?.name}
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono">{r.last ? r.last.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No places yet. They are added here, or when an entry names a new one.</p>
      )}
      {adding ? (
        <PlaceForm place={null} onDone={() => setAdding(false)} />
      ) : (
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
            Add place
          </button>
        </div>
      )}
      {selected ? (
        <section className="section">
          <h4 className="sub-h">
            At {selected.place.label} · {selected.entries.length}
          </h4>
          {renaming ? (
            <PlaceForm key={selected.place.id} place={selected.place} onDone={() => setRenaming(false)} />
          ) : (
            <div className="row">
              <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>
                Rename
              </button>
              {selected.entries.length === 0 && hearsay.length === 0 && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => {
                    patch({ place: null });
                    act(`/api/places/${selected.place.id}`, "DELETE", undefined, "Place removed.");
                  }}
                >
                  Remove from the list
                </button>
              )}
            </div>
          )}
          {selected.entries.length > 0 ? (
            [...selected.entries].sort(byToldDesc).map((e) => <EntryRow key={e.id} entry={e} who plain />)
          ) : (
            <p className="muted small">Nothing logged here yet.</p>
          )}
          {hearsay.length > 0 && (
            <ul className="plain">
              {hearsay.map((h) => (
                <li key={h.key} className="small">
                  <Marker src="H" /> {h.text} <span className="muted">· hearsay</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        rows.length > 0 && <p className="muted small">Pick a place to see everything said or seen there.</p>
      )}
    </div>
  );
}
