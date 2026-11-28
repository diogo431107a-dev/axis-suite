// Every picture of a companion, in two shelves: the profile pictures made from its page, and the
// pictures made from moments in its chats. Each file is read from the server's disk as it is shown.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ImagePlus, MessageSquare } from "lucide-react";
import type { Companion, Picture, PictureDraft } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { usePage } from "../page.ts";
import { Button, Notice } from "../ui/bits.tsx";
import { PictureView, Thumb } from "../ui/pictures.tsx";
import { useWatched } from "../ui/watch.ts";
import { PictureDialog, type PictureTarget } from "./PictureDialog.tsx";

const draftOf = ({ prompt, negativePrompt, orientation, caption }: Picture): PictureDraft => ({
  prompt,
  negativePrompt,
  orientation,
  caption,
});

/** Where "Make again" makes a picture: the same companion, or the same moment of the same chat. */
const targetOf = (picture: Picture): PictureTarget | null =>
  picture.kind === "profile"
    ? { kind: "profile" }
    : picture.chatId && picture.messageId !== null
      ? { kind: "chat", chatId: picture.chatId, messageId: picture.messageId }
      : null;

function Shelf({
  title,
  note,
  pictures,
  onOpen,
}: {
  title: string;
  note: string;
  pictures: Picture[];
  onOpen: (picture: Picture) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-rule pb-1">
        <h2 className="font-display text-xl">{title}</h2>
        <span className="text-sm text-faint">{pictures.length}</span>
      </div>
      {pictures.length === 0 ? (
        <p className="text-sm text-faint">{note}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pictures.map((picture) => (
            <li key={picture.id} className="space-y-1.5">
              <Thumb picture={picture} onOpen={() => onOpen(picture)} className="w-full" />
              {picture.caption ? <p className="line-clamp-2 text-xs leading-snug">{picture.caption}</p> : null}
              {picture.kind === "chat" ? (
                <p className="truncate text-xs text-faint">{picture.chatTitle ?? "A deleted chat"}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Gallery({ companion }: { companion: Companion }) {
  const { open, health } = usePage();
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ target: PictureTarget; start?: PictureDraft } | null>(null);

  const load = useCallback(async () => {
    try {
      setPictures(await api<Picture[]>(`/api/companions/${companion.id}/pictures`));
    } catch (err) {
      setError(describeError(err));
    }
  }, [companion.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useWatched(pictures ?? [], (changed) =>
    setPictures((at) => at?.map((picture) => (picture.id === changed.id ? changed : picture)) ?? at),
  );

  const shown = pictures?.find((picture) => picture.id === viewing) ?? null;
  const profile = pictures?.filter((picture) => picture.kind === "profile") ?? [];
  const chat = pictures?.filter((picture) => picture.kind === "chat") ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="quiet" onClick={() => open({ kind: "companion", id: companion.id })}>
          <ArrowLeft size={15} /> {companion.name}
        </Button>
        <h1 className="font-display text-2xl">Pictures of {companion.name}</h1>
        {health.pictures ? (
          <span className="ml-auto">
            <Button kind="plain" onClick={() => setAsking({ target: { kind: "profile" } })}>
              <ImagePlus size={15} /> Make a profile picture
            </Button>
          </span>
        ) : null}
      </div>
      {health.pictures ? null : (
        <Notice kind="quiet">
          This Valhalla 2 has no CivitAI key and no xAI key, so it can't make new pictures. The ones already made are
          still here.
        </Notice>
      )}
      <Notice>{error}</Notice>

      {pictures ? (
        <>
          <Shelf
            title="Profile pictures"
            note={`None yet. "Make a profile picture" draws ${companion.name} from the profile.`}
            pictures={profile}
            onOpen={(picture) => setViewing(picture.id)}
          />
          <Shelf
            title="Chat pictures"
            note="None yet. In a chat, the picture button under a message pictures that moment."
            pictures={chat}
            onOpen={(picture) => setViewing(picture.id)}
          />
        </>
      ) : (
        <p className="text-sm text-faint">Opening…</p>
      )}

      {shown ? (
        <PictureView
          picture={shown}
          onClose={() => setViewing(null)}
          onAgain={
            health.pictures && targetOf(shown)
              ? () => {
                  setAsking({ target: targetOf(shown)!, start: draftOf(shown) });
                  setViewing(null);
                }
              : undefined
          }
          onDelete={async () => {
            try {
              await api(`/api/pictures/${shown.id}`, { method: "DELETE" });
              setViewing(null);
              setPictures((at) => at?.filter((picture) => picture.id !== shown.id) ?? at);
            } catch (err) {
              setError(describeError(err));
            }
          }}
          extra={
            shown.chatId ? (
              <Button kind="plain" onClick={() => open({ kind: "chat", id: shown.chatId! })}>
                <MessageSquare size={14} /> Open the chat
              </Button>
            ) : null
          }
        />
      ) : null}

      {asking ? (
        <PictureDialog
          companion={companion}
          target={asking.target}
          start={asking.start}
          onClose={() => setAsking(null)}
          onMade={(picture) => setPictures((at) => [picture, ...(at ?? [])])}
        />
      ) : null}
    </div>
  );
}
