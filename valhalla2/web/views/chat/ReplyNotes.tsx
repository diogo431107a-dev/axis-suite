import type { Message } from "../../../shared/protocol.ts";
import { textOf } from "./message.ts";

/** What the API said about a reply, under it. */
export function ReplyNotes({ message }: { message: Message }) {
  const reply = message.reply;
  return (
    <>
      {reply?.stopReason === "refusal" ? (
        <div className={textOf(message) ? "mt-2 border-t border-rule pt-2" : ""}>
          <p className="text-sm text-warn">
            The API declined to answer this turn
            {reply.stopDetails?.category ? ` (${reply.stopDetails.category})` : ""}.
          </p>
          {reply.stopDetails?.explanation ? (
            <p className="mt-1 text-sm text-faint">{reply.stopDetails.explanation}</p>
          ) : null}
          <p className="mt-1 text-xs text-faint">
            This exchange is kept here but not sent again, so the model never sees it. Ask for another version, or say
            it another way.
          </p>
        </div>
      ) : null}
      {reply?.stopReason === "max_tokens" ? (
        <p className="mt-2 text-xs text-faint">
          Cut off at the reply length this companion asks for. Raise it in its settings.
        </p>
      ) : null}
      {reply?.servedBy ? (
        <p className="mt-2 text-xs text-faint">
          {reply.declinedBy
            ? `${reply.declinedBy} declined; answered by ${reply.servedBy}.`
            : `Answered by ${reply.servedBy}, which the API keeps using for a while after a decline.`}
        </p>
      ) : null}
      {message.instruction && !message.isGreeting ? (
        <p className="mt-2 text-xs text-faint" title={message.instruction}>
          Written with your note on the versions before it.
        </p>
      ) : null}
      {message.editedAt ? <p className="mt-2 text-xs text-faint">Edited.</p> : null}
    </>
  );
}
