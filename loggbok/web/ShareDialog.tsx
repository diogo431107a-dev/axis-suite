import { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import { apiFetch } from "@axis-suite/heimdall-client/browser";
import type { Permission, Share } from "./App.tsx";

interface ShareDialogProps {
  noteId: string;
  title: string;
  shares: Share[];
  onSaved: (shares: Share[]) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}

const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: "read", label: "Can read" },
  { value: "write", label: "Can edit" },
];

const selectClass = `text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white
                     focus:outline-none focus:ring-2 focus:ring-indigo-400`;

/** The owner's dialog for choosing who else may read or edit a note. */
export default function ShareDialog({ noteId, title, shares, onSaved, onClose, onError }: ShareDialogProps) {
  // null while the list of users is on its way.
  const [users, setUsers] = useState<string[] | null>(null);
  const [list, setList] = useState<Share[]>(shares);
  const [adding, setAdding] = useState("");
  const [addPermission, setAddPermission] = useState<Permission>("read");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<string[]>("/api/users")
      .then((u) => setUsers(u ?? []))
      .catch((e) => {
        setUsers([]);
        onError(e);
      });
  }, [onError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = (users ?? []).filter((u) => !list.some((s) => s.username === u));
  const changed = JSON.stringify(list) !== JSON.stringify(shares);

  function add() {
    const username = adding || available[0];
    if (!username) return;
    setList((l) =>
      [...l, { username, permission: addPermission }].sort((a, b) => a.username.localeCompare(b.username)),
    );
    setAdding("");
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await apiFetch<Share[]>(`/api/notes/${noteId}/shares`, {
        method: "PUT",
        body: JSON.stringify(list),
      });
      onSaved(saved ?? []);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 bg-gray-900/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-xl shadow-xl p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="share-title" className="text-lg font-semibold text-gray-800 truncate">
            Share “{title || "Untitled"}”
          </h2>
          <button onClick={onClose} title="Close" className="text-gray-300 hover:text-gray-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {list.length === 0 ? (
          <p className="text-sm text-gray-400 mb-4">Only you can see this note.</p>
        ) : (
          <ul className="mb-4 divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {list.map((s) => (
              <li key={s.username} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-sm text-gray-700 truncate">{s.username}</span>
                <select
                  value={s.permission}
                  aria-label={`What ${s.username} can do`}
                  onChange={(e) =>
                    setList((l) =>
                      l.map((x) =>
                        x.username === s.username ? { ...x, permission: e.target.value as Permission } : x,
                      ),
                    )
                  }
                  className={selectClass}
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setList((l) => l.filter((x) => x.username !== s.username))}
                  title={`Stop sharing with ${s.username}`}
                  className="text-gray-300 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {users === null ? (
          <p className="text-sm text-gray-400 mb-4">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 mb-4">Loggbok doesn't know the suite's users yet, so it can't share.</p>
        ) : available.length > 0 ? (
          <div className="flex items-center gap-2 mb-5">
            <select
              value={adding || available[0]}
              aria-label="Person to share with"
              onChange={(e) => setAdding(e.target.value)}
              className={`${selectClass} flex-1 min-w-0`}
            >
              {available.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              value={addPermission}
              aria-label="What they can do"
              onChange={(e) => setAddPermission(e.target.value as Permission)}
              className={selectClass}
            >
              {PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              onClick={add}
              className="text-sm px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600
                         hover:bg-indigo-50 transition-colors"
            >
              Add
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">Shared with everyone.</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!changed || saving}
            className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg flex items-center gap-2
                       hover:bg-indigo-700 active:bg-indigo-800 transition-colors
                       disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            <Share2 className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
