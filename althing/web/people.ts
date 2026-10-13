import type { Person } from "../shared/protocol.ts";

/** What the page shows for someone who was removed from the suite. */
export const DELETED_NAME = "deleted user";

/** Someone's name on the page: their nickname, or "deleted user". */
export function nameOf(person: Person | undefined): string {
  return person?.nickname ?? DELETED_NAME;
}
