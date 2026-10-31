import type { Entry, Person, Source } from "../../shared/protocol.ts";
import { stampKey } from "../../shared/time.ts";
import { usePage } from "../page.ts";
import { Seg } from "../ui/controls.tsx";
import { Marker } from "../ui/Marker.tsx";
import { SOURCE_LABEL } from "../vocab.ts";
import { EntryRow } from "./EntryRow.tsx";

const SPONTANEOUS: Source[] = ["U", "I", "O", "N"];

export function Timeline({ person }: { person: Person }) {
  const { ix, ui, patch } = usePage();
  const entries = ix.entriesOf(person.id);
  const promptedCount = entries.filter((e) => e.src === "P").length;
  let list =
    ui.ledger === "prompt"
      ? entries.filter((e) => e.src === "P")
      : entries.filter((e) => e.src !== "P" && ui.srcf.has(e.src));
  if (ui.life === "past") list = list.filter((e) => stampKey(e.hap) < person.opened);
  const stamp = (e: Entry) => (ui.order === "hap" ? e.hap : e.told);
  const sorted = [...list].sort((a, b) => stampKey(stamp(b)).localeCompare(stampKey(stamp(a))));

  const months: { label: string; items: Entry[] }[] = [];
  for (const e of sorted) {
    const s = stamp(e);
    const label = s.p === "around" ? `c. ${s.d}` : s.d.slice(0, 7);
    const last = months.at(-1);
    if (last?.label === label) last.items.push(e);
    else months.push({ label, items: [e] });
  }

  return (
    <div className="stack">
      <div className="controls">
        <Seg
          label="Ledger"
          options={[
            [
              "spont",
              <>
                Spontaneous ledger <span className="mono">{entries.length - promptedCount}</span>
              </>,
            ],
            [
              "prompt",
              <>
                Prompted ledger <span className="mono">{promptedCount}</span>
              </>,
            ],
          ]}
          value={ui.ledger}
          onChange={(ledger) => patch({ ledger })}
        />
        <Seg
          label="Whose history"
          options={[
            ["ours", "Our history"],
            ["past", "Their past"],
          ]}
          value={ui.life}
          onChange={(life) => patch({ life })}
        />
        <Seg
          label="Order"
          options={[
            ["told", "Told at"],
            ["hap", "Happened at"],
          ]}
          value={ui.order}
          onChange={(order) => patch({ order })}
        />
      </div>
      {ui.ledger === "spont" ? (
        <div className="chips" aria-label="Filter by source">
          {SPONTANEOUS.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={ui.srcf.has(s)}
              onClick={() => {
                const next = new Set(ui.srcf);
                if (next.has(s)) next.delete(s);
                else next.add(s);
                patch({ srcf: next });
              }}
            >
              <Marker src={s} />
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
      ) : (
        <p className="ledger-note">
          <Marker src="P" />
          <span>
            Things they told me because I asked. They count as facts told, and stay out of the spontaneous profile.
          </span>
        </p>
      )}
      {ui.life === "past" && (
        <p className="muted small">
          Entries whose happened-at date is before the file was opened ({person.opened}): what shaped them, kept apart
          from our history.
        </p>
      )}
      <div>
        {months.length > 0 ? (
          months.map((m) => (
            <div key={m.label}>
              <div className="month">{m.label}</div>
              {m.items.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </div>
          ))
        ) : (
          <p className="muted pad-y">Nothing here with these filters.</p>
        )}
      </div>
    </div>
  );
}
