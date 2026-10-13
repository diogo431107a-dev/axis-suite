import { useState, type FormEvent } from "react";
import { LIMITS, LOBBY_ID, roomKey, type Room } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { go } from "../nav.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { field, label, primaryButton, secondaryButton } from "../ui/buttons.ts";
import { closeDialog } from "../ui/closeDialog.ts";

interface RoomsDialogProps {
  me: string;
  rooms: Room[];
  onClose: () => void;
}

/** Every open room, to join one, and a field to open a new one. */
export function RoomsDialog({ me, rooms, onClose }: RoomsDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = rooms.filter((r) => r.id !== LOBBY_ID);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: number }>("/api/rooms", { method: "POST", body: { name } });
      closeDialog(form);
      go(roomKey(id));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function join(room: Room, button: Element) {
    setError("");
    try {
      if (!room.members.includes(me)) await api(`/api/rooms/${room.id}/join`, { method: "POST" });
      closeDialog(button);
      go(roomKey(room.id));
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Dialog title="Rooms" onClose={onClose}>
      <form onSubmit={(e) => void create(e)} className="mb-5">
        <label className={label} htmlFor="new-room">
          Open a new room
        </label>
        <div className="flex gap-2">
          <input
            id="new-room"
            className={`${field} min-w-0 flex-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.roomNameChars}
            placeholder="Name"
            required
            data-autofocus
          />
          <button type="submit" className={primaryButton} disabled={busy}>
            Open
          </button>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          Anyone can join it. It closes when everyone has left or closed Althing.
        </p>
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <h3 className={label}>Open rooms</h3>
      {open.length === 0 ? (
        <p className="text-sm text-stone-400">No rooms are open right now.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto">
          {open.map((room) => (
            <li key={room.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-800"># {room.name}</p>
                <p className="text-xs text-stone-400">
                  {room.members.length === 1 ? "1 person" : `${room.members.length} people`}
                </p>
              </div>
              <button type="button" className={secondaryButton} onClick={(e) => void join(room, e.currentTarget)}>
                {room.members.includes(me) ? "Open" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
