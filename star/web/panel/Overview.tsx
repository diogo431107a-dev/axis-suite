import type { CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { PALETTE, descendants, isMain, nameOf } from "../sky/model.ts";
import type { SkyStore } from "../sky/store.ts";

interface OverviewProps {
  store: SkyStore;
  onGo: (id: string) => void;
  onToggleSheet: () => void;
  onHeadClick: (target: EventTarget) => void;
}

/** The panel when no star is selected. */
export function Overview({ store, onGo, onToggleSheet, onHeadClick }: OverviewProps) {
  const mains = store.stars.filter(isMain).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const { length: links } = store.links;
  return (
    <>
      <div className="p-head" onClick={(e) => onHeadClick(e.target)}>
        <div className="desig">
          <span className="greek">✦</span>Your sky
        </div>
        <button
          className="icon-btn sheet-toggle"
          type="button"
          onClick={onToggleSheet}
          aria-label="Expand or collapse panel"
        >
          <ChevronDown aria-hidden />
        </button>
      </div>
      <div className="p-body">
        <p className="lede">
          Each bright star is someone you know. The smaller stars around them are the family you have learned about,
          tied by how they relate to that person.
        </p>
        <p className="tally">
          <b>{mains.length}</b> {mains.length === 1 ? "constellation" : "constellations"} · <b>{store.stars.length}</b>{" "}
          {store.stars.length === 1 ? "star" : "stars"} · <b>{links}</b> {links === 1 ? "connection" : "connections"}{" "}
          between families
        </p>
        <section className="sec">
          <h3>Constellations</h3>
          {mains.length > 0 ? (
            <ul className="rows">
              {mains.map((m) => {
                const n = descendants(store.index, m.id).length;
                return (
                  <li key={m.id}>
                    <button className="row" type="button" onClick={() => onGo(m.id)}>
                      <span className="dot" style={{ "--c": PALETTE[m.hue % PALETTE.length] } as CSSProperties} />
                      <span className="nm">{nameOf(m)}</span>
                      <span className="ct">
                        {n} {n === 1 ? "relative" : "relatives"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-note">The sky is empty. Add someone you know to place the first star.</p>
          )}
        </section>
        <section className="sec">
          <h3>Charting the sky</h3>
          <ul className="hints">
            <li>
              <span>
                <em>Double-click</em> empty sky, or use <em>+ Someone I know</em>, to place a main star.
              </span>
            </li>
            <li>
              <span>
                <em>Select a star</em> to add relatives around it. Relatives can have relatives too.
              </span>
            </li>
            <li>
              <span>
                <em>Connect</em> two stars from different families when you find out they are related.
              </span>
            </li>
            <li>
              <span>
                <em>Drag</em> a main star to move its whole constellation. Scroll or pinch to zoom.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
