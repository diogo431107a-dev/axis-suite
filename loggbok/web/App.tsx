import { useState, useEffect } from "react";
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

interface Note {
  id: string;
  /** Heimdall username of the note's owner. */
  owner: string;
  /** The signed-in user's role on this note. Sharing will add 'editor' and 'viewer'. */
  role: "owner";
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Draft {
  id: string | null;
  title: string;
  content: string;
  createdAt?: string;
}

const API = "/api/notes";

export default function Loggbok() {
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Draft>({ id: null, title: "", content: "" });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  // Set when the session ends mid-use. Holds the sign-in URL; the draft is kept.
  const [signedOut, setSignedOut] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setMe(user);
        setNotes((await apiFetch<Note[]>(API)) ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof SignedOutError) goToSignIn(e);
        else setLoadError("Could not load your notes. Try again in a moment.");
      });
  }, []);

  // Debounced search — re-queries the server
  useEffect(() => {
    if (!me) return;
    const t = setTimeout(async () => {
      try {
        const url = search.trim() ? `${API}?q=${encodeURIComponent(search.trim())}` : API;
        setNotes((await apiFetch<Note[]>(url)) ?? []);
      } catch (e) {
        handleError(e); // otherwise leave notes as-is on network error
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, me]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after
  // signing in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => setSignedOut(null));
  }, [signedOut, me]);

  function handleError(e: unknown) {
    if (e instanceof SignedOutError) setSignedOut(signInUrl(e.loginUrl));
    else console.error(e);
  }

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
          setNotes((prev) =>
            prev
              .map((n) => (n.id === draft.id ? updated : n))
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
          );
        }
      } else {
        const created = await apiFetch<Note>(API, {
          method: "POST",
          body: JSON.stringify({ title, content: draft.content }),
        });
        if (created) {
          setNotes((prev) => [created, ...prev]);
          setDraft((d) => ({ ...d, id: created.id, createdAt: created.createdAt }));
        }
      }
      setDirty(false);
      setSignedOut(null);
    } catch (e) {
      handleError(e);
    }
  };

  const deleteNote = async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`${API}/${noteId}`, { method: "DELETE" });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (draft.id === noteId) newNote();
    } catch (e) {
      handleError(e);
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const savedVersion = draft.id ? notes.find((n) => n.id === draft.id) : null;

  function newNote() {
    setDraft({ id: null, title: "", content: "" });
    setDirty(false);
  }
  function editNote(note: Note) {
    setDraft({ id: note.id, title: note.title, content: note.content, createdAt: note.createdAt });
    setDirty(false);
  }
  function patch(field: "title" | "content", value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  }

  if (loading || !me) {
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
          {notes.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">
              {search ? "No matching entries." : "No entries yet."}
            </p>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                onClick={() => editNote(note)}
                className={`group p-4 border-b border-gray-100 cursor-pointer transition-colors
                ${draft.id === note.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : "hover:bg-gray-50"}`}
              >
                <div className="flex justify-between items-start gap-2 mb-1">
                  <h3 className="font-medium text-sm text-gray-800 truncate leading-snug">{note.title}</h3>
                  <button
                    onClick={(e) => deleteNote(note.id, e)}
                    title="Delete entry"
                    className="text-gray-200 hover:text-red-400 transition-colors shrink-0
                             opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-400 truncate mb-2 leading-snug">{note.content || "No content"}</p>
                <div className="flex items-center gap-1 text-xs text-gray-300">
                  <Clock className="w-3 h-3" />
                  {fmt(note.updatedAt)}
                </div>
              </div>
            ))
          )}
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
            {dirty
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
