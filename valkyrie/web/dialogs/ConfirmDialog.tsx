import { useState } from "react";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, secondaryButton } from "../ui/buttons.ts";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** the button that does it, e.g. "Delete the card" */
  action: string;
  /** true when it worked (the dialog then closes) */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}

/** Asks before something that can't be undone. */
export function ConfirmDialog({ title, message, action, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-sm text-stone-700">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
          Keep it
        </button>
        <button
          type="button"
          data-autofocus
          className={dangerButton}
          disabled={busy}
          onClick={async (e) => {
            const button = e.currentTarget;
            setBusy(true);
            const done = await onConfirm();
            setBusy(false);
            if (done) closeDialog(button);
          }}
        >
          {action}
        </button>
      </div>
    </Dialog>
  );
}
