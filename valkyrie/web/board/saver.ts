// Saves moves one at a time, in the order things were first moved. A card moved again before its
// turn is saved once, where it is by then: `send` works out its place when the request goes out,
// so ten quick moves make one or two requests. If a save fails, whatever waits is dropped: the
// page then reloads the board from the server.

export interface Saver {
  /** Something (a card, a list) changed place: save it when its turn comes. */
  touch(key: string): void;
  /** Whether something waits to be saved, or is being saved. */
  pending(key: string): boolean;
  /** Whether nothing waits. */
  idle(): boolean;
  /** Drops whatever waits (the board is being reloaded). */
  clear(): void;
}

export function createSaver(
  send: (key: string) => Promise<unknown>,
  onError: (err: unknown) => void,
  onIdle: () => void = () => {},
): Saver {
  const queue: string[] = [];
  let inFlight: string | null = null;

  function pump(): void {
    if (inFlight !== null) return;
    const key = queue.shift();
    if (key === undefined) return void onIdle();
    inFlight = key;
    send(key).then(
      () => {
        inFlight = null;
        pump();
      },
      (err: unknown) => {
        inFlight = null;
        queue.length = 0;
        onError(err);
        onIdle();
      },
    );
  }

  return {
    touch(key) {
      if (!queue.includes(key)) queue.push(key);
      pump();
    },
    pending: (key) => inFlight === key || queue.includes(key),
    idle: () => inFlight === null && queue.length === 0,
    clear() {
      queue.length = 0;
    },
  };
}
