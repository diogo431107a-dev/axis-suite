import { initials } from "../../shared/contact.ts";
import { avatarColor } from "../colors.ts";

interface AvatarProps {
  contact: { id: string; firstName: string; lastName: string; nickname: string; company: string };
  size?: "sm" | "lg";
}

/** A round badge with the contact's initials, in a colour of its own. */
export function Avatar({ contact, size = "sm" }: AvatarProps) {
  const box = size === "lg" ? "h-16 w-16 text-xl" : "h-9 w-9 text-sm";
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${box} ${avatarColor(contact.id)}`}
    >
      {initials(contact)}
    </span>
  );
}
