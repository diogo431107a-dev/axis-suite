import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { COLORS, LIMITS, type Board, type Color, type ExportFile } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { COLOR_CLASSES } from "../colors.ts";
import { download, fileName } from "../download.ts";
import { count } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface BoardDialogProps {
  /** the board to change; none to make a new one */
  board?: Board;
  /** what is on it, for the delete question */
  stats?: { lists: number; cards: number };
  boards: Board[];
  onSaved: (board: Board) => void;
  onDeleted?: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/** Makes a board, or renames, recolours, exports or deletes one. */
export function BoardDialog({ board, stats, boards, onSaved, onDeleted, onError, onClose }: BoardDialogProps) {
  const [name, setName] = useState(board?.name ?? "");
  const [color, setColor] = useState<Color>(
    board?.color ?? COLORS.find((c) => !boards.some((b) => b.color === c)) ?? COLORS[0],
  );
  const [template, setTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={board ? "Board" : "New board"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void run(async () => {
            const body = { name: name.trim(), color, ...(board ? {} : { template }) };
            const saved = board
              ? await api<Board>(`/api/boards/${board.id}`, { method: "PATCH", body })
              : await api<Board>("/api/boards", { method: "POST", body });
            onSaved(saved);
            closeDialog(form);
          });
        }}
      >
        <div>
          <label htmlFor="board-name" className={label}>
            Name
          </label>
          <input
            id="board-name"
            data-autofocus
            required
            maxLength={LIMITS.nameChars}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Work, Home, Garden…"
            className={textInput}
          />
        </div>

        <fieldset>
          <legend className={label}>Colour</legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={c === color}
                className={`h-7 w-7 rounded-full ${COLOR_CLASSES[c].dot} ${
                  c === color ? "ring-2 ring-stone-800 ring-offset-2" : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </fieldset>

        {!board && (
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={template}
              onChange={(e) => setTemplate(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-violet-600"
            />
            Start with the lists To do, Doing and Done, and six coloured labels
          </label>
        )}

        {board && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            <span className="flex-1">
              {count(stats?.lists ?? 0, "list", "lists")}, {count(stats?.cards ?? 0, "card", "cards")}.
            </span>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const file = await api<ExportFile>(`/api/boards/${board.id}/export`);
                  download(fileName(board.name, "json"), "application/json", JSON.stringify(file, null, 2));
                })
              }
            >
              <Download className="h-4 w-4" aria-hidden /> Export
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {board && onDeleted && !confirmDelete && (
            <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete…
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
            {board ? "Save" : "Create"}
          </button>
        </div>

        {board && onDeleted && confirmDelete && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>
              Delete the board <strong>{board.name}</strong>
              {stats && (stats.lists > 0 || stats.cards > 0)
                ? ` with its ${count(stats.lists, "list", "lists")} and ${count(stats.cards, "card", "cards")}`
                : ""}
              ? This can't be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={dangerButton}
                disabled={busy}
                onClick={(e) => {
                  const button = e.currentTarget;
                  void run(async () => {
                    await api(`/api/boards/${board.id}`, { method: "DELETE" });
                    closeDialog(button);
                    onDeleted();
                  });
                }}
              >
                Delete the board
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
