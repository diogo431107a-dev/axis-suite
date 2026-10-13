import { MessageSquare } from "lucide-react";
import type { Person } from "../../shared/protocol.ts";
import { Avatar } from "../Avatar.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { primaryButton } from "../ui/buttons.ts";
import { closeDialog } from "../ui/closeDialog.ts";

interface PersonDialogProps {
  person: Person;
  online: boolean;
  isMe: boolean;
  onMessage: () => void;
  onEditProfile: () => void;
  onClose: () => void;
}

/** Someone's profile card. */
export function PersonDialog({ person, online, isMe, onMessage, onEditProfile, onClose }: PersonDialogProps) {
  return (
    <Dialog title={person.nickname} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar person={person} size="h-32 w-32" />
        <p className="mt-3 text-lg font-semibold text-stone-800">{person.nickname}</p>
        <p className={`text-sm ${online ? "text-emerald-700" : "text-stone-400"}`}>{online ? "Online" : "Offline"}</p>
        {person.about ? (
          <p className="mt-4 w-full rounded-lg bg-stone-50 p-3 text-left text-sm whitespace-pre-wrap break-words text-stone-700">
            {person.about}
          </p>
        ) : (
          <p className="mt-4 text-sm text-stone-400">Nothing about them yet.</p>
        )}
        <div className="mt-5">
          {isMe ? (
            <button
              type="button"
              className={primaryButton}
              onClick={(e) => {
                closeDialog(e.currentTarget);
                onEditProfile();
              }}
            >
              Edit my profile
            </button>
          ) : (
            <button
              type="button"
              className={primaryButton}
              data-autofocus
              onClick={(e) => {
                closeDialog(e.currentTarget);
                onMessage();
              }}
            >
              <MessageSquare className="h-4 w-4" aria-hidden />
              Message
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
