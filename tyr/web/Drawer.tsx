import { useMemo } from "react";
import { drawerGroups } from "./model.ts";
import { usePage } from "./page.ts";
import { Marker } from "./ui/Marker.tsx";
import { SOURCES } from "../shared/protocol.ts";
import { SOURCE_LABEL } from "./vocab.ts";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const groupId = (letter: string) => `grp-${letter === "#" ? "other" : letter}`;

/** The A to Z drawer: names only, under their letter. */
export function Drawer() {
  const { ix, today, ui, patch, setSheet, openFile } = usePage();
  const people = ix.dossier.people;
  const groups = useMemo(
    () => drawerGroups(ui.showClosed ? people : people.filter((p) => !p.closed)),
    [people, ui.showClosed],
  );
  const closedCount = people.filter((p) => p.closed).length;
  const expanded = ui.expanded;

  const toggle = (letter: string) => {
    const next = new Set(expanded);
    if (next.has(letter)) next.delete(letter);
    else next.add(letter);
    patch({ expanded: next });
  };

  return (
    <aside id="drawer" aria-label="Drawer">
      <div className="az" role="navigation" aria-label="Letters">
        {LETTERS.map((letter) => (
          <button
            key={letter}
            type="button"
            disabled={!groups.has(letter)}
            aria-label={letter === "#" ? "Other" : letter}
            onClick={() => {
              patch({ expanded: new Set([...expanded, letter]) });
              requestAnimationFrame(() => document.getElementById(groupId(letter))?.scrollIntoView({ block: "start" }));
            }}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="names">
        <div className="names-tools">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => patch({ expanded: new Set(), pid: null, view: "file" })}
          >
            Collapse all
          </button>
          <button type="button" className="btn ghost sm" onClick={() => patch({ expanded: new Set(LETTERS) })}>
            Expand all
          </button>
        </div>
        {LETTERS.filter((letter) => groups.has(letter)).map((letter) => {
          const list = groups.get(letter) ?? [];
          const open = expanded.has(letter);
          return (
            <section key={letter} id={groupId(letter)}>
              <h3 className="grp-h">
                <button type="button" aria-expanded={open} onClick={() => toggle(letter)}>
                  <span>{letter}</span>
                  <span className="grp-n mono">{list.length}</span>
                  <span className="grp-c" aria-hidden="true">
                    {open ? "−" : "+"}
                  </span>
                </button>
              </h3>
              <ul hidden={!open}>
                {list.map((p) => {
                  const status = ix.status(p, today);
                  const last = ix.lastContact(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`nm ${status}`}
                        aria-current={ui.view === "file" && ui.pid === p.id}
                        onClick={() => openFile(p.id)}
                      >
                        <span className="nm-n">{p.name}</span>
                        <span className="nm-d mono">{last ? last.told.d : "—"}</span>
                        {status !== "active" && <span className="nm-s">{status}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <div className="drawer-foot">
          <div className="legend">
            {SOURCES.map((s) => (
              <span key={s}>
                <Marker src={s} />
                {SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
          <label>
            <input type="checkbox" checked={ui.showClosed} onChange={(e) => patch({ showClosed: e.target.checked })} />{" "}
            Show closed files ({closedCount})
          </label>
          <button type="button" className="btn ghost sm" onClick={() => setSheet({ what: "muninn", tab: "met" })}>
            Just met someone
          </button>
        </div>
      </div>
    </aside>
  );
}
