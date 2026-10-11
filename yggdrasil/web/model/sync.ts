// Keeps the store and the server in step. Local edits are already in the store; their ops wait
// in a queue that is sent after a short pause, retried while the network is down, and saved in
// localStorage so a closed tab's changes go out on the next load. Changes from other tabs and
// devices arrive as "rev" events, then GET /api/changes.
import { SignedOutError, fetchMe, signInUrl } from "@axis-suite/heimdall-client/browser";
import {
  FIELD_NAMES,
  USER_HEADER,
  type ChangesResponse,
  type Op,
  type OpsResponse,
  type RevEvent,
  type TreeResponse,
} from "../../shared/protocol.ts";
import type { Guarded, Store } from "./store.ts";

export type SyncState =
  | { kind: "saved" }
  | { kind: "saving"; waiting: number }
  | { kind: "offline"; waiting: number }
  | { kind: "signedOut"; waiting: number; loginUrl: string };

/** Sent after this much quiet… */
const FLUSH_IDLE_MS = 300;
/** …or this long after the first queued change, whichever comes first. */
const FLUSH_MAX_MS = 1000;
const MAX_BATCH_OPS = 2000;
/** Well under the API's 10 MB body limit. */
const MAX_BATCH_CHARS = 4_000_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** A tab refreshes its saved queue this often; one older than STALE_MS belongs to a closed tab. */
const HEARTBEAT_MS = 5000;
const STALE_MS = 15_000;
const STORAGE_PREFIX = "yggdrasil.queue.";

const NOTHING_GUARDED: ReadonlySet<Guarded> = new Set();

/**
 * Adds op to a queue of ops not yet sent. Edits of a node whose last queued op is a create or
 * an update are folded into that op, so typing a sentence sends one op, not one per key.
 */
export function enqueue(queue: Op[], op: Op): void {
  if (op.op === "update") {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i]!;
      if (q.id !== op.id) continue;
      if (q.op === "create" || q.op === "update") {
        const { op: _op, id: _id, ...fields } = op;
        queue[i] = { ...q, ...fields };
        return;
      }
      break;
    }
  }
  queue.push(op);
}

/** Takes the next batch off the front of the queue. */
export function takeBatch(queue: Op[]): Op[] {
  let chars = 0;
  let n = 0;
  while (n < queue.length && n < MAX_BATCH_OPS) {
    chars += JSON.stringify(queue[n]).length;
    if (n > 0 && chars > MAX_BATCH_CHARS) break;
    n++;
  }
  return queue.splice(0, n);
}

/** For each node, what the ops change: a server row must not overwrite those parts yet. */
export function guardedParts(ops: Iterable<Op>): Map<string, Set<Guarded>> {
  const out = new Map<string, Set<Guarded>>();
  for (const op of ops) {
    let set = out.get(op.id);
    if (!set) out.set(op.id, (set = new Set()));
    switch (op.op) {
      case "create":
        set.add("place").add("deletedAt");
        for (const f of FIELD_NAMES) set.add(f);
        break;
      case "update":
        for (const f of FIELD_NAMES) if (op[f] !== undefined) set.add(f);
        break;
      case "move":
        set.add("place");
        break;
      case "delete":
      case "restore":
        set.add("deletedAt");
        break;
    }
  }
  return out;
}

export interface SyncEvents {
  /** Something went wrong that the user should hear about. */
  notice(message: string): void;
  /** The store was reloaded from the server; local history may no longer apply. */
  reloaded(): void;
}

export class Sync {
  /** Identifies this tab in the event stream. */
  readonly clientId = crypto.randomUUID();
  readonly #store: Store;
  readonly #username: string;
  readonly #events: SyncEvents;
  readonly #storageKey: string;
  readonly #storagePrefix: string;

  #queue: Op[] = [];
  #inflight: Op[] | null = null;
  /** The revision the store matches, apart from local ops. */
  #rev = 0;
  /** The newest revision announced to this tab. */
  #latestRev = 0;
  /** Revisions saved by this tab, not yet passed by #rev. */
  #ownRevs = new Set<number>();
  /** Ops saved as revisions newer than #rev: a server row older than them must not undo them. */
  #acked: { rev: number; ops: Op[] }[] = [];

  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #firstQueuedAt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryDelay = 0;
  #signedOutUrl: string | null = null;
  #fetching = false;
  #fetchAgain = false;
  #source: EventSource | null = null;
  #sourceRetry = RETRY_MIN_MS;
  #sourceTimer: ReturnType<typeof setTimeout> | undefined;

  #state: SyncState = { kind: "saved" };
  #listeners = new Set<() => void>();

  constructor(store: Store, username: string, events: SyncEvents) {
    this.#store = store;
    this.#username = username;
    this.#events = events;
    this.#storagePrefix = `${STORAGE_PREFIX}${username}.`;
    this.#storageKey = this.#storagePrefix + this.clientId;
  }

  /** Loads the tree, sends what closed tabs left behind, and starts listening for changes. */
  async start(): Promise<void> {
    const tree = await this.#get<TreeResponse>("/api/tree");
    this.#store.load(tree.nodes);
    this.#rev = this.#latestRev = tree.rev;
    this.#adoptSavedQueues();

    window.addEventListener("online", () => this.#retryNow());
    window.addEventListener("beforeunload", (e) => {
      if (this.pending > 0) e.preventDefault();
    });
    // A tab being hidden may be closed next: send now rather than after the pause.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.#flush();
    });
    // Leaving the page: whatever is still unsaved is for the next tab to send, straight away.
    window.addEventListener("pagehide", () => {
      if (this.pending > 0) this.#save(0);
    });
    setInterval(() => {
      if (this.pending > 0) this.#save();
      // A tab closed (or reloaded) with unsent changes: they go out from here.
      this.#adoptSavedQueues();
    }, HEARTBEAT_MS);
    this.#listen();
  }

  /** Ops waiting to be saved, sent or not. */
  get pending(): number {
    return this.#queue.length + (this.#inflight?.length ?? 0);
  }

  get state(): SyncState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Queues ops already applied to the store. */
  push(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    for (const op of ops) enqueue(this.#queue, op);
    this.#save();
    this.#schedule();
    this.#update();
  }

  /** After signing in again: sends what waited, and catches up. */
  resume(): void {
    this.#signedOutUrl = null;
    this.#update();
    void this.#flush();
    if (!this.#source) this.#listen();
    else void this.#fetchChanges();
  }

  // ---- Sending ------------------------------------------------------------------------------

  #schedule(): void {
    if (this.#inflight || this.#signedOutUrl || this.#retryTimer || this.#queue.length === 0) return;
    const now = Date.now();
    if (this.#flushTimer === undefined) this.#firstQueuedAt = now;
    clearTimeout(this.#flushTimer);
    const delay = Math.max(0, Math.min(FLUSH_IDLE_MS, this.#firstQueuedAt + FLUSH_MAX_MS - now));
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      void this.#flush();
    }, delay);
  }

  async #flush(): Promise<void> {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (this.#inflight || this.#signedOutUrl || this.#queue.length === 0) return;
    const batch = takeBatch(this.#queue);
    this.#inflight = batch;
    this.#update();

    let res: Response;
    try {
      res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json", [USER_HEADER]: this.#username },
        body: JSON.stringify({ clientId: this.clientId, ops: batch }),
      });
    } catch {
      return this.#sendFailed(batch);
    }
    if (res.status === 401) {
      const { loginUrl } = (await res.json().catch(() => ({}))) as { loginUrl?: string };
      this.#requeue(batch);
      return loginUrl ? this.#signedOut(loginUrl) : this.#sendFailed([]);
    }
    if (res.status === 409) {
      this.#requeue(batch);
      return this.#otherUser();
    }
    if (res.status >= 500 || res.status === 408 || res.status === 429) return this.#sendFailed(batch);

    this.#inflight = null;
    this.#retryDelay = 0;
    if (!res.ok) {
      // Refused as a whole, so sending it again won't help.
      console.error("POST /api/ops:", res.status, await res.text().catch(() => ""));
      this.#save();
      this.#events.notice("Some changes could not be saved. The outline was reloaded.");
      await this.#reload();
    } else {
      const result = (await res.json()) as OpsResponse;
      this.#save();
      if (result.rev !== null) {
        this.#ownRevs.add(result.rev);
        this.#acked.push({ rev: result.rev, ops: batch });
        this.#latestRev = Math.max(this.#latestRev, result.rev);
      }
      if (result.rejected.length > 0) {
        console.warn("Rejected ops:", result.rejected);
        this.#events.notice("Another change got there first. The outline was reloaded.");
        await this.#reload();
      } else {
        this.#advance();
      }
    }
    this.#update();
    // Anything queued meanwhile goes now: the pause it waited for has passed.
    if (this.#queue.length > 0) void this.#flush();
  }

  /** Puts a batch that wasn't saved back in front of the queue. */
  #requeue(batch: Op[]): void {
    this.#inflight = null;
    this.#queue = [...batch, ...this.#queue];
    this.#save();
  }

  #sendFailed(batch: Op[]): void {
    if (batch.length > 0) this.#requeue(batch);
    this.#inflight = null;
    this.#retryDelay = Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, this.#retryDelay * 2));
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#update();
      void this.#flush();
    }, this.#retryDelay);
    this.#update();
  }

  #retryNow(): void {
    if (this.#retryTimer === undefined) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#retryDelay = 0;
    this.#update();
    void this.#flush();
  }

  #signedOut(loginUrl: string): void {
    this.#signedOutUrl = signInUrl(loginUrl);
    this.#update();
  }

  // ---- Receiving ----------------------------------------------------------------------------

  #listen(): void {
    clearTimeout(this.#sourceTimer);
    const source = new EventSource(`/api/events?user=${encodeURIComponent(this.#username)}`);
    this.#source = source;
    source.addEventListener("open", () => {
      this.#sourceRetry = RETRY_MIN_MS;
      // Events may have been missed while disconnected.
      void this.#fetchChanges();
    });
    source.addEventListener("rev", (e) => {
      const event = JSON.parse((e as MessageEvent<string>).data) as RevEvent;
      this.#latestRev = Math.max(this.#latestRev, event.rev);
      // This tab's own batch: its answer is on the way and says the same.
      if (event.clientId === this.clientId && this.#inflight) return;
      this.#advance();
    });
    source.addEventListener("error", () => {
      // CONNECTING: the browser retries by itself. CLOSED: the server refused the stream.
      if (source.readyState !== EventSource.CLOSED) return;
      source.close();
      this.#source = null;
      const retry = () => {
        this.#sourceTimer = setTimeout(() => this.#listen(), this.#sourceRetry);
        this.#sourceRetry = Math.min(RETRY_MAX_MS, this.#sourceRetry * 2);
      };
      fetchMe()
        .then((me) => (me.username === this.#username ? retry() : this.#otherUser()))
        .catch((err) => (err instanceof SignedOutError ? this.#signedOut(err.loginUrl) : retry()));
    });
  }

  /** Moves #rev past this tab's own revisions, and fetches whatever else is newer. */
  #advance(): void {
    while (this.#ownRevs.has(this.#rev + 1)) {
      this.#ownRevs.delete(this.#rev + 1);
      this.#rev++;
    }
    this.#acked = this.#acked.filter((a) => a.rev > this.#rev);
    if (this.#latestRev > this.#rev) void this.#fetchChanges();
  }

  async #fetchChanges(): Promise<void> {
    if (this.#fetching) {
      this.#fetchAgain = true;
      return;
    }
    this.#fetching = true;
    let failed = false;
    try {
      const changes = await this.#get<ChangesResponse>(`/api/changes?since=${this.#rev}`);
      if (changes.reset) {
        await this.#reload();
      } else {
        const guarded = guardedParts([
          ...(this.#inflight ?? []),
          ...this.#queue,
          ...this.#acked.filter((a) => a.rev > changes.rev).flatMap((a) => a.ops),
        ]);
        this.#store.batch(() => {
          for (const node of changes.nodes) this.#store.applyRemote(node, guarded.get(node.id) ?? NOTHING_GUARDED);
        });
        this.#rev = Math.max(this.#rev, changes.rev);
        this.#latestRev = Math.max(this.#latestRev, changes.rev);
        for (const rev of this.#ownRevs) if (rev <= this.#rev) this.#ownRevs.delete(rev);
      }
    } catch (err) {
      failed = true;
      if (err instanceof SignedOutError) this.#signedOut(err.loginUrl);
      else setTimeout(() => this.#advance(), RETRY_MIN_MS * 2);
    } finally {
      this.#fetching = false;
    }
    if (failed) {
      this.#fetchAgain = false;
    } else if (this.#fetchAgain) {
      this.#fetchAgain = false;
      void this.#fetchChanges();
    } else {
      this.#advance();
    }
  }

  /** Loads the whole tree again, then reapplies the changes not saved yet. */
  async #reload(): Promise<void> {
    try {
      const tree = await this.#get<TreeResponse>("/api/tree");
      this.#store.batch(() => {
        this.#store.load(tree.nodes);
        this.#store.applyAll([...(this.#inflight ?? []), ...this.#queue]);
      });
      this.#rev = tree.rev;
      this.#latestRev = Math.max(this.#latestRev, tree.rev);
      this.#ownRevs.clear();
      this.#acked = [];
      this.#events.reloaded();
    } catch (err) {
      if (err instanceof SignedOutError) this.#signedOut(err.loginUrl);
      else console.error("Reloading the tree failed:", err);
    }
  }

  // ---- Requests -----------------------------------------------------------------------------

  /** A GET from the API, on behalf of this page's user. */
  async #get<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { [USER_HEADER]: this.#username } });
    if (res.status === 401) {
      const { loginUrl } = (await res.json().catch(() => ({}))) as { loginUrl?: string };
      if (loginUrl) throw new SignedOutError(loginUrl);
    }
    if (res.status === 409) this.#otherUser();
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Someone else signed in, in another tab. This page shows the previous user's tree, so it
   * starts over as the new user. Unsaved changes stay in localStorage for the previous user.
   */
  #otherUser(): void {
    this.#save(0);
    location.reload();
  }

  // ---- State and storage --------------------------------------------------------------------

  #update(): void {
    const waiting = this.pending;
    const next: SyncState = this.#signedOutUrl
      ? { kind: "signedOut", waiting, loginUrl: this.#signedOutUrl }
      : this.#retryTimer !== undefined
        ? { kind: "offline", waiting }
        : waiting > 0
          ? { kind: "saving", waiting }
          : { kind: "saved" };
    if (JSON.stringify(next) === JSON.stringify(this.#state)) return;
    this.#state = next;
    for (const l of this.#listeners) l();
  }

  /** Saves the unsent ops, stamped with `at`: a stamp older than STALE_MS marks them as abandoned. */
  #save(at = Date.now()): void {
    const ops = [...(this.#inflight ?? []), ...this.#queue];
    try {
      if (ops.length > 0) localStorage.setItem(this.#storageKey, JSON.stringify({ at, ops }));
      else localStorage.removeItem(this.#storageKey);
    } catch (err) {
      // Full, or blocked: the queue still lives in memory.
      console.warn("Could not save the queue of changes:", err);
    }
  }

  /** Queues the changes of tabs that closed before sending them. */
  #adoptSavedQueues(): void {
    let keys: string[];
    try {
      keys = Object.keys(localStorage).filter((k) => k.startsWith(this.#storagePrefix) && k !== this.#storageKey);
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; ops: Op[] } | null;
        if (saved && Date.now() - saved.at < STALE_MS) continue; // that tab is still open
        localStorage.removeItem(key);
        if (!saved?.ops.length) continue;
        this.#store.applyAll(saved.ops);
        this.push(saved.ops);
      } catch (err) {
        console.warn("Skipping a saved queue:", err);
      }
    }
  }
}
