// Keeps the maps and the server in step. Local edits are already in the store; their ops wait in
// one queue for the whole page, each tagged with its map, so switching maps right after an edit
// loses nothing. The queue is sent after a short pause, retried while the network is down, and
// saved in localStorage so a closed tab's changes go out on the next load. The map on screen
// catches up with changes made elsewhere (another tab or device) when the window gets the focus.
// Adapted from Yggdrasil's sync.ts, without its event stream.
import { SignedOutError, signInUrl } from "@axis-suite/heimdall-client/browser";
import {
  FIELD_NAMES,
  USER_HEADER,
  type ChangesResponse,
  type MapData,
  type Op,
  type OpsResponse,
} from "../../shared/protocol.ts";
import type { Guarded, MapStore } from "./store.ts";

export type SyncState =
  | { kind: "saved" }
  | { kind: "saving"; waiting: number }
  | { kind: "offline"; waiting: number }
  | { kind: "signedOut"; waiting: number; loginUrl: string };

/** An op waiting to be saved, and the map it belongs to. */
export interface Entry {
  mapId: string;
  op: Op;
}

/** Sent after this much quiet… */
const FLUSH_IDLE_MS = 300;
/** …or this long after the first queued change, whichever comes first. */
const FLUSH_MAX_MS = 1000;
/** The API takes at most 2,000 ops per request. */
const MAX_BATCH_OPS = 2000;
/** Well under the API's 5 MB body limit. */
const MAX_BATCH_CHARS = 3_000_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** A tab refreshes its saved queue this often; one older than STALE_MS belongs to a closed tab. */
const HEARTBEAT_MS = 5000;
const STALE_MS = 15_000;
const STORAGE_PREFIX = "mimir.queue.";

const NOTHING_GUARDED: ReadonlySet<Guarded> = new Set();

/**
 * Adds an entry to a queue of ops not yet sent. Edits of a node or arrow whose last queued op is
 * its create or an earlier edit are folded into that op.
 */
export function enqueue(queue: Entry[], entry: Entry): void {
  const { op } = entry;
  if (op.op === "update" || op.op === "updateArrow") {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i]!;
      if (q.op.id !== op.id || q.mapId !== entry.mapId) continue;
      if (q.op.op === "create" || q.op.op === "update" || q.op.op === "createArrow" || q.op.op === "updateArrow") {
        const { op: _op, id: _id, ...fields } = op;
        queue[i] = { mapId: q.mapId, op: { ...q.op, ...fields } as Op };
        return;
      }
      break;
    }
  }
  queue.push(entry);
}

/** Takes the next batch off the front of the queue: ops of one map, within the API's limits. */
export function takeBatch(queue: Entry[]): Entry[] {
  const mapId = queue[0]?.mapId;
  let chars = 0;
  let n = 0;
  while (n < queue.length && n < MAX_BATCH_OPS && queue[n]!.mapId === mapId) {
    chars += JSON.stringify(queue[n]!.op).length;
    if (n > 0 && chars > MAX_BATCH_CHARS) break;
    n++;
  }
  return queue.splice(0, n);
}

/** For each node and arrow, what the ops change: a server row must not overwrite those parts yet. */
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
      case "deleteArrow":
      case "restoreArrow":
        set.add("deletedAt");
        break;
      case "createArrow":
        set.add("label").add("deletedAt");
        break;
      case "updateArrow":
        set.add("label");
        break;
    }
  }
  return out;
}

export interface SyncEvents {
  /** Something went wrong that the user should hear about. */
  notice(message: string): void;
  /** The map on screen was loaded again; its undo history may no longer apply. */
  reloaded(): void;
  /** A map was deleted elsewhere: its unsaved changes are dropped. */
  gone(mapId: string): void;
}

/** The map on screen. */
interface Attached {
  mapId: string;
  store: MapStore;
  /** The revision the store matches, apart from local ops. */
  rev: number;
  /** Ops saved as revisions newer than `rev`: a server row older than them must not undo them. */
  acked: { rev: number; ops: Op[] }[];
}

/** A GET refused because the map isn't there (deleted, or never was). */
export class MapGoneError extends Error {}

export class Sync {
  readonly #username: string;
  readonly #events: SyncEvents;
  readonly #storageKey: string;
  readonly #storagePrefix: string;

  #queue: Entry[] = [];
  #inflight: Entry[] | null = null;
  #attached: Attached | null = null;

  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #firstQueuedAt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryDelay = 0;
  #signedOutUrl: string | null = null;
  #fetching = false;
  #fetchAgain = false;

  #state: SyncState = { kind: "saved" };
  #listeners = new Set<() => void>();

  constructor(username: string, events: SyncEvents) {
    this.#username = username;
    this.#events = events;
    this.#storagePrefix = `${STORAGE_PREFIX}${username}.`;
    this.#storageKey = this.#storagePrefix + crypto.randomUUID();
  }

  /** Sends what closed tabs left behind, and keeps watch over the page's lifetime. */
  start(): void {
    this.#adoptSavedQueues();
    window.addEventListener("online", () => {
      this.#retryNow();
      this.refresh();
    });
    window.addEventListener("focus", () => this.refresh());
    window.addEventListener("beforeunload", (e) => {
      if (this.pending > 0) e.preventDefault();
    });
    // A tab being hidden may be closed next: send now rather than after the pause.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.#flush();
      else this.refresh();
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

  /**
   * Loads a map into `store` and makes it the one on screen: changes to it made elsewhere are
   * fetched from now on. Changes to it still waiting to be saved are applied on top. Throws
   * MapGoneError if there is no such map.
   */
  async open(mapId: string, store: MapStore): Promise<MapData> {
    const data = await this.#get<MapData>(`/api/maps/${mapId}`);
    store.batch(() => {
      store.load(data.nodes, data.arrows);
      store.applyAll(this.#pendingOps(mapId));
    });
    this.#attached = { mapId, store, rev: data.rev, acked: [] };
    return data;
  }

  /** The map left the screen. */
  close(store: MapStore): void {
    if (this.#attached?.store === store) this.#attached = null;
  }

  /** Queues ops of map `mapId`, already applied to its store. */
  push(mapId: string, ops: readonly Op[]): void {
    if (ops.length === 0) return;
    for (const op of ops) enqueue(this.#queue, { mapId, op });
    this.#save();
    this.#schedule();
    this.#update();
  }

  /** Drops the unsent changes of a map that is being deleted. */
  forget(mapId: string): void {
    this.#queue = this.#queue.filter((e) => e.mapId !== mapId);
    this.#save();
    this.#update();
  }

  /** Fetches what changed elsewhere in the map on screen. */
  refresh(): void {
    if (this.#attached && !this.#signedOutUrl) void this.#fetchChanges();
  }

  /** After signing in again: sends what waited, and catches up. */
  resume(): void {
    this.#signedOutUrl = null;
    this.#update();
    void this.#flush();
    this.refresh();
  }

  #pendingOps(mapId: string): Op[] {
    return [...(this.#inflight ?? []), ...this.#queue].filter((e) => e.mapId === mapId).map((e) => e.op);
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
    const mapId = batch[0]!.mapId;
    const ops = batch.map((e) => e.op);
    this.#inflight = batch;
    this.#update();

    let res: Response;
    try {
      res = await fetch(`/api/maps/${mapId}/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [USER_HEADER]: this.#username },
        body: JSON.stringify({ ops }),
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
    const attached = this.#attached?.mapId === mapId ? this.#attached : null;
    if (res.status === 404) {
      // The map was deleted (in another tab or device): nothing of it can be saved any more.
      this.#queue = this.#queue.filter((e) => e.mapId !== mapId);
      this.#save();
      this.#events.gone(mapId);
    } else if (!res.ok) {
      // Refused as a whole, so sending it again won't help.
      console.error(`POST /api/maps/${mapId}/ops:`, res.status, await res.text().catch(() => ""));
      this.#save();
      this.#events.notice("Some changes could not be saved.");
      if (attached) await this.#reload(attached);
    } else {
      const result = (await res.json()) as OpsResponse;
      this.#save();
      if (result.rejected.length > 0) {
        console.warn("Rejected ops:", result.rejected);
        this.#events.notice("Another change got there first, so some changes were not saved.");
        if (attached) await this.#reload(attached);
      } else if (attached && result.rev !== null) {
        if (result.rev === attached.rev + 1) attached.rev = result.rev;
        else {
          // Changes from elsewhere came in between: fetch them.
          attached.acked.push({ rev: result.rev, ops });
          void this.#fetchChanges();
        }
      }
    }
    this.#update();
    // Anything queued meanwhile goes now: the pause it waited for has passed.
    if (this.#queue.length > 0) void this.#flush();
  }

  /** Puts a batch that wasn't saved back in front of the queue. */
  #requeue(batch: Entry[]): void {
    this.#inflight = null;
    this.#queue = [...batch, ...this.#queue];
    this.#save();
  }

  #sendFailed(batch: Entry[]): void {
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

  async #fetchChanges(): Promise<void> {
    if (this.#fetching) {
      this.#fetchAgain = true;
      return;
    }
    const attached = this.#attached;
    if (!attached) return;
    this.#fetching = true;
    try {
      const changes = await this.#get<ChangesResponse>(`/api/maps/${attached.mapId}/changes?since=${attached.rev}`);
      if (this.#attached !== attached) return; // another map is on screen now
      if (changes.reset) {
        await this.#reload(attached);
      } else {
        const guarded = guardedParts([
          ...this.#pendingOps(attached.mapId),
          ...attached.acked.filter((a) => a.rev > changes.rev).flatMap((a) => a.ops),
        ]);
        attached.store.batch(() => {
          for (const node of changes.nodes) {
            attached.store.applyRemoteNode(node, guarded.get(node.id) ?? NOTHING_GUARDED);
          }
          for (const arrow of changes.arrows) {
            attached.store.applyRemoteArrow(arrow, guarded.get(arrow.id) ?? NOTHING_GUARDED);
          }
        });
        attached.rev = Math.max(attached.rev, changes.rev);
        attached.acked = attached.acked.filter((a) => a.rev > attached.rev);
      }
    } catch (err) {
      if (err instanceof SignedOutError) this.#signedOut(err.loginUrl);
      else if (err instanceof MapGoneError) this.#events.gone(attached.mapId);
      else console.warn("Fetching changes failed:", err);
    } finally {
      this.#fetching = false;
    }
    if (this.#fetchAgain) {
      this.#fetchAgain = false;
      void this.#fetchChanges();
    }
  }

  /** Loads the map on screen again, then reapplies its changes not saved yet. */
  async #reload(attached: Attached): Promise<void> {
    try {
      const data = await this.#get<MapData>(`/api/maps/${attached.mapId}`);
      if (this.#attached !== attached) return;
      attached.store.batch(() => {
        attached.store.load(data.nodes, data.arrows);
        attached.store.applyAll(this.#pendingOps(attached.mapId));
      });
      attached.rev = data.rev;
      attached.acked = [];
      this.#events.reloaded();
    } catch (err) {
      if (err instanceof SignedOutError) this.#signedOut(err.loginUrl);
      else if (err instanceof MapGoneError) this.#events.gone(attached.mapId);
      else console.error("Reloading the map failed:", err);
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
    if (res.status === 404) throw new MapGoneError(`GET ${path} answered 404`);
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Someone else signed in, in another tab. This page shows the previous user's maps, so it
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
    const entries = [...(this.#inflight ?? []), ...this.#queue];
    try {
      if (entries.length > 0) localStorage.setItem(this.#storageKey, JSON.stringify({ at, entries }));
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
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; entries: Entry[] } | null;
        if (saved && Date.now() - saved.at < STALE_MS) continue; // that tab is still open
        localStorage.removeItem(key);
        if (!saved?.entries?.length) continue;
        const byMap = new Map<string, Op[]>();
        for (const e of saved.entries) byMap.set(e.mapId, [...(byMap.get(e.mapId) ?? []), e.op]);
        for (const [mapId, ops] of byMap) {
          if (this.#attached?.mapId === mapId) this.#attached.store.applyAll(ops);
          this.push(mapId, ops);
        }
      } catch (err) {
        console.warn("Skipping a saved queue:", err);
      }
    }
  }
}
