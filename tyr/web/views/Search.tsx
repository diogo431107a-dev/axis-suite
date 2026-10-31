import { SOURCES } from "../../shared/protocol.ts";
import { fold } from "../../shared/time.ts";
import { EntryRow } from "../file/EntryRow.tsx";
import { byToldDesc } from "../model.ts";
import { usePage } from "../page.ts";
import { Marker } from "../ui/Marker.tsx";
import { SOURCE_LABEL, questionLabel } from "../vocab.ts";

export function Search() {
  const { ix, ui, patch } = usePage();
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
    </div>
  );
}
