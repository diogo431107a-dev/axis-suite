// Saves the page's changes in order, one batch at a time. The page has already changed by the time
// a change gets here. If the server can't be reached the changes wait and are sent again; if it
// refuses one, the page's sky is wrong and gets reloaded.
import { SignedOutError, signInUrl } from "@axis-suite/heimdall-client/browser";
import { LIMITS, type Op, type OpsRequest, type OpsResult } from "../shared/protocol.ts";
import { ApiFailure, api, describeError } from "./api.ts";

/** Typing is saved this long after the last key. */
const TEXT_DELAY = 500;
/** Other changes wait only long enough to go together with what comes right after them. */
const CHANGE_DELAY = 50;
const RETRY_MIN = 1_000;
const RETRY_MAX = 30_000;
/** Browsers refuse a keepalive request larger than 64 KiB. */
const KEEPALIVE_MAX = 60_000;

export type SyncState = "saved" | "unsaved" | "signed-out";

export interface SyncEvents {
  /** The server accepted a batch, and the sky is now at this revision. */
  saved(rev: number): void;
  /** Whether everything is saved, for a notice on the page. */
  state(state: SyncState): void;
  /** The server refused a change. Whatever was waiting has been dropped. */
  refused(message: string): void;
  /** The session ended. Sending stops until resume(). Holds the sign-in URL. */
  signedOut(url: string): void;
}

export class Sync {
  private readonly events: SyncEvents;
  private queue: Op[] = [];
  /** The batch being sent, kept with its id so a retry can't apply it twice. */
  private sending: OpsRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN;
  private stopped = false;
  private current: SyncState = "saved";

  constructor(events: SyncEvents) {
    this.events = events;
  }

  /** True when every change has been saved. */
  get idle(): boolean {
    return this.queue.length === 0 && this.sending === null;
  }

  /** Queues a change. Typing into the same star's fields collapses into one op. */
  push(op: Op): void {
    const last = this.queue.at(-1);
    if (op.op === "updateStar") {
      if (last?.op === "updateStar" && last.id === op.id) Object.assign(last, op);
      else this.queue.push({ ...op });
      this.schedule(TEXT_DELAY);
    } else {
      this.queue.push(op);
      this.schedule(CHANGE_DELAY);
    }
  }

  /** Sends what is waiting now instead of after its delay. */
  flush(keepalive = false): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    void this.send(keepalive);
  }

  /** After signing in again: carry on sending. */
  resume(): void {
    this.stopped = false;
    this.setState(this.idle ? "saved" : "unsaved");
    if (this.sending) void this.attempt(this.sending, false);
    else this.flush();
  }

  private schedule(delay: number): void {
    this.setState("unsaved");
    if (this.sending || this.stopped) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send(false);
    }, delay);
  }

  private setState(state: SyncState): void {
    if (state === this.current) return;
    this.current = state;
    this.events.state(state);
  }

  private async send(keepalive: boolean): Promise<void> {
    if (this.sending || this.stopped) return;
    if (this.queue.length === 0) {
      this.setState("saved");
      return;
    }
    const batch: OpsRequest = { batch: crypto.randomUUID(), ops: this.queue.splice(0, LIMITS.opsPerBatch) };
    this.sending = batch;
    await this.attempt(batch, keepalive);
  }

  private async attempt(batch: OpsRequest, keepalive: boolean): Promise<void> {
    try {
      const small = keepalive && JSON.stringify(batch).length < KEEPALIVE_MAX;
      const { rev } = await api<OpsResult>("/api/sky/ops", { method: "POST", body: batch, keepalive: small });
      this.sending = null;
      this.retryDelay = RETRY_MIN;
      this.events.saved(rev);
      if (this.queue.length > 0) void this.send(false);
      else this.setState("saved");
    } catch (err) {
      if (err instanceof SignedOutError) {
        // The batch stays in `sending`, for resume().
        this.stopped = true;
        this.setState("signed-out");
        this.events.signedOut(signInUrl(err.loginUrl));
      } else if (err instanceof ApiFailure && err.status >= 400 && err.status < 500) {
        this.sending = null;
        this.queue = [];
        this.setState("saved");
        this.events.refused(err.message);
      } else {
        // Not reached, or the server is having trouble: nothing is lost, so try again.
        if (!(err instanceof ApiFailure)) console.error(describeError(err));
        this.setState("unsaved");
        setTimeout(() => void this.attempt(batch, false), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX);
      }
    }
  }
}
