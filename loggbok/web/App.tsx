import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Plus, Search, Clock, UserRound, Users, Share2, X, Menu, Download } from "lucide-react";
import {
  SignedOutError,
  apiFetch,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import ShareDialog from "./ShareDialog.tsx";

/** The signed-in user's access to a note: theirs, shared with them to edit, or to read. */
type Role = "owner" | "editor" | "viewer";

export type Permission = "read" | "write";

/** Someone a note is shared with. */
export interface Share {
  username: string;
  permission: Permission;
}

/** A note as the list shows it (GET /api/notes). */
interface NoteSummary {
  id: string;
  /** Heimdall username of the note's owner. */
  owner: string;
  role: Role;
  /** Shared with anyone at all. */
  shared: boolean;
  title: string;
  /** The start of the content. The list doesn't get all of it. */
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/** A whole note, as GET /api/notes/:id, POST and PUT answer. */
interface Note extends NoteSummary {
  content: string;
  /** Who it is shared with. Only its owner gets this. */
  shares?: Share[];
}

interface Draft {
  id: string | null;
  title: string;
  content: string;
  owner?: string;
  role: Role;
  shares: Share[];
  createdAt?: string;
  /** The saved version this draft started from; the server refuses to save over a newer one. */
  updatedAt?: string;
  /** Changed since it was opened or last saved. */
  dirty: boolean;
}

const API = "/api/notes";
const NEW_DRAFT: Draft = { id: null, title: "", content: "", role: "owner", shares: [], dirty: false };

const draftOf = (note: Note): Draft => ({
  id: note.id,
  title: note.title,
  content: note.content,
  owner: note.owner,
  role: note.role,
  shares: note.shares ?? [],
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  dirty: false,
});

// apiFetch throws an Error holding the response body, which is JSON for the API's own errors.
function errorBody(e: unknown): { error?: string; note?: Note } | null {
  if (!(e instanceof Error)) return null;
  try {
    return JSON.parse(e.message) as { error?: string; note?: Note };
  } catch {
    return null;
  }
}

// One formatter for the whole page. toLocaleString() builds a new one on every call, which is
// slow when the list formats a date for every note.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmt = (iso: string) => dateFormat.format(new Date(iso));

// What the list keeps of a note it just saved.
function summaryOf({ content: _content, ...summary }: Note): NoteSummary {
  return summary;
}

export default function Loggbok() {
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");
  // Set when the session ends mid-use. Holds the sign-in URL; the draft is kept.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  // Set when saving finds a newer version, saved by someone else; holds that version.
  const [conflict, setConflict] = useState<Note | null>(null);
  // The last thing that went wrong, shown until the next action succeeds.
  const [problem, setProblem] = useState("");
  const [sharing, setSharing] = useState(false);
  // On narrow screens the sidebar is a drawer over the editor.
  const [navOpen, setNavOpen] = useState(false);
  // The search the list shows, so the same one isn't fetched again.
  const listedQuery = useRef("");
  // The note being opened. A later click, or New Entry, makes its answer stale.
  const opening = useRef<string | null>(null);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof SignedOutError) return setSignedOut(signInUrl(e.loginUrl));
    console.error(e);
    setProblem(errorBody(e)?.error ?? "Something went wrong. Try again in a moment.");
  }, []);

  useEffect(() => {
    // Both at once. If nobody is signed in, either one fails with SignedOutError.
    Promise.all([fetchMe(), apiFetch<NoteSummary[]>(API)])
      .then(([user, list]) => {
        setNotes(list ?? []);
        setMe(user);
      })
      .catch((e) => {
        if (e instanceof SignedOutError) goToSignIn(e);
        else setLoadError("Could not load your notes. Try again in a moment.");
      });
  }, []);

  // Debounced search — re-queries the server
  useEffect(() => {
    const q = search.trim();
    if (!me || q === listedQuery.current) return;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const list = await apiFetch<NoteSummary[]>(q ? `${API}?q=${encodeURIComponent(q)}` : API);
        if (stale) return; // the search changed while this one was on its way
        setNotes(list ?? []);
        listedQuery.current = q;
      } catch (e) {
        handleError(e); // otherwise leave notes as-is on network error
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [search, me, handleError]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after
  // signing in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => setSignedOut(null));
  }, [signedOut, me]);

  // Puts a just-saved note at the top of the list: it's now the most recently updated one.
  const listSaved = (note: Note) => setNotes((prev) => [summaryOf(note), ...prev.filter((n) => n.id !== note.id)]);

  // overwrite: save even if someone else has saved the note since this draft started.
  const saveNote = async (overwrite = false) => {
    if (!draft.title.trim() && !draft.content.trim()) return;
    const title = draft.title.trim() || "Untitled";
    try {
      if (draft.id) {
        const updated = await apiFetch<Note>(`${API}/${draft.id}`, {
          method: "PUT",
          body: JSON.stringify({
            title,
            content: draft.content,
            ...(!overwrite && { baseUpdatedAt: draft.updatedAt }),
          }),
        });
        if (updated) {
          listSaved(updated);
          setDraft((d) => ({ ...d, updatedAt: updated.updatedAt }));
        }
      } else {
        const created = await apiFetch<Note>(API, {
          method: "POST",
          body: JSON.stringify({ title, content: draft.content }),
        });
        if (created) {
          setNotes((prev) => [summaryOf(created), ...prev]);
          setDraft((d) => ({
            ...d,
            id: created.id,
            owner: created.owner,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }));
        }
      }
      setDraft((d) => ({ ...d, dirty: false }));
      setSignedOut(null);
      setConflict(null);
      setProblem("");
    } catch (e) {
      const newer = errorBody(e)?.note;
      if (newer) setConflict(newer);
      else handleError(e);
    }
  };

  // After a conflict: drop this draft's changes for the version someone else saved.
  function loadTheirs(note: Note) {
    listSaved(note);
    setDraft(draftOf(note));
    setConflict(null);
  }

  // The list only has a preview of each note, so opening one fetches all of it.
  const openNote = useCallback(
    async (noteId: string) => {
      opening.current = noteId;
      try {
        const note = await apiFetch<Note>(`${API}/${noteId}`);
        if (note && opening.current === noteId) {
          setDraft(draftOf(note));
          setConflict(null);
          setProblem("");
        }
      } catch (e) {
        handleError(e);
      }
    },
    [handleError],
  );

  // Deletes the user's own note; a note shared with them just leaves their list.
  const removeNote = useCallback(
    async (note: NoteSummary) => {
      if (!me) return;
      const url =
        note.role === "owner" ? `${API}/${note.id}` : `${API}/${note.id}/shares/${encodeURIComponent(me.username)}`;
      try {
        await apiFetch(url, { method: "DELETE" });
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        setDraft((d) => (d.id === note.id ? NEW_DRAFT : d));
      } catch (e) {
        handleError(e);
      }
    },
    [me, handleError],
  );

  function sharesSaved(noteId: string, shares: Share[]) {
    setSharing(false);
    setProblem("");
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, shared: shares.length > 0 } : n)));
    setDraft((d) => (d.id === noteId ? { ...d, shares } : d));
  }
  const closeSharing = useCallback(() => setSharing(false), []);
  const pickNote = useCallback(
    (noteId: string) => {
      setNavOpen(false);
      openNote(noteId);
    },
    [openNote],
  );

  const savedVersion = draft.id ? notes.find((n) => n.id === draft.id) : null;
  const readOnly = draft.role === "viewer";

  function newNote() {
    opening.current = null;
    setNavOpen(false);
    setDraft(NEW_DRAFT);
    setConflict(null);
    setProblem("");
  }
  function patch(field: "title" | "content", value: string) {
    setDraft((d) => ({ ...d, [field]: value, dirty: true }));
  }
  // Saves the note as on screen, unsaved edits included, to a text file named after its title.
  function downloadNote() {
    const name = draft.title.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
    const url = URL.createObjectURL(new Blob([draft.content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  if (!me) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-400 text-sm">
        {loadError || "Loading…"}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-gray-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      {/* ── Sidebar: a drawer on narrow screens ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-gray-200 flex flex-col
          transition-transform md:static md:z-auto md:translate-x-0 md:shrink-0
          ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">📒 Loggbok</h1>
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={me.accountUrl}
                title={`Signed in as ${me.username}. Manage your session.`}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600
                           transition-colors truncate"
              >
                <UserRound className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{me.name}</span>
              </a>
              <button
                type="button"
                aria-label="Close the menu"
                onClick={() => setNavOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600
                           transition-colors md:hidden"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
            <input
              type="text"
              placeholder="Search entries…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-indigo-400
                         placeholder-gray-300 text-gray-700"
            />
          </div>

          <button
            onClick={newNote}
            className="w-full bg-indigo-600 text-white text-sm py-2 rounded-lg
                       hover:bg-indigo-700 active:bg-indigo-800 transition-colors
                       flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Entry
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NoteList
            notes={notes}
            selectedId={draft.id}
            searching={search !== ""}
            onOpen={pickNote}
            onRemove={removeNote}
          />
        </div>
      </aside>

      {/* ── Editor ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white md:hidden">
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setNavOpen(true)}
            className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-gray-800 tracking-tight">📒 Loggbok</span>
        </div>
        {signedOut && (
          <div role="alert" className="px-4 md:px-10 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            Your session has ended, so nothing can be saved right now. Your draft is kept.{" "}
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              Sign in again
            </a>{" "}
            (opens a new tab), then come back here and save.
          </div>
        )}
        {conflict && (
          <div role="alert" className="px-4 md:px-10 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            Someone else changed this note after you opened it.{" "}
            <button onClick={() => loadTheirs(conflict)} className="font-medium underline">
              Load their version
            </button>{" "}
            (drops your changes) or{" "}
            <button onClick={() => saveNote(true)} className="font-medium underline">
              keep yours
            </button>{" "}
            (replaces theirs).
          </div>
        )}
        {problem && (
          <div role="alert" className="px-4 md:px-10 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {problem}
          </div>
        )}

        <div className="px-4 md:px-10 py-6 border-b border-gray-200 bg-white">
          <input
            type="text"
            placeholder="Entry title"
            value={draft.title}
            readOnly={readOnly}
            onChange={(e) => patch("title", e.target.value)}
            className="w-full text-3xl font-bold text-gray-800 bg-transparent
                       border-none outline-none placeholder-gray-200"
          />
        </div>

        <div className="flex-1 px-4 md:px-10 py-6 overflow-y-auto bg-white">
          <textarea
            placeholder="Start writing…"
            value={draft.content}
            readOnly={readOnly}
            onChange={(e) => patch("content", e.target.value)}
            className="w-full h-full text-gray-700 text-base leading-relaxed
                       bg-transparent resize-none border-none outline-none
                       placeholder-gray-200"
          />
        </div>

        <div className="px-4 md:px-6 py-3 border-t border-gray-200 bg-white flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {readOnly
              ? `Read only, shared by ${draft.owner}`
              : draft.dirty
                ? "Unsaved changes"
                : savedVersion
                  ? `Saved ${fmt(savedVersion.updatedAt)}`
                  : "New entry — not yet saved"}
            {draft.role === "editor" && ` · Shared by ${draft.owner}`}
          </span>
          <div className="flex items-center gap-2">
            {(draft.title.trim() || draft.content.trim()) && (
              <button
                onClick={downloadNote}
                title="Download as a text file"
                aria-label="Download as a text file"
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            {draft.role === "owner" && draft.id && (
              <button
                onClick={() => setSharing(true)}
                title={
                  draft.shares.length ? `Shared with ${draft.shares.map((s) => s.username).join(", ")}` : undefined
                }
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600
                           hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                {draft.shares.length ? `Shared (${draft.shares.length})` : "Share"}
              </button>
            )}
            {!readOnly && (
              <button
                onClick={() => saveNote()}
                disabled={!draft.title.trim() && !draft.content.trim()}
                className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg
                           hover:bg-indigo-700 active:bg-indigo-800 transition-colors
                           disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {draft.id ? "Update" : "Save Entry"}
              </button>
            )}
          </div>
        </div>
      </div>

      {sharing && draft.id && (
        <ShareDialog
          key={draft.id}
          noteId={draft.id}
          title={draft.title}
          shares={draft.shares}
          onSaved={(shares) => sharesSaved(draft.id!, shares)}
          onClose={closeSharing}
          onError={handleError}
        />
      )}
    </div>
  );
}

interface NoteListProps {
  notes: NoteSummary[];
  selectedId: string | null;
  searching: boolean;
  onOpen: (noteId: string) => void;
  /** Deletes the user's own note, or takes a shared one off their list. */
  onRemove: (note: NoteSummary) => void;
}

// Memoized, so typing in the editor doesn't redraw every note in the list.
const NoteList = memo(function NoteList({ notes, selectedId, searching, onOpen, onRemove }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-gray-400">{searching ? "No matching entries." : "No entries yet."}</p>
    );
  }
  return notes.map((note) => (
    <div
      key={note.id}
      onClick={() => onOpen(note.id)}
      className={`group p-4 border-b border-gray-100 cursor-pointer transition-colors
      ${selectedId === note.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : "hover:bg-gray-50"}`}
    >
      <div className="flex justify-between items-start gap-2 mb-1">
        <h3 className="font-medium text-sm text-gray-800 truncate leading-snug">{note.title}</h3>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(note);
          }}
          title={note.role === "owner" ? "Delete entry" : "Remove from my list"}
          className="text-gray-200 hover:text-red-400 transition-colors shrink-0
                   md:opacity-0 md:group-hover:opacity-100"
        >
          {note.role === "owner" ? <Trash2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-gray-400 truncate mb-2 leading-snug">{note.preview || "No content"}</p>
      <div className="flex items-center gap-1 text-xs text-gray-300">
        <Clock className="w-3 h-3" />
        {fmt(note.updatedAt)}
        {note.role === "owner" ? (
          note.shared && <Share2 className="w-3 h-3 ml-auto" aria-label="Shared" />
        ) : (
          <span
            className="ml-auto flex items-center gap-1 truncate"
            title={note.role === "viewer" ? `Shared by ${note.owner}, read only` : `Shared by ${note.owner}`}
          >
            <Users className="w-3 h-3 shrink-0" />
            <span className="truncate">{note.owner}</span>
          </span>
        )}
      </div>
    </div>
  ));
});
