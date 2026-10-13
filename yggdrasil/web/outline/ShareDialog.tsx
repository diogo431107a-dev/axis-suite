// The owner's dialog for choosing who else may see a bullet (and everything under it), or also
// change it. The same choices as Loggbok's notes and Chronos's calendars.
import { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import type { Permission, Share } from "../../shared/protocol.ts";
import { listUsers, saveShares } from "../model/sharing.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner } from "./hooks.ts";

const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: "read", label: "Can read" },
  { value: "write", label: "Can edit" },
];

const FIELD = "rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700";
const SECONDARY = "rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50";

export function ShareDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useOutliner();
  const shares = o.store.sharesOf(id);
  const name = plainText(o.store.get(id)?.content ?? "") || "Untitled";
  // null while the list of users is on its way.
  const [users, setUsers] = useState<string[] | null>(null);
  const [list, setList] = useState<Share[]>([...shares]);
  const [adding, setAdding] = useState("");
  const [addPermission, setAddPermission] = useState<Permission>("read");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listUsers(o).then(setUsers, (err: unknown) => {
      setUsers([]);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [o]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg bg-white p-5 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await saveShares(o, id, list);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="share-title" className="truncate text-lg font-semibold text-gray-900">
            Share “{name.length > 40 ? `${name.slice(0, 40)}…` : name}”
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {list.length === 0 ? (
          <p className="text-sm text-gray-400">Only you can see this bullet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {list.map((s) => (
              <li key={s.username} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 truncate text-sm text-gray-700">{s.username}</span>
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
                  className={FIELD}
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setList((l) => l.filter((x) => x.username !== s.username))}
                  aria-label={`Stop sharing with ${s.username}`}
                  title={`Stop sharing with ${s.username}`}
                  className="rounded p-1 text-gray-400 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {users === null ? (
          <p className="text-sm text-gray-400">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400">Yggdrasil doesn’t know the suite’s users yet, so it can’t share.</p>
        ) : available.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={adding || available[0]}
              aria-label="Person to share with"
              onChange={(e) => setAdding(e.target.value)}
              className={`${FIELD} min-w-0 flex-1`}
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
              className={FIELD}
            >
              {PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="button" className={SECONDARY} onClick={add}>
              Add
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Shared with everyone.</p>
        )}

        <p className="text-xs text-gray-400">
          Everything under this bullet is shared with it, including bullets added later. Can read: they see it. Can
          edit: they can also change, add, move and delete bullets inside it. Only you can move, delete or share it.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!changed || saving}
            className="flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
