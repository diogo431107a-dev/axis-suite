// A companion's memory: the files the memory model keeps, what changed in them and when, and
// every run of the memory model with what it cost. Anything can be edited by hand, or put back
// the way it was; both are kept in the history like any other change.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FilePlus, History, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type {
  Companion,
  MemoryFileView,
  MemoryPage,
  MemoryVersionInfo,
  MemoryVersionView,
} from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { usePage } from "../page.ts";
import { Button, inputStyle, Notice } from "../ui/bits.tsx";

const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const when = (at: string): string => new Date(at).toLocaleString();
const money = (dollars: number | null): string =>
  dollars === null ? "" : dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;

const OPS: Record<string, string> = {
  seed: "laid out",
  create: "written",
  str_replace: "edited",
  insert: "added to",
  delete: "deleted",
  rename: "moved",
  manual_edit: "edited by you",
  revert: "put back",
};

function sourceOf(source: string): string {
  if (source.startsWith("consolidate:")) return "after a chat";
  return { manual: "by you", seed: "new companion", cleanup: "tidy-up", rebuild: "rebuild" }[source] ?? source;
}

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
      {page?.busy ? <Notice kind="quiet">The memory model is updating these files right now.</Notice> : null}
      <Notice>{error}</Notice>

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

      {page ? <Runs page={page} /> : null}
    </div>
  );
}

function FileList({
  page,
  chosen,
  onChoose,
}: {
  page: MemoryPage;
  chosen: string | null;
  onChoose: (path: string | null) => void;
}) {
  return (
    <nav className="space-y-1">
      {page.files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onChoose(file.path)}
          className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
            chosen === file.path ? "bg-accent-soft" : "hover:bg-sheet"
          }`}
        >
          <span className="block truncate font-mono text-xs">{file.path}</span>
          <span
            className="mt-1 block h-1 overflow-hidden rounded bg-rule"
            title={`${size(file.size)} of ${size(file.cap)}`}
          >
            <span
              className={`block h-1 ${file.size / file.cap > 0.85 ? "bg-warn" : "bg-accent"}`}
              style={{ width: `${Math.min(100, (file.size / file.cap) * 100)}%` }}
            />
          </span>
          <span className="block text-xs text-faint">
            {size(file.size)} of {size(file.cap)}
          </span>
        </button>
      ))}
      <p className="px-2 pt-1 text-xs text-faint">
        {page.files.length} of {page.maxFiles} files.
      </p>
      {page.files.length < page.maxFiles ? (
        <div className="px-2">
          <Button kind="quiet" onClick={() => onChoose(null)}>
            <FilePlus size={14} /> New file
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

function NewFile({ base, onCreated }: { base: string; onCreated: (path: string) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    try {
      const saved = await api<MemoryFileView>(`${base}/file`, {
        method: "PUT",
        body: { path, content: `# ${path}\n` },
      });
      onCreated(saved.path);
    } catch (err) {
      setError(describeError(err));
    }
  };
  return (
    <div className="space-y-3 rounded border border-rule bg-sheet/50 p-4 text-sm">
      <p className="text-faint">Pick a file on the left to read it, or start a new one.</p>
      <div className="flex gap-2">
        <input
          className={`${inputStyle} font-mono`}
          value={path}
          placeholder="places/the_hall.md"
          onChange={(e) => setPath(e.target.value)}
        />
        <Button kind="plain" onClick={() => void create()} disabled={!path.trim()}>
          Create
        </Button>
      </div>
      <Notice>{error}</Notice>
    </div>
  );
}

function FilePane({
  base,
  path,
  onChanged,
  onGone,
}: {
  base: string;
  path: string;
  onChanged: () => void;
  onGone: () => void;
}) {
  const [file, setFile] = useState<MemoryFileView | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const query = `path=${encodeURIComponent(path)}`;

  const load = useCallback(async () => {
    try {
      setFile(await api<MemoryFileView>(`${base}/file?${query}`));
    } catch (err) {
      setError(describeError(err));
    }
  }, [base, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (draft === null) return;
    try {
      setFile(await api<MemoryFileView>(`${base}/file`, { method: "PUT", body: { path, content: draft } }));
      setDraft(null);
      setError("");
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const remove = async () => {
    try {
      await api(`${base}/file?${query}`, { method: "DELETE" });
      onGone();
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (!file) return <Notice>{error}</Notice>;
  const bytes = draft === null ? 0 : new TextEncoder().encode(draft).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-sm">/memories/{path}</h2>
        <span className="ml-auto flex flex-wrap gap-1">
          {draft === null ? (
            <Button kind="plain" onClick={() => setDraft(file.content)}>
              <Pencil size={14} /> Edit
            </Button>
          ) : null}
          <Button kind="plain" onClick={() => setShowHistory((shown) => !shown)}>
            <History size={14} /> History
          </Button>
          {confirming ? (
            <>
              <Button kind="danger" onClick={() => void remove()}>
                Delete
              </Button>
              <Button kind="quiet" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button kind="danger" onClick={() => setConfirming(true)}>
              <Trash2 size={14} />
            </Button>
          )}
        </span>
      </div>
      <Notice>{error}</Notice>

      {draft === null ? (
        <pre className="spoken overflow-x-auto rounded border border-rule bg-sheet p-3 font-mono text-xs leading-relaxed">
          {file.content}
        </pre>
      ) : (
        <div className="space-y-2">
          <textarea
            className={`${inputStyle} min-h-80 resize-y font-mono text-xs leading-relaxed`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button kind="strong" onClick={() => void save()} disabled={bytes > file.cap}>
              Save
            </Button>
            <Button kind="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <span className={`ml-auto text-xs ${bytes > file.cap ? "text-warn" : "text-faint"}`}>
              {size(bytes)} of {size(file.cap)}
            </span>
          </div>
        </div>
      )}

      {showHistory ? (
        <VersionList
          base={base}
          path={path}
          onReverted={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function VersionList({ base, path, onReverted }: { base: string; path: string; onReverted: () => void }) {
  const [versions, setVersions] = useState<MemoryVersionInfo[]>([]);
  const [shown, setShown] = useState<MemoryVersionView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setVersions(await api<MemoryVersionInfo[]>(`${base}/versions?path=${encodeURIComponent(path)}`));
    } catch (err) {
      setError(describeError(err));
    }
  }, [base, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = async (id: number) => {
    try {
      setShown(await api<MemoryVersionView>(`${base}/versions/${id}`));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const revert = async (id: number) => {
    try {
      await api(`${base}/versions/${id}/revert`, { method: "POST" });
      setShown(null);
      await load();
      onReverted();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-3 rounded border border-rule bg-sheet/50 p-3">
      <h3 className="font-display">History</h3>
      <Notice>{error}</Notice>
      <ol className="space-y-1 text-sm">
        {versions.map((version, at) => (
          <li key={version.id}>
            <button
              type="button"
              onClick={() => void show(version.id)}
              className={`w-full rounded px-2 py-1 text-left hover:bg-sheet ${shown?.version.id === version.id ? "bg-accent-soft" : ""}`}
            >
              <span className="text-faint">{when(version.at)}</span> · {OPS[version.op] ?? version.op},{" "}
              {sourceOf(version.source)}
              {version.size === null ? "" : ` · ${size(version.size)}`}
              {at === 0 ? <span className="text-faint"> · as it is now</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {shown ? (
        <div className="space-y-2">
          <pre className="overflow-x-auto rounded border border-rule bg-sheet p-3 font-mono text-xs leading-relaxed">
            {shown.diff.map((line, at) => (
              <div
                key={at}
                className={
                  line.kind === "added"
                    ? "bg-accent-soft"
                    : line.kind === "removed"
                      ? "text-warn line-through"
                      : "text-faint"
                }
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
          {versions[0]?.id !== shown.version.id ? (
            <Button kind="plain" onClick={() => void revert(shown.version.id)}>
              {shown.content === null
                ? "Delete it again, as this change did"
                : "Put the file back as it was after this change"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-faint">Pick a change to see what it did.</p>
      )}
    </div>
  );
}

function Runs({ page }: { page: MemoryPage }) {
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
