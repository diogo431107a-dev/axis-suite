import { useState } from "react";
import { LIMITS } from "../../../shared/protocol.ts";
import { Button, inputStyle } from "../../ui/bits.tsx";

/**
 * Under a reply you just liked, or one you liked before: what made it good, if you want to say.
 * Only a comment reaches the companion, through the memory model; without one the like is yours.
 */
export function LikeNote({
  comment,
  companionName,
  onSave,
  onUnlike,
  onClose,
  disabled,
}: {
  comment: string | null;
  companionName: string;
  onSave: (comment: string) => void;
  onUnlike: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [said, setSaid] = useState(comment ?? "");
  const changed = said.trim() !== (comment ?? "");
  return (
    <div className="mt-2 space-y-2 rounded border border-dashed border-accent/60 bg-sheet/50 p-3">
      <p className="text-sm">Liked. What made it good? (optional)</p>
      <textarea
        className={`${inputStyle} min-h-16 resize-y`}
        value={said}
        maxLength={LIMITS.likeComment}
        placeholder="The dodged question, the slow build-up, the dry humour…"
        onChange={(e) => setSaid(e.target.value)}
      />
      <p className="text-xs text-faint">
        Only a comment reaches {companionName}: the memory model reads it at its next run and keeps what you liked.
        Without one, the like is just for you. For words that must stay exactly as they were said, pin them instead.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button kind="strong" onClick={() => onSave(said.trim())} disabled={disabled || !changed}>
          {said.trim() || !comment ? "Save" : "Remove the comment"}
        </Button>
        <Button kind="quiet" onClick={onClose} disabled={disabled}>
          {comment ? "Keep it as it is" : "Just like it"}
        </Button>
        <Button kind="quiet" onClick={onUnlike} disabled={disabled}>
          Unlike
        </Button>
      </div>
    </div>
  );
}
