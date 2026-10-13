import { UserX } from "lucide-react";
import type { Person } from "../shared/protocol.ts";

interface AvatarProps {
  /** undefined: a deleted user */
  person: Person | undefined;
  /** Tailwind size classes, e.g. "h-9 w-9" */
  size?: string;
  /** a green dot in the corner */
  online?: boolean;
}

/** Someone's profile picture, round. */
export function Avatar({ person, size = "h-9 w-9", online }: AvatarProps) {
  return (
    <span className={`relative inline-block shrink-0 ${size}`}>
      {person ? (
        <img
          src={`/avatars/${person.avatar}`}
          alt=""
          draggable={false}
          className="h-full w-full rounded-full bg-stone-200 object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-stone-200 text-stone-400">
          <UserX className="h-1/2 w-1/2" aria-hidden />
        </span>
      )}
      {online && (
        <span
          className="absolute right-0 bottom-0 block h-1/4 min-h-2 w-1/4 min-w-2 rounded-full bg-emerald-500 ring-2 ring-white"
          aria-hidden
        />
      )}
    </span>
  );
}
