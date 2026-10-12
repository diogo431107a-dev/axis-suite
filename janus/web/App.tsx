import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, KeyRound, Menu, Plus, Search, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { Entry, EntrySummary, Group, Vault } from "../shared/protocol.ts";
import { ApiFailure, api, describeError, setPageUser } from "./api.ts";
import { CLEAR_AFTER_SECONDS, copy } from "./clipboard.ts";
import { Generator } from "./generator/Generator.tsx";
import { Dialog } from "./ui/Dialog.tsx";
import { iconButton, primaryButton } from "./ui/buttons.ts";
import { compareText, groupPaths, matches, openableUrl, searchWords } from "./util.ts";
import { BackupDialog } from "./vault/BackupDialog.tsx";
import { EntryEditor } from "./vault/EntryEditor.tsx";
import { EntryList } from "./vault/EntryList.tsx";
import { EntryView, type CopyKind } from "./vault/EntryView.tsx";
import { GroupDialog } from "./vault/GroupDialog.tsx";
import { Sidebar, type View } from "./vault/Sidebar.tsx";
import { createBody, draftOf, isDirty, newDraft, patchBody, type Draft } from "./vault/draft.ts";

type DialogState =
  { kind: "group"; group?: Group; parentId: string | null } | { kind: "generator" } | { kind: "backup" };

interface Notice {
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

/** What the list keeps of an entry it just saved. */
function summaryOf({ password: _p, notes: _n, totp, ...summary }: Entry): EntrySummary {
  return { ...summary, hasTotp: totp !== null };
}

function upsert(entries: EntrySummary[], summary: EntrySummary): EntrySummary[] {
  return entries.some((e) => e.id === summary.id)
    ? entries.map((e) => (e.id === summary.id ? summary : e))
    : [...entries, summary];
}

const SECRET_KINDS: ReadonlySet<CopyKind> = new Set(["password", "code", "setup link"]);

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The selected entry in full (the list has no passwords). `reload` fetches it again.
  const [entry, setEntry] = useState<Entry | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL; a draft is kept.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // The TOTP code on screen, for the T shortcut.
  const code = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);

  const loadVault = useCallback(async () => setVault(await api<Vault>("/api/vault")), []);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        await loadVault();
      })
      .catch((err) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your vault. Try again in a moment.");
      });
  }, [loadVault]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      loadVault().catch(handleError);
    });
  }, [signedOut, me, loadVault, handleError]);

  useEffect(() => {
    if (!selectedId) return setEntry(null);
    let stale = false;
    api<Entry>(`/api/entries/${selectedId}`)
      .then((e) => !stale && setEntry(e))
      .catch((err) => !stale && handleError(err));
    return () => {
      stale = true;
    };
  }, [selectedId, reload, handleError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.action ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!draft || !isDirty(draft)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  const paths = useMemo(() => groupPaths(vault?.groups ?? []), [vault?.groups]);
  const words = useMemo(() => searchWords(query), [query]);
  const inBin = view.kind === "bin";

  const list = useMemo(() => {
    if (!vault) return [];
    let items = vault.entries.filter((e) => (e.deletedAt !== null) === inBin);
    if (words.length > 0) {
      items = items.filter((e) => matches(e, words, e.groupId ? paths.get(e.groupId) : undefined));
    } else if (view.kind === "group") {
      items = items.filter((e) => e.groupId === view.id);
    }
    return inBin
      ? items.sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
      : items.sort((a, b) => compareText(a.title, b.title) || compareText(a.username, b.username));
  }, [vault, view, inBin, words, paths]);

  // Group paths are shown when the list mixes groups.
  const listPaths = useMemo(() => {
    if (view.kind === "group" && words.length === 0) return null;
    return new Map(list.map((e) => [e.id, e.groupId ? (paths.get(e.groupId) ?? []).join(" › ") : "No group"]));
  }, [list, view, words, paths]);

  const copyValue = useCallback(async (kind: CopyKind, value: string) => {
    const secret = SECRET_KINDS.has(kind);
    try {
      await copy(value, secret);
      setNotice({
        text: secret
          ? `Copied the ${kind}. It is cleared from the clipboard in ${CLEAR_AFTER_SECONDS} s.`
          : `Copied the ${kind}.`,
        tone: "info",
      });
    } catch {
      setNotice({ text: "The browser didn't allow copying.", tone: "error" });
    }
  }, []);

  const showCode = useCallback((c: string | null) => {
    code.current = c;
  }, []);

  /** Leaves the editor, asking first if something would be lost. Returns false if the user stays. */
  const leaveDraft = useCallback(() => {
    if (draft && isDirty(draft) && !confirm("Discard your unsaved changes?")) return false;
    setDraft(null);
    return true;
  }, [draft]);

  const openEntry = useCallback(
    (id: string | null) => {
      if (leaveDraft()) setSelectedId(id);
    },
    [leaveDraft],
  );

  function selectView(next: View) {
    setNavOpen(false);
    setQuery("");
    setView(next);
    if (!draft) setSelectedId(null);
  }

  function newEntry() {
    if (!leaveDraft()) return;
    if (inBin) setView({ kind: "all" });
    setSelectedId(null);
    setDraft(newDraft(view.kind === "group" ? view.id : null));
  }

  function moveSelection(delta: number) {
    if (list.length === 0) return;
    const at = list.findIndex((e) => e.id === selectedId);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(Math.max(at + delta, 0), list.length - 1);
    openEntry(list[next]!.id);
  }

  async function save(rev?: number) {
    if (!draft) return;
    setSaving(true);
    try {
      const saved =
        draft.id === null
          ? await api<Entry>("/api/entries", { method: "POST", body: createBody(draft) })
          : await api<Entry>(`/api/entries/${draft.id}`, { method: "PATCH", body: patchBody(draft, rev) });
      setVault((v) => v && { ...v, entries: upsert(v.entries, summaryOf(saved)) });
      setEntry(saved);
      setSelectedId(saved.id);
      setDraft(null);
      setSignedOut(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "conflict") setDraft((d) => d && { ...d, conflict: true });
      else handleError(err);
    } finally {
      setSaving(false);
    }
  }

  /** After a conflict: the fields changed here go on top of the newer version. */
  async function saveOver() {
    if (!draft?.id) return;
    try {
      const latest = await api<Entry>(`/api/entries/${draft.id}`);
      setDraft((d) => d && { ...d, conflict: false });
      await save(latest.rev);
    } catch (err) {
      handleError(err);
    }
  }

  /** After a conflict: drop the changes made here and show the newer version. */
  function discardDraft() {
    setDraft(null);
    setReload((r) => r + 1);
    loadVault().catch(handleError);
  }

  async function moveToBin(id: string) {
    try {
      const summary = await api<EntrySummary>(`/api/entries/${id}`, { method: "DELETE" });
      setVault((v) => v && { ...v, entries: upsert(v.entries, summary) });
      setSelectedId((s) => (s === id ? null : s));
      setNotice({ text: "Moved to the recycle bin.", tone: "info", action: { label: "Undo", run: () => restore(id) } });
    } catch (err) {
      handleError(err);
    }
  }

  async function restore(id: string) {
    try {
      const summary = await api<EntrySummary>(`/api/entries/${id}/restore`, { method: "POST" });
      setVault((v) => v && { ...v, entries: upsert(v.entries, summary) });
      if (view.kind === "bin") setSelectedId((s) => (s === id ? null : s));
      setNotice({ text: "Restored.", tone: "info" });
    } catch (err) {
      handleError(err);
    }
  }

  async function purge(id: string) {
    if (!confirm("Delete this entry for good? It can't be brought back.")) return;
    try {
      await api(`/api/entries/${id}?purge=1`, { method: "DELETE" });
      setVault((v) => v && { ...v, entries: v.entries.filter((e) => e.id !== id) });
      setSelectedId((s) => (s === id ? null : s));
    } catch (err) {
      handleError(err);
    }
  }

  async function saveGroup(state: { group?: Group }, name: string, parentId: string | null): Promise<boolean> {
    try {
      if (state.group) {
        const group = await api<Group>(`/api/groups/${state.group.id}`, { method: "PATCH", body: { name, parentId } });
        setVault((v) => v && { ...v, groups: v.groups.map((g) => (g.id === group.id ? group : g)) });
      } else {
        const group = await api<Group>("/api/groups", { method: "POST", body: { name, parentId } });
        setVault((v) => v && { ...v, groups: [...v.groups, group] });
        selectView({ kind: "group", id: group.id });
      }
      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  }

  async function deleteGroup(group: Group) {
    if (!confirm(`Delete the group "${group.name}"?`)) return;
    try {
      await api(`/api/groups/${group.id}`, { method: "DELETE" });
      selectView({ kind: "all" });
      await loadVault();
    } catch (err) {
      handleError(err);
    }
  }

  // Keyboard shortcuts. Re-registered on every render, so they always see the current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "f") {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (draft) {
        if (ctrl && key === "s") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          leaveDraft();
        }
        return;
      }
      if (target === searchInput.current) {
        if (e.key === "Escape") {
          setQuery("");
          target.blur();
        } else if (e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          target.blur();
          moveSelection(1);
        }
        return;
      }
      if (target.matches("input, textarea, select, [contenteditable]") || e.altKey) return;
      const onControl = target.matches("button, a");

      if (!ctrl && e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
      } else if (!ctrl && key === "n") {
        e.preventDefault();
        newEntry();
      } else if (!ctrl && (key === "e" || (e.key === "Enter" && !onControl)) && entry && !entry.deletedAt) {
        e.preventDefault();
        setDraft(draftOf(entry));
      } else if (!ctrl && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
      } else if (!ctrl && e.key === "Delete" && entry && !entry.deletedAt) {
        e.preventDefault();
        moveToBin(entry.id);
      } else if (ctrl && key === "b" && entry?.username) {
        e.preventDefault();
        copyValue("username", entry.username);
      } else if (ctrl && key === "c" && entry?.password && !window.getSelection()?.toString()) {
        e.preventDefault();
        copyValue("password", entry.password);
      } else if (ctrl && key === "u" && entry && openableUrl(entry.url)) {
        e.preventDefault();
        window.open(openableUrl(entry.url)!, "_blank", "noopener,noreferrer");
      } else if (!ctrl && key === "t" && code.current) {
        e.preventDefault();
        copyValue("code", code.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!me || !vault) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-400 text-sm">
        {loadError || "Loading…"}
      </div>
    );
  }

  const viewTitle =
    words.length > 0
      ? "Search"
      : view.kind === "all"
        ? "All entries"
        : view.kind === "bin"
          ? "Recycle bin"
          : (paths.get(view.id) ?? []).join(" › ");
  const emptyText =
    words.length > 0
      ? "No matching entries."
      : inBin
        ? "The recycle bin is empty."
        : "No entries here yet. Press N to add one.";
  const showDetail = selectedId !== null || draft !== null;

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800">
      {/* ── Groups (a drawer on phones) ── */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-gray-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-gray-200 transition-transform
                    md:static md:z-auto md:w-64 md:translate-x-0 md:shrink-0
                    ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Sidebar
          me={me}
          groups={vault.groups}
          entries={vault.entries}
          view={view}
          onView={selectView}
          onNewGroup={(parentId) => setDialog({ kind: "group", parentId })}
          onEditGroup={(group) => setDialog({ kind: "group", group, parentId: group.parentId })}
          onDeleteGroup={deleteGroup}
          onGenerator={() => {
            setNavOpen(false);
            setDialog({ kind: "generator" });
          }}
          onBackup={() => {
            setNavOpen(false);
            setDialog({ kind: "backup" });
          }}
        />
      </aside>

      {/* ── Entries ── */}
      <section
        className={`${showDetail ? "hidden" : "flex"} md:flex flex-col w-full md:w-80 lg:w-96 md:shrink-0
                    bg-white border-r border-gray-200 min-w-0`}
      >
        <div className="p-3 border-b border-gray-200 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${iconButton} md:hidden`}
              onClick={() => setNavOpen(true)}
              aria-label="Groups"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-700">{viewTitle}</h2>
            <button type="button" className={`${primaryButton} py-1.5`} onClick={newEntry} title="New entry (N)">
              <Plus className="w-4 h-4" /> New
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
            <input
              ref={searchInput}
              type="search"
              placeholder={inBin ? "Search the recycle bin" : "Search all entries (Ctrl+F)"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder-gray-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EntryList
            entries={list}
            selectedId={draft?.id ?? selectedId}
            paths={listPaths}
            emptyText={emptyText}
            inBin={inBin}
            onOpen={openEntry}
          />
        </div>
      </section>

      {/* ── The entry ── */}
      <main className={`${showDetail ? "flex" : "hidden"} md:flex flex-1 flex-col min-w-0`}>
        {signedOut && (
          <div role="alert" className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            Your session has ended, so nothing can be loaded or saved right now.
            {draft && " Your changes are kept."}{" "}
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              Sign in again
            </a>{" "}
            (opens a new tab), then come back here.
          </div>
        )}
        <div className="md:hidden px-3 pt-3">
          <button type="button" className={iconButton} onClick={() => openEntry(null)} aria-label="Back to the list">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-10 md:py-8">
          {draft ? (
            <EntryEditor
              key={draft.id ?? "new"}
              draft={draft}
              groups={vault.groups}
              saving={saving}
              onChange={setDraft}
              onSave={() => save()}
              onCancel={leaveDraft}
              onSaveOver={saveOver}
              onDiscard={discardDraft}
              onCopy={(value) => copyValue("password", value)}
            />
          ) : entry && entry.id === selectedId ? (
            <EntryView
              key={entry.id}
              entry={entry}
              groupPath={entry.groupId ? (paths.get(entry.groupId) ?? []).join(" › ") : ""}
              onEdit={() => setDraft(draftOf(entry))}
              onDelete={() => moveToBin(entry.id)}
              onRestore={() => restore(entry.id)}
              onPurge={() => purge(entry.id)}
              onCopy={copyValue}
              onCode={showCode}
              onError={handleError}
            />
          ) : selectedId ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
              <KeyRound className="w-10 h-10 mb-3 text-gray-200" />
              <p className="text-sm">Choose an entry, or press N for a new one.</p>
              <p className="mt-1 text-xs">Search with / or Ctrl+F; move with ↑ and ↓.</p>
            </div>
          )}
        </div>
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg px-4 py-2.5
                      shadow-lg text-sm max-w-[calc(100vw-2rem)]
                      ${notice.tone === "error" ? "bg-red-700 text-white" : "bg-gray-900 text-white"}`}
        >
          <span>{notice.text}</span>
          {notice.action && (
            <button
              type="button"
              className="font-medium text-blue-200 hover:text-white"
              onClick={() => {
                notice.action!.run();
                setNotice(null);
              }}
            >
              {notice.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {dialog?.kind === "group" && (
        <GroupDialog
          groups={vault.groups}
          group={dialog.group}
          parentId={dialog.parentId}
          onSave={(name, parentId) => saveGroup(dialog, name, parentId)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "generator" && (
        <Dialog title="Password generator" onClose={() => setDialog(null)}>
          <Generator onCopy={(value) => copyValue("password", value)} />
        </Dialog>
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog
          onImported={() => loadVault().catch(handleError)}
          onError={handleError}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
