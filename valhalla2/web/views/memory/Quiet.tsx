import { useState } from "react";
import { MessageSquareOff, Plus } from "lucide-react";
import { LIMITS, type Companion, type MemoryPage } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, inputStyle } from "../../ui/bits.tsx";
import { when } from "./format.ts";

/**
 * Topics you asked the companion to leave alone: an old arc it keeps going back to, a detail it
 * won't let go of. It doesn't bring them up unless you do, and the memory model keeps them brief.
 */
export function Quiet({
  companion,
  page,
  onPage,
  onError,
}: {
  companion: Companion;
  page: MemoryPage;
  onPage: (page: MemoryPage) => void;
  onError: (error: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"adding" | number | null>(null);
  const base = `/api/companions/${companion.id}/quiet`;

  const run = async (what: "adding" | number, work: () => Promise<MemoryPage>) => {
    setBusy(what);
    onError("");
    try {
      onPage(await work());
      if (what === "adding") setText("");
    } catch (err) {
      onError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const add = () => run("adding", () => api<MemoryPage>(base, { method: "POST", body: { text } }));
  const remove = (id: number) => run(id, () => api<MemoryPage>(`${base}/${id}`, { method: "DELETE" }));

  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg">
        Leave alone{" "}
        <span className="font-sans text-sm text-faint">
          {page.quiet.length} of {LIMITS.quiet}
        </span>
      </h2>
      <p className="text-sm text-faint">
        Topics {companion.name} keeps bringing up that you'd rather it didn't: an old arc, a detail it won't let go of.
        Every chat with {companion.name} is told not to raise them unless you do, from its next turn. The memory model
        adds nothing about them and keeps what the files have on them to a brief line; editing that line yourself works
        too.
      </p>
      <div className="flex items-start gap-2">
        <input
          className={inputStyle}
          value={text}
          maxLength={LIMITS.quietText}
          placeholder="An old arc, a detail it keeps repeating…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) void add();
          }}
        />
        <Button kind="plain" disabled={busy !== null || !text.trim()} onClick={() => void add()}>
          <Plus size={14} /> {busy === "adding" ? "Adding…" : "Add"}
        </Button>
      </div>
      {page.quiet.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {page.quiet.map((topic) => (
            <li
              key={topic.id}
              className="flex flex-wrap items-baseline gap-x-2 rounded border border-rule bg-sheet/50 px-3 py-2"
            >
              <span>{topic.text}</span>
              <span className="text-faint">{when(topic.createdAt)}</span>
              <span className="ml-auto">
                <Button kind="danger" disabled={busy !== null} onClick={() => void remove(topic.id)}>
                  <MessageSquareOff size={14} /> {busy === topic.id ? "Removing…" : "It may bring it up again"}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
