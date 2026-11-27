// What is happening right now, under the chat: your message on its way, and the reply as it comes.
import { Bubble } from "../../ui/bits.tsx";
import { SpokenText } from "../../ui/SpokenText.tsx";
import type { Writing } from "./useChat.ts";

export function Live({
  writing,
  thinking,
  incoming,
  remembering,
  companionName,
}: {
  writing: Writing | null;
  thinking: boolean;
  incoming: string;
  remembering: "others" | "this" | null;
  companionName: string;
}) {
  return (
    <>
      {writing?.kind === "send" ? (
        <article className="pl-6 sm:pl-16">
          <h3 className="mb-1 text-right font-display text-sm text-faint">You</h3>
          <Bubble mine>
            <SpokenText text={writing.text} />
          </Bubble>
        </article>
      ) : null}
      {writing && thinking && !incoming ? (
        <p className="pr-6 text-sm text-faint sm:pr-16">{companionName} is thinking…</p>
      ) : null}
      {writing && incoming ? (
        <article className="pr-6 sm:pr-16">
          <h3 className="mb-1 font-display text-sm text-accent">{companionName}</h3>
          <Bubble mine={false}>
            <SpokenText text={incoming} />
          </Bubble>
        </article>
      ) : null}
      {writing && remembering === "others" ? (
        <p className="pr-6 text-sm text-faint sm:pr-16">{companionName} is catching up on your other chats first…</p>
      ) : null}
      {writing && remembering === "this" ? (
        <p className="pr-6 text-sm text-faint sm:pr-16">
          {companionName} is putting the oldest part of this chat into memory first…
        </p>
      ) : null}
      {writing && !remembering && !thinking && !incoming ? (
        <p className="pr-6 text-sm text-faint sm:pr-16">Asking {companionName}…</p>
      ) : null}
    </>
  );
}
