import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { LIMITS, type Link, type Star } from "../../shared/protocol.ts";
import {
  colourOf,
  descendants,
  isMain,
  nameOf,
  phraseParts,
  phraseText,
  possessive,
  relationOf,
  rootOf,
} from "../sky/model.ts";
import type { SkyStore } from "../sky/store.ts";

interface StarPanelProps {
  store: SkyStore;
  star: Star;
  /** Select the name, for a star just made. */
  focusName: boolean;
  /** The other star of a connection being made, once it has been picked. */
  pendingWith: string | null;
  onGo: (id: string) => void;
  onClose: () => void;
  onToggleSheet: () => void;
  onHeadClick: (target: EventTarget) => void;
  onAddRelative: (name: string, relation: string) => void;
  onStartConnect: () => void;
  onConnect: (relation: string) => void;
  onCancelPending: () => void;
  onUnlink: (id: string) => void;
  onPromote: () => void;
  onRemove: () => void;
  /** A field lost the focus: what was typed can be saved now. */
  onBlurField: () => void;
}

const colour = (c: string) => ({ "--c": c }) as CSSProperties;

/** The panel for one star. It is keyed by the star, so nothing carries over from another. */
export function StarPanel({
  store,
  star: s,
  focusName,
  pendingWith,
  onGo,
  onClose,
  onToggleSheet,
  onHeadClick,
  onAddRelative,
  onStartConnect,
  onConnect,
  onCancelPending,
  onUnlink,
  onPromote,
  onRemove,
  onBlurField,
}: StarPanelProps) {
  const { index, links } = store;
  const main = isMain(s);
  const c = colourOf(index, s.id);
  const root = rootOf(index, s.id);
  const parent = s.parent !== null ? index.byId.get(s.parent) : undefined;
  const kids = index.children.get(s.id) ?? [];
  const myLinks = links.filter((l) => l.a === s.id || l.b === s.id);
  const desc = descendants(index, s.id).length;
  const phrase = phraseParts(index, s.id);

  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState("");
  const [linkRelation, setLinkRelation] = useState("");
  const nameField = useRef<HTMLInputElement>(null);
  const newNameField = useRef<HTMLInputElement>(null);
  const linkField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusName) return;
    nameField.current?.focus();
    nameField.current?.select();
  }, [focusName]);

  useEffect(() => {
    if (pendingWith !== null) linkField.current?.focus();
  }, [pendingWith]);

  const addRelative = (e: FormEvent) => {
    e.preventDefault();
    newNameField.current?.focus();
    if (!newName.trim()) return;
    onAddRelative(newName.trim(), newRelation.trim());
    setNewName("");
    setNewRelation("");
  };

  const connect = (e: FormEvent) => {
    e.preventDefault();
    onConnect(linkRelation.trim() || "relative");
    setLinkRelation("");
  };

  const pending = pendingWith !== null ? index.byId.get(pendingWith) : undefined;

  return (
    <>
      <div className="p-head" style={colour(c)} onClick={(e) => onHeadClick(e.target)}>
        <div className="desig">
          <span className="greek">{index.letter.get(s.id)}</span>
          {main ? "Main star" : `${possessive(nameOf(root))} constellation`}
        </div>
        <button className="icon-btn sheet-toggle" type="button" onClick={onToggleSheet} aria-label="Collapse panel">
          <ChevronDown aria-hidden />
        </button>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
          <X aria-hidden />
        </button>
      </div>

      <div className="p-body">
        <div>
          <input
            ref={nameField}
            className="name-input"
            aria-label="Name"
            placeholder="Name"
            maxLength={LIMITS.name}
            value={s.name}
            onChange={(e) => store.update(s.id, { name: e.target.value })}
            onBlur={onBlurField}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <p className="phrase">
            {phrase
              ? phrase.map((part, i) =>
                  part.id !== undefined ? (
                    <span key={part.id}>
                      <button type="button" title={part.title} onClick={() => onGo(part.id!)}>
                        {part.text}
                      </button>{" "}
                    </span>
                  ) : (
                    <span key={i} className="me">
                      {part.text}
                    </span>
                  ),
                )
              : `Someone you know. The stars around ${nameOf(s)} are the family you have learned about.`}
          </p>
        </div>

        {parent && (
          <div className="field">
            <label className="lbl" htmlFor="f-rel">
              Relation
            </label>
            <div className="rel-row">
              <span>{nameOf(s)} is</span> <strong>{possessive(nameOf(parent))}</strong>
              <input
                id="f-rel"
                className="txt"
                list="rels"
                placeholder="e.g. sister"
                maxLength={LIMITS.relation}
                value={s.relation}
                onChange={(e) => store.update(s.id, { relation: e.target.value })}
                onBlur={onBlurField}
              />
            </div>
          </div>
        )}

        <div className="field">
          <label className="lbl" htmlFor="f-memo">
            Memo
          </label>
          <textarea
            id="f-memo"
            className="txt"
            placeholder="What helps you remember them?"
            maxLength={LIMITS.memo}
            value={s.memo}
            onChange={(e) => store.update(s.id, { memo: e.target.value })}
            onBlur={onBlurField}
          />
        </div>

        <section className="sec">
          <h3>
            Relatives <span className="count">{kids.length}</span>
          </h3>
          {kids.length > 0 ? (
            <ul className="rows">
              {kids.map((k) => (
                <li key={k.id}>
                  <button className="row" type="button" onClick={() => onGo(k.id)}>
                    <span className="dot" style={colour(c)} />
                    <span className="nm">{nameOf(k)}</span>
                    <span className="rl">{relationOf(k)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">No relatives charted around {nameOf(s)} yet.</p>
          )}
          <form className="add-form" autoComplete="off" onSubmit={addRelative}>
            <input
              ref={newNameField}
              className="txt"
              placeholder="Name"
              aria-label="New relative's name"
              maxLength={LIMITS.name}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="txt"
              list="rels"
              placeholder="Relation"
              aria-label={`Relation to ${nameOf(s)}`}
              maxLength={LIMITS.relation}
              value={newRelation}
              onChange={(e) => setNewRelation(e.target.value)}
            />
            <button className="btn sm gold" type="submit">
              Add
            </button>
            <span className="hint">Who is {possessive(nameOf(s))} what? For example: Ana, sister.</span>
          </form>
        </section>

        <section className="sec">
          <h3>
            Connections <span className="count">{myLinks.length}</span>
          </h3>
          {myLinks.length > 0 && (
            <ul className="rows">
              {myLinks.map((l) => (
                <Connection key={l.id} store={store} link={l} star={s} onGo={onGo} onUnlink={onUnlink} />
              ))}
            </ul>
          )}
          {pending ? (
            <form className="pending" autoComplete="off" onSubmit={connect}>
              <span className="lbl">New connection</span>
              <div className="rel-row">
                <span>
                  {nameOf(pending)} is {possessive(nameOf(s))}
                </span>
                <input
                  ref={linkField}
                  className="txt"
                  list="rels"
                  placeholder="e.g. cousin"
                  aria-label="How they are related"
                  maxLength={LIMITS.relation}
                  value={linkRelation}
                  onChange={(e) => setLinkRelation(e.target.value)}
                />
              </div>
              <div className="acts">
                <button className="btn sm ghost" type="button" onClick={onCancelPending}>
                  Cancel
                </button>
                <button className="btn sm gold" type="submit">
                  Connect
                </button>
              </div>
            </form>
          ) : (
            <>
              {myLinks.length === 0 && (
                <p className="empty-note">
                  Connect {nameOf(s)} to a star in another constellation when you discover how they are related.
                </p>
              )}
              <div>
                <button className="btn sm" type="button" onClick={onStartConnect}>
                  Connect to another star
                </button>
              </div>
            </>
          )}
        </section>

        <div className="actions">
          {confirming ? (
            <div className="confirm">
              <p>
                Remove {nameOf(s)}
                {desc > 0 && ` and ${desc} ${desc === 1 ? "relative" : "relatives"} charted around them`} from the sky?
              </p>
              <div className="acts">
                <button className="btn sm danger" type="button" onClick={onRemove}>
                  Remove
                </button>
                <button className="btn sm ghost" type="button" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <>
              {!main && (
                <button
                  className="btn sm"
                  type="button"
                  title="Use this when you get to know them yourself"
                  onClick={onPromote}
                >
                  Make a main star
                </button>
              )}
              <button className="btn sm ghost" type="button" onClick={() => setConfirming(true)}>
                Remove star
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Connection({
  store,
  link: l,
  star: s,
  onGo,
  onUnlink,
}: {
  store: SkyStore;
  link: Link;
  star: Star;
  onGo: (id: string) => void;
  onUnlink: (id: string) => void;
}) {
  const { index } = store;
  const a = index.byId.get(l.a);
  const b = index.byId.get(l.b);
  if (!a || !b) return null;
  const other = l.a === s.id ? b : a;
  return (
    <li className="link-row">
      <span className="lt">
        <span>
          {b.id === s.id ? (
            nameOf(b)
          ) : (
            <button type="button" className="go" onClick={() => onGo(b.id)}>
              {nameOf(b)}
            </button>
          )}{" "}
          is{" "}
          {a.id === s.id ? (
            possessive(nameOf(a))
          ) : (
            <button type="button" className="go" onClick={() => onGo(a.id)}>
              {possessive(nameOf(a))}
            </button>
          )}{" "}
          <b>{l.relation || "relative"}</b>
        </span>
        {!isMain(other) && (
          <small>
            {nameOf(other)} is {phraseText(index, other.id)}
          </small>
        )}
      </span>
      <button className="icon-btn" type="button" onClick={() => onUnlink(l.id)} aria-label="Remove this connection">
        <X aria-hidden />
      </button>
    </li>
  );
}
