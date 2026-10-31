import { SOURCES } from "../../shared/protocol.ts";
import { fold } from "../../shared/time.ts";
import { EntryRow } from "../file/EntryRow.tsx";
import { byToldDesc } from "../model.ts";
import { usePage, type Tab } from "../page.ts";
import { Marker } from "../ui/Marker.tsx";
import { SOURCE_LABEL, questionLabel } from "../vocab.ts";

export function Search() {
  const { ix, ui, patch, openFile } = usePage();
  const query = fold(ui.q.trim());
  const results = ix.dossier.entries
    .filter((e) => ui.showClosed || !ix.person(e.person)?.closed)
    .filter((e) => ui.qsrc.has(e.src))
    .filter((e) => !ui.qplace || e.place === ui.qplace)
    .filter((e) => {
      if (!query) return true;
      const person = ix.person(e.person);
      return fold(
        [
          e.body,
          e.ctx,
          ix.placeLabel(e.place),
          person?.name,
          ...(person?.aliases ?? []),
          ...e.present,
          e.cat ? questionLabel(e.cat) : "",
          e.told.d,
          e.hap.d,
        ].join(" "),
      ).includes(query);
    })
    .sort(byToldDesc);

  // The rest of a file, for anything else the words appear in.
  const elsewhere: { key: string; kind: string; person: string; text: string; tab: Tab }[] = [];
  const visible = (id: string) => ui.showClosed || !ix.person(id)?.closed;
  if (query) {
    const found = (...parts: (string | null)[]) => fold(parts.join(" ")).includes(query);
    for (const c of ix.dossier.care) {
      if (visible(c.person) && found(c.text)) {
        elsewhere.push({ key: c.id, kind: "Care note", person: c.person, text: c.text, tab: "profile" });
      }
    }
    for (const w of ix.dossier.words) {
      if (visible(w.person) && found(w.words)) {
        elsewhere.push({ key: w.id, kind: "Word given", person: w.person, text: w.words, tab: "word" });
      }
    }
    for (const c of ix.dossier.concerns) {
      if (visible(c.person) && found(c.text, c.reviewNote)) {
        elsewhere.push({ key: c.id, kind: "Concern", person: c.person, text: c.text, tab: "word" });
      }
    }
    for (const r of ix.dossier.reports) {
      if (visible(r.person) && found(r.text, r.by, ix.placeLabel(r.place))) {
        elsewhere.push({ key: r.id, kind: "Said about me · hearsay", person: r.person, text: r.text, tab: "word" });
      }
    }
    for (const i of ix.dossier.incidents) {
      const person = i.people.find(visible);
      if (!person) continue;
      if (found(i.title, i.mentions.join(" "), i.closeNote)) {
        elsewhere.push({ key: i.id, kind: "Incident", person, text: i.title, tab: "incidents" });
      }
      for (const n of i.notes) {
        if (found(n.text, n.by, ix.placeLabel(n.place))) {
          elsewhere.push({ key: n.id, kind: "Incident · hearsay", person, text: n.text, tab: "incidents" });
        }
      }
    }
  }

  return (
    <div className="sheet anim">
      <div className="view-h">
        <h1>Search</h1>
        <p>Across all files: who said what, where and when.</p>
      </div>
      <div className="stack">
        <input
          value={ui.q}
          placeholder="marathon, bakery, 2026-09, Fernanda…"
          autoComplete="off"
          aria-label="Search entries"
          onChange={(e) => patch({ q: e.target.value })}
        />
        <div className="controls">
          <div className="chips">
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={ui.qsrc.has(s)}
                onClick={() => {
                  const next = new Set(ui.qsrc);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  patch({ qsrc: next });
                }}
              >
                <Marker src={s} />
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          <select
            className="pick"
            aria-label="Place"
            value={ui.qplace}
            onChange={(e) => patch({ qplace: e.target.value })}
          >
            <option value="">Any place</option>
            {ix.dossier.places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <p className="mono small muted">
          {results.length} entr{results.length === 1 ? "y" : "ies"}
        </p>
        {results.map((e) => (
          <EntryRow key={e.id} entry={e} who plain />
        ))}
      </div>
      {elsewhere.length > 0 && (
        <section className="section">
          <h4 className="sub-h">Elsewhere in the files · {elsewhere.length}</h4>
          <ul className="plain">
            {elsewhere.map((x) => (
              <li key={x.key}>
                <span className="tk">{x.kind}</span> <b>{ix.person(x.person)?.name}</b> ·{" "}
                <button type="button" className="linkish" onClick={() => openFile(x.person, x.tab)}>
                  {x.text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
