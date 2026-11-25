import type { MemoryPage } from "../../../shared/protocol.ts";
import { usePage } from "../../page.ts";
import { money, when } from "./format.ts";

export function Runs({ page }: { page: MemoryPage }) {
  const { open } = usePage();
  if (page.runs.length === 0) {
    return <p className="text-sm text-faint">The memory model hasn't run for this companion yet.</p>;
  }
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg">When the memory model ran</h2>
      <ol className="space-y-2 text-sm">
        {page.runs.map((run) => (
          <li key={run.id} className="rounded border border-rule bg-sheet/50 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-faint">{when(run.startedAt)}</span>
              {run.kind !== "consolidate" ? (
                <span className="text-xs uppercase tracking-wide text-faint">
                  {run.kind === "cleanup" ? "tidy-up" : "rebuild"}
                </span>
              ) : null}
              {run.chatId && run.chatTitle ? (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => open({ kind: "chat", id: run.chatId! })}
                >
                  {run.chatTitle}
                </button>
              ) : null}
              <span className="font-mono text-xs text-faint">{run.model}</span>
              <span className="ml-auto font-mono text-xs text-faint">{money(run.cost)}</span>
            </div>
            {run.ok === null ? <p className="text-faint">Running…</p> : null}
            {run.ok === false ? <p className="text-warn">Nothing changed: {run.error}</p> : null}
            {run.ok && run.summary ? <p className="mt-1">{run.summary}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
