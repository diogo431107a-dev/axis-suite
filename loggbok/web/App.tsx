import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Plus, Search, Clock, UserRound } from "lucide-react";
import {
  SignedOutError,
  apiFetch,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";

/** A note as the list shows it (GET /api/notes). */
interface NoteSummary {
  id: string;
  /** Heimdall username of the note's owner. */
  owner: string;
  /** The signed-in user's role on this note. Sharing will add 'editor' and 'viewer'. */
  role: "owner";
  title: string;
  /** The start of the content. The list doesn't get all of it. */
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/** A whole note, as GET /api/notes/:id, POST and PUT answer. */
interface Note extends NoteSummary {
  content: string;
}

interface Draft {
  id: string | null;
  title: string;
  content: string;
  createdAt?: string;
  /** Changed since it was opened or last saved. */
  dirty: boolean;
}

const API = "/api/notes";
const NEW_DRAFT: Draft = { id: null, title: "", content: "", dirty: false };

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
  // The search the list shows, so the same one isn't fetched again.
  const listedQuery = useRef("");
  // The note being opened. A later click, or New Entry, makes its answer stale.
  const opening = useRef<string | null>(null);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof SignedOutError) setSignedOut(signInUrl(e.loginUrl));
    else console.error(e);
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

  const saveNote = async () => {
    if (!draft.title.trim() && !draft.content.trim()) return;
    const title = draft.title.trim() || "Untitled";
    try {
      if (draft.id) {
        const updated = await apiFetch<Note>(`${API}/${draft.id}`, {
          method: "PUT",
          body: JSON.stringify({ title, content: draft.content }),
        });
        if (updated) {
          // Just saved, so it's now the most recently updated note.
          setNotes((prev) => [summaryOf(updated), ...prev.filter((n) => n.id !== updated.id)]);
        }
      } else {
        const created = await apiFetch<Note>(API, {
          method: "POST",
          body: JSON.stringify({ title, content: draft.content }),
        });
        if (created) {
          setNotes((prev) => [summaryOf(created), ...prev]);
          setDraft((d) => ({ ...d, id: created.id, createdAt: created.createdAt }));
        }
      }
      setDraft((d) => ({ ...d, dirty: false }));
      setSignedOut(null);
    } catch (e) {
      handleError(e);
    }
  };

  // The list only has a preview of each note, so opening one fetches all of it.
  const openNote = useCallback(
    async (noteId: string) => {
      opening.current = noteId;
      try {
        const note = await apiFetch<Note>(`${API}/${noteId}`);
        if (note && opening.current === noteId) {
          setDraft({ id: note.id, title: note.title, content: note.content, createdAt: note.createdAt, dirty: false });
        }
      } catch (e) {
        handleError(e);
      }
    },
    [handleError],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      try {
        await apiFetch(`${API}/${noteId}`, { method: "DELETE" });
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setDraft((d) => (d.id === noteId ? NEW_DRAFT : d));
      } catch (e) {
        handleError(e);
      }
    },
    [handleError],
  );

  const savedVersion = draft.id ? notes.find((n) => n.id === draft.id) : null;

  function newNote() {
    opening.current = null;
    setDraft(NEW_DRAFT);
  }
  function patch(field: "title" | "content", value: string) {
    setDraft((d) => ({ ...d, [field]: value, dirty: true }));
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
      {/* ── Sidebar ── */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">📒 Loggbok</h1>
            <a
              href={me.accountUrl}
              title={`Signed in as ${me.username}. Manage your session.`}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600
                         transition-colors truncate"
            >
              <UserRound className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{me.name}</span>
            </a>
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
            onOpen={openNote}
            onDelete={deleteNote}
          />
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {signedOut && (
          <div role="alert" className="px-10 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            Your session has ended, so nothing can be saved right now. Your draft is kept.{" "}
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              Sign in again
            </a>{" "}
            (opens a new tab), then come back here and save.
          </div>
        )}

        <div className="px-10 py-6 border-b border-gray-200 bg-white">
          <input
            type="text"
            placeholder="Entry title"
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
            className="w-full text-3xl font-bold text-gray-800 bg-transparent
                       border-none outline-none placeholder-gray-200"
          />
        </div>

        <div className="flex-1 px-10 py-6 overflow-y-auto bg-white">
          <textarea
            placeholder="Start writing…"
            value={draft.content}
            onChange={(e) => patch("content", e.target.value)}
            className="w-full h-full text-gray-700 text-base leading-relaxed
                       bg-transparent resize-none border-none outline-none
                       placeholder-gray-200"
          />
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-white flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {draft.dirty
              ? "Unsaved changes"
              : savedVersion
                ? `Saved ${fmt(savedVersion.updatedAt)}`
                : "New entry — not yet saved"}
          </span>
          <button
            onClick={saveNote}
            disabled={!draft.title.trim() && !draft.content.trim()}
            className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg
                       hover:bg-indigo-700 active:bg-indigo-800 transition-colors
                       disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {draft.id ? "Update" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface NoteListProps {
  notes: NoteSummary[];
  selectedId: string | null;
  searching: boolean;
  onOpen: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

// Memoized, so typing in the editor doesn't redraw every note in the list.
const NoteList = memo(function NoteList({ notes, selectedId, searching, onOpen, onDelete }: NoteListProps) {
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
            onDelete(note.id);
          }}
          title="Delete entry"
          className="text-gray-200 hover:text-red-400 transition-colors shrink-0
                   opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-gray-400 truncate mb-2 leading-snug">{note.preview || "No content"}</p>
      <div className="flex items-center gap-1 text-xs text-gray-300">
        <Clock className="w-3 h-3" />
        {fmt(note.updatedAt)}
      </div>
    </div>
  ));
});
