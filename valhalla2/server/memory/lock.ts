// One writer at a time per companion's memory.
//
// Consolidation, cleanup, rebuilding and your own edits on the Memory page all write the same
// files, and some of them wait on the API in between. Each takes its companion's turn here, so
// two never interleave and no change is lost. A failed holder still lets the next one in.

const tails = new Map<string, Promise<unknown>>();

/** Runs `work` once everything queued before it for this companion has finished. */
export function withMemoryLock<T>(companionId: string, work: () => Promise<T> | T): Promise<T> {
  const before = tails.get(companionId) ?? Promise.resolve();
  const mine = before.then(
    () => work(),
    () => work(),
  );
  const tail = mine.catch(() => undefined);
  tails.set(companionId, tail);
  void tail.then(() => {
    if (tails.get(companionId) === tail) tails.delete(companionId);
  });
  return mine;
}

/** Whether anything is writing this companion's memory right now, or queued to. */
export const memoryBusy = (companionId: string): boolean => tails.has(companionId);
