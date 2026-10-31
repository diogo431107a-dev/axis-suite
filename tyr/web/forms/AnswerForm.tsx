// Writing or revising a profile answer. Every revision is kept, and each points back to entries.
import { useRef, useState, type FormEvent } from "react";
import type { Question } from "../../shared/protocol.ts";
import { describeError } from "../api.ts";
import { byToldDesc } from "../model.ts";
import { newId, usePage } from "../page.ts";
import { SheetFrame } from "../ui/controls.tsx";
import { EntryPicklist } from "../ui/EntryPicklist.tsx";
import { questionLabel } from "../vocab.ts";

export function AnswerForm({ pid, q }: { pid: string; q: Question }) {
  const { ix, today, setSheet, send, toast } = usePage();
  const person = ix.person(pid);
  const current = ix.answersTo(pid, q).at(-1);
  const entries = ix.entriesOf(pid);
  // Entries filed under this question come first; a revision starts from what the answer rests on.
  const list = [...entries].sort((a, b) => Number(b.cat === q) - Number(a.cat === q) || byToldDesc(a, b));
  const [text, setText] = useState(current?.text ?? "");
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(current ? current.ev : entries.filter((e) => e.cat === q && e.src !== "P").map((e) => e.id)),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useRef(newId());

  if (!person) return null;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    setError("");
    if (!text.trim()) return setError("Write the answer first.");
    setSaving(true);
    try {
      await send("/api/answers", "POST", { id: id.current, person: pid, q, text, ev: [...picked], revised: today });
      toast(current ? "Answer revised. The earlier one is kept." : "Answer saved.");
      setSheet(null);
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      sub={`${current ? "Revising" : "Answering"} · ${person.name}`}
      title={questionLabel(q)}
      onClose={() => setSheet(null)}
    >
      <form className="fs" noValidate onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="af-text">My answer, in my words</label>
          <textarea id="af-text" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="help">Conclusions live here, and point back to what was said and seen.</span>
        </div>
        <div className="fs">
          <span className="flabel">What it rests on</span>
          {list.length === 0 && <p className="muted small">No entries in this file yet.</p>}
          {list.length > 0 && <EntryPicklist entries={list} picked={picked} onChange={setPicked} />}
        </div>
        {error && (
          <span className="err" role="alert">
            {error}
          </span>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            {current ? "Save revision" : "Save answer"}
          </button>
          <button className="btn ghost" type="button" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}
