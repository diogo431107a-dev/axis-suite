// A file's own details: its name and what matters most, closing it, and destroying it.
import { useState, type FormEvent } from "react";
import { LIMITS } from "../../shared/protocol.ts";
import { fold } from "../../shared/time.ts";
import { describeError } from "../api.ts";
import { usePage } from "../page.ts";
import { SheetFrame } from "../ui/controls.tsx";

export function DetailsForm({ pid }: { pid: string }) {
  const { ix, today, setSheet, patch, send, toast } = usePage();
  const person = ix.person(pid);
  const [name, setName] = useState(person?.name ?? "");
  const [aliases, setAliases] = useState(person?.aliases.join(", ") ?? "");
  const [role, setRole] = useState(person?.role ?? "");
  const [matters, setMatters] = useState(person?.matters.join("\n") ?? "");
  const [closeNote, setCloseNote] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!person) return null;

  const run = async (work: () => Promise<void>) => {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await work();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  const save = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      await send(`/api/people/${pid}`, "PATCH", {
        name,
        role,
        aliases: aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        matters: matters
          .split("\n")
          .map((m) => m.trim())
          .filter(Boolean),
      });
      toast("File details saved.");
      setSheet(null);
    });
  };

  const setClosed = (closed: { on: string; note: string } | null) =>
    run(async () => {
      await send(`/api/people/${pid}`, "PATCH", { closed });
      toast(closed ? `Closed ${closed.on}. The file is kept.` : "File reopened.");
      setSheet(null);
    });

  const destroy = () =>
    run(async () => {
      await send(`/api/people/${pid}`, "DELETE");
      toast(`The file for ${person.name} is destroyed.`);
      setSheet(null);
      patch({ pid: null, view: "file" });
    });

  return (
    <SheetFrame
      sub={`File details · ${person.name}`}
      title="What the file says about itself"
      onClose={() => setSheet(null)}
    >
      <form className="fs" noValidate onSubmit={save}>
        <div className="field">
          <label htmlFor="df-name">First name</label>
          <input id="df-name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <span className="help">The drawer files by this name, so a second name or nickname can tell two apart.</span>
        </div>
        <div className="field">
          <label htmlFor="df-aliases">Other names</label>
          <input
            id="df-aliases"
            value={aliases}
            placeholder="Nicknames, separated by commas"
            autoComplete="off"
            onChange={(e) => setAliases(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="df-role">How I know them</label>
          <input id="df-role" value={role} autoComplete="off" onChange={(e) => setRole(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="df-matters">Matters most to them</label>
          <textarea id="df-matters" value={matters} onChange={(e) => setMatters(e.target.value)} />
          <span className="help">One per line, {LIMITS.matters} at most. Pinned at the top of the file.</span>
        </div>
        {error && (
          <span className="err" role="alert">
            {error}
          </span>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            Save details
          </button>
          <button className="btn ghost" type="button" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </div>
      </form>

      <fieldset>
        <legend>{person.closed ? "Closed" : "Close the file"}</legend>
        {person.closed ? (
          <div className="stack">
            <p className="small">
              Closed <span className="mono">{person.closed}</span>
              {person.closeNote && ` · ${person.closeNote}`}
            </p>
            <div className="row">
              <button type="button" className="btn ghost sm" disabled={saving} onClick={() => void setClosed(null)}>
                Reopen the file
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="small muted">A closed file leaves the drawer and is kept. It can be reopened.</p>
            <div className="field">
              <label htmlFor="df-close">Closing note</label>
              <input
                id="df-close"
                value={closeNote}
                placeholder="Left the club and the city. Nothing open."
                autoComplete="off"
                onChange={(e) => setCloseNote(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn ghost sm"
                disabled={saving}
                onClick={() => void setClosed({ on: today, note: closeNote })}
              >
                Close the file
              </button>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="danger-zone">
        <legend>Destroy the file</legend>
        <div className="stack">
          <p className="small">
            This removes the file and every entry and answer in it, for good. There is no undo apart from a backup. To
            keep it out of the drawer, close it instead.
          </p>
          <div className="field">
            <label htmlFor="df-confirm">Type “{person.name}” to confirm</label>
            <input
              id="df-confirm"
              value={confirmName}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn danger sm"
              disabled={saving || fold(confirmName.trim()) !== fold(person.name)}
              onClick={() => void destroy()}
            >
              Destroy this file
            </button>
          </div>
        </div>
      </fieldset>
    </SheetFrame>
  );
}
