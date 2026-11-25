import { useState } from "react";
import { DatabaseBackup, RotateCcw, Sparkles } from "lucide-react";
import type { Companion, MemoryPage, RunOutcome } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button } from "../../ui/bits.tsx";
import { size } from "./format.ts";

/** Tidying, rebuilding, backing up. */
export function Upkeep({
  base,
  page,
  companion,
  onPage,
  onError,
  onChanged,
}: {
  base: string;
  page: MemoryPage;
  companion: Companion;
  onPage: (page: MemoryPage) => void;
  onError: (error: string) => void;
  onChanged: () => void;
}) {
  const [doing, setDoing] = useState<"tidy" | "rebuild" | "backup" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState("");

  const act = async (what: "tidy" | "rebuild" | "backup") => {
    setDoing(what);
    setSaid("");
    onError("");
    try {
      if (what === "tidy") {
        const { outcome, page: next } = await api<{ outcome: RunOutcome; page: MemoryPage }>(`${base}/tidy`, {
          method: "POST",
        });
        onPage(next);
        if (outcome.kind === "failed") onError(`The tidy-up changed nothing: ${outcome.error}`);
        else setSaid(outcome.kind === "done" ? outcome.summary || "Tidied." : outcome.reason);
        onChanged();
      } else if (what === "rebuild") {
        onPage(await api<MemoryPage>(`${base}/rebuild`, { method: "POST" }));
        setConfirming(false);
      } else {
        onPage(await api<MemoryPage>(`${base}/backup`, { method: "POST" }));
        setSaid("Backed up.");
      }
    } catch (err) {
      onError(describeError(err));
    } finally {
      setDoing(null);
    }
  };

  const latest = page.backups[0];
  return (
    <section className="space-y-2 rounded border border-rule bg-sheet/50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          kind="plain"
          disabled={page.busy || doing !== null}
          onClick={() => void act("tidy")}
          title="Merge duplicates, settle contradictions and condense the files, now instead of after the next few chats"
        >
          <Sparkles size={14} /> {doing === "tidy" ? "Tidying…" : "Tidy up now"}
        </Button>
        {confirming ? null : (
          <Button kind="plain" disabled={page.busy || doing !== null} onClick={() => setConfirming(true)}>
            <RotateCcw size={14} /> Rebuild from every chat…
          </Button>
        )}
        <Button kind="plain" disabled={doing !== null} onClick={() => void act("backup")}>
          <DatabaseBackup size={14} /> {doing === "backup" ? "Backing up…" : "Back up now"}
        </Button>
        <span className="ml-auto text-xs text-faint">
          {latest ? `Last backup ${latest.day} (${size(latest.bytes)}); ${page.backups.length} kept` : "No backup yet"}
        </span>
      </div>
      {confirming ? (
        <div className="space-y-2 rounded border border-dashed border-warn/60 p-3">
          <p>
            Throw these files away and write them again from scratch, by replaying the selected path of{" "}
            {page.chats === 1 ? `${companion.name}'s one chat` : `all ${page.chats} of ${companion.name}'s chats`}{" "}
            through {companion.settings.memoryModel}, in order. It takes a few minutes and costs about what{" "}
            {page.chats === 1 ? "that chat" : "those chats"} cost to remember the first time. The current files stay
            until it finishes, and stay in each file's history after; if any step fails, nothing changes.
          </p>
          <div className="flex gap-2">
            <Button kind="danger" disabled={doing !== null} onClick={() => void act("rebuild")}>
              Rebuild
            </Button>
            <Button kind="quiet" onClick={() => setConfirming(false)}>
              Keep the files
            </Button>
          </div>
        </div>
      ) : null}
      {said ? <p className="text-faint">{said}</p> : null}
      <p className="text-xs text-faint">
        Backups are of everything Valhalla 2 keeps, taken once a day on their own; they sit beside the database on this
        server.
      </p>
    </section>
  );
}
