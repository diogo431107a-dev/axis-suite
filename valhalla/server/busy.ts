// One reply at a time per conversation. A second send while one is being written (another tab,
// a double click) would put two of your turns in a row into the log, which the API refuses.
import { StoreError } from "./errors.ts";

export function createBusy() {
  const writing = new Set<string>();
  return {
    /** Marks this person's conversation as being written to, or refuses if it already is. */
    claim(username: string, conversationId: string): () => void {
      const key = `${username}/${conversationId}`;
      if (writing.has(key)) {
        throw new StoreError(
          409,
          "A reply in this conversation is still being written. Wait for it to finish.",
          "busy",
        );
      }
      writing.add(key);
      return () => writing.delete(key);
    },
  };
}
