// A companion's memory: the files the memory model keeps, what changed in them and when, and
// every run of the memory model with what it cost. Anything can be edited by hand, or put back
// the way it was; both are kept in the history like any other change.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { Companion, MemoryPage } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { usePage } from "../../page.ts";
import { Button, Notice } from "../../ui/bits.tsx";
import { FileList } from "./FileList.tsx";
import { FilePane } from "./FilePane.tsx";
import { NewFile } from "./NewFile.tsx";
import { Pins } from "./Pins.tsx";
import { Quiet } from "./Quiet.tsx";
import { Runs } from "./Runs.tsx";
import { Upkeep } from "./Upkeep.tsx";

export function Memory({ companion }: { companion: Companion }) {
  const { open } = usePage();
  const [page, setPage] = useState<MemoryPage | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);

  const base = `/api/companions/${companion.id}/memory`;
  const load = useCallback(async () => {
    try {
      setPage(await api<MemoryPage>(base));
      setError("");
    } catch (err) {
      setError(describeError(err));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // While the memory model works, look again every few seconds.
  useEffect(() => {
    if (!page?.busy) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [page?.busy, load]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="quiet" onClick={() => open({ kind: "companion", id: companion.id })}>
          <ArrowLeft size={15} /> {companion.name}
        </Button>
        <h1 className="font-display text-2xl">{companion.name}'s memory</h1>
        <span className="ml-auto">
          <Button kind="plain" onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </span>
      </div>
      <p className="text-sm text-faint">
        What {companion.name} remembers across chats. After a chat goes quiet (or when you press "Remember now" in it),
        the memory model updates these files from what was said on the path you selected. Each chat reads them as they
        were when it last looked, and the whole set goes out with every message.
      </p>
      {page?.busy ? (
        <Notice kind="quiet">
          {page.rebuilding
            ? "Rebuilding from every chat. The files below stay as they are until it finishes; its steps appear at the bottom as they run."
            : "The memory model is updating these files right now."}
        </Notice>
      ) : null}
      <Notice>{error}</Notice>
      {page ? (
        <Upkeep
          base={base}
          page={page}
          companion={companion}
          onPage={setPage}
          onError={setError}
          onChanged={() => void load()}
        />
      ) : null}

      {page ? (
        <div className="grid gap-5 md:grid-cols-[16rem_1fr]">
          <FileList page={page} chosen={chosen} onChoose={setChosen} />
          <div className="min-w-0">
            {chosen ? (
              <FilePane
                key={chosen}
                base={base}
                path={chosen}
                onChanged={() => void load()}
                onGone={() => {
                  setChosen(null);
                  void load();
                }}
              />
            ) : (
              <NewFile
                base={base}
                onCreated={(path) => {
                  void load();
                  setChosen(path);
                }}
              />
            )}
          </div>
        </div>
      ) : null}

      {page ? <Pins companion={companion} page={page} onPage={setPage} onError={setError} /> : null}

      {page ? <Quiet companion={companion} page={page} onPage={setPage} onError={setError} /> : null}

      {page ? <Runs page={page} /> : null}
    </div>
  );
}
