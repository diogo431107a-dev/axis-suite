import { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import type { Calendar, Permission, Share } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { field, iconButton, primaryButton, secondaryButton } from "../ui/buttons.ts";

interface ShareDialogProps {
  calendar: Calendar;
  onSaved: (shares: Share[]) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: "read", label: "Can read" },
  { value: "write", label: "Can edit" },
];

/** The owner's dialog for choosing who else may see a calendar, or also change its events. */
export function ShareDialog({ calendar, onSaved, onError, onClose }: ShareDialogProps) {
  const shares = calendar.shares ?? [];
  // null while the list of users is on its way.
  const [users, setUsers] = useState<string[] | null>(null);
  const [list, setList] = useState<Share[]>(shares);
  const [adding, setAdding] = useState("");
  const [addPermission, setAddPermission] = useState<Permission>("read");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<string[]>("/api/users").then(setUsers, (err: unknown) => {
      setUsers([]);
      onError(err);
    });
  }, [onError]);

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
    <Dialog title={`Share ${calendar.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setSaving(true);
          try {
            onSaved(await api<Share[]>(`/api/calendars/${calendar.id}/shares`, { method: "PUT", body: list }));
            closeDialog(form);
          } catch (err) {
            onError(err);
          } finally {
            setSaving(false);
          }
        }}
      >
        {list.length === 0 ? (
          <p className="text-sm text-stone-400">Only you can see this calendar.</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {list.map((s) => (
              <li key={s.username} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 truncate text-sm text-stone-700">{s.username}</span>
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
                  className={field}
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
                  className={`${iconButton} hover:text-red-600`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {users === null ? (
          <p className="text-sm text-stone-400">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-stone-400">Chronos doesn't know the suite's users yet, so it can't share.</p>
        ) : available.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={adding || available[0]}
              aria-label="Person to share with"
              onChange={(e) => setAdding(e.target.value)}
              className={`${field} min-w-0 flex-1`}
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
              className={field}
            >
              {PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="button" className={secondaryButton} onClick={add}>
              Add
            </button>
          </div>
        ) : (
          <p className="text-sm text-stone-400">Shared with everyone.</p>
        )}

        <p className="text-xs text-stone-400">
          Can read: they see its events. Can edit: they can also add, change and delete events. Only you can rename,
          delete or share it.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={!changed || saving}>
            <Share2 className="h-4 w-4" aria-hidden /> Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
