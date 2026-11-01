import { useState } from "react";
import { Trash2 } from "lucide-react";

/** Deleting an entry, which asks once first. */
export function DeleteEntry({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="delete-row">
      {confirming ? (
        <>
          <span>Delete this entry?</span>
          <button type="button" className="btn danger" disabled={disabled} onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className="btn quiet" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden /> Delete
        </button>
      )}
    </div>
  );
}
