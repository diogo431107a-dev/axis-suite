import { useState } from "react";
import { LIMITS } from "../../../shared/protocol.ts";
import { Button, inputStyle } from "../../ui/bits.tsx";

/** Asks, once, why the versions of a reply keep being rejected. */
export function AskWhy({
  onAnswer,
  onSkip,
  disabled,
}: {
  onAnswer: (reason: string) => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 space-y-2 rounded border border-dashed border-accent/60 bg-sheet/50 p-3">
      <p className="text-sm">None of these working? Say why, and the next version will take it into account.</p>
      <textarea
        className={`${inputStyle} min-h-16 resize-y`}
        value={reason}
        maxLength={LIMITS.reason}
        placeholder="Too polite, too long, she wouldn't know that…"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button kind="strong" onClick={() => onAnswer(reason)} disabled={disabled || !reason.trim()}>
          Try again with this
        </Button>
        <Button kind="quiet" onClick={onSkip} disabled={disabled}>
          Skip
        </Button>
      </div>
    </div>
  );
}
