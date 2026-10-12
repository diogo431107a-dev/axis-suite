// Saving pages. Each day being written (or still waiting to be saved) is a doc here, outside
// React, so leaving a day never stops its save. A doc goes to the server 1 s after typing stops
// (and at least every 10 s while it doesn't), and at once on a mood, Ctrl+S, leaving the day or
// hiding the tab. Until the server has it, the text is also in localStorage: a lost connection, a
// closed tab or an ended session loses nothing, and the next visit sends it.
//
// Every save names the revision it edited. If the page changed elsewhere since, the server says
// so (409) and the doc stops saving until the writer picks: their version, the other one, or both.
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { Mood, Page, PageSaved, PageWrite } from "../../shared/protocol.ts";
import { ApiFailure } from "../api.ts";

export interface PageApi {
  get(journalId: string, date: string): Promise<Page>;
  put(journalId: string, date: string, body: PageWrite, keepalive?: boolean): Promise<PageSaved>;
}

interface Content {
  text: string;
  mood: Mood | null;
}

/** One day as the page shows it. A new object whenever something changes. */
export interface DayState {
  key: string;
  journalId: string;
  date: string;
  /** false until the page has come from the server */
  loaded: boolean;
  text: string;
  mood: Mood | null;
  /** changes the server doesn't have yet */
  dirty: boolean;
  saving: boolean;
  /** The page changed elsewhere since it was opened: this is what the server has now. */
  theirs: Content | null;
  /** why the server won't take this page (e.g. its journal is gone) */
  problem: string | null;
  /** when the server's version was saved */
  updatedAt: string | null;
}

export type SyncStatus =
  | { kind: "saved" | "saving" | "offline" | "signed-out" }
  | { kind: "conflict" | "problem"; journalId: string; date: string };

interface Doc {
  key: string;
  journalId: string;
  date: string;
  /** what the server has (null until loaded) */
  base: (Content & { rev: number }) | null;
  local: Content;
  updatedAt: string | null;
  loading: boolean;
  inflight: boolean;
  conflict: boolean;
  problem: string | null;
  /** days on screen showing it; at 0, a doc with nothing left to do is dropped */
  viewers: number;
  quietTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  draftTimer: ReturnType<typeof setTimeout> | null;
  state: DayState;
}

interface Draft extends Content {
  /** the rev the text was written on */
  baseRev: number;
  at: number;
}

export const QUIET_MS = 1000;
export const MAX_WAIT_MS = 10_000;
const DRAFT_MS = 300;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
// Browsers send at most 64 KB of keepalive requests while a page closes.
const KEEPALIVE_CHARS = 60_000;

export const pageKey = (journalId: string, date: string) => `${journalId}/${date}`;

const isDirty = (doc: Doc) =>
  doc.base !== null && (doc.local.text !== doc.base.text || doc.local.mood !== doc.base.mood);

const sameContent = (a: Content, b: Content) => a.text === b.text && a.mood === b.mood;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface SyncOptions {
  api: PageApi;
  user: string;
  storage?: Storage | null;
  /** tells the user's other tabs about saves; null for none */
  channel?: BroadcastChannel | null;
}

export class PageSync {
  private readonly docs = new Map<string, Doc>();
  private readonly listeners = new Set<() => void>();
  private readonly api: PageApi;
  private readonly draftPrefix: string;
  private readonly storage: Storage | null;
  private readonly channel: BroadcastChannel | null;
  private offline = false;
  private signedOut = false;
  private retryDelay = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private currentStatus: SyncStatus = { kind: "saved" };

  /** Called once when a request finds the session ended; resume() carries on after signing in. */
  onSignedOut: ((err: SignedOutError) => void) | null = null;
  /** Called after each save the server accepted (calendars and tags may have changed). */
  onSaved: ((journalId: string, date: string) => void) | null = null;

  constructor(options: SyncOptions) {
    this.api = options.api;
    this.draftPrefix = `papyrus.draft.${options.user}.`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.channel =
      options.channel !== undefined
        ? options.channel
        : typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(`papyrus.${options.user}`);
    // Another tab saved a page: show it here too (unless this tab is changing it).
    this.channel?.addEventListener("message", (e: MessageEvent<{ journalId?: unknown; date?: unknown }>) => {
      const { journalId, date } = e.data ?? {};
      if (typeof journalId !== "string" || typeof date !== "string") return;
      this.refresh(pageKey(journalId, date));
      this.onSaved?.(journalId, date);
    });
  }

  // ── For React (useSyncExternalStore) ─────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  day = (key: string): DayState | undefined => this.docs.get(key)?.state;

  status = (): SyncStatus => this.currentStatus;

  // ── What the page does ───────────────────────────────────────────────────────────────────────

  /** A day comes on screen: loads its page (once). Pair with close(). */
  open(journalId: string, date: string): string {
    const key = pageKey(journalId, date);
    const doc = this.docs.get(key) ?? this.create(journalId, date);
    doc.viewers++;
    if (!doc.base && !doc.loading) void this.load(doc);
    return key;
  }

  /** A day leaves the screen. Its save, if any, carries on. */
  close(key: string): void {
    const doc = this.docs.get(key);
    if (!doc) return;
    doc.viewers--;
    void this.save(doc);
    this.dropIfDone(doc);
  }

  /** The writer changed the text or the mood. A mood is saved at once, text after a pause. */
  edit(key: string, change: Partial<Content>): void {
    const doc = this.docs.get(key);
    if (!doc?.base) return;
    doc.local = { ...doc.local, ...change };
    this.saveDraftSoon(doc);
    this.schedule(doc, change.mood !== undefined ? 0 : QUIET_MS);
    this.changed(doc);
  }

  /** Saves now (Ctrl+S, leaving the tab): one day, or every day with changes. */
  flush(key?: string): void {
    for (const doc of key ? [this.docs.get(key)].filter((d) => d !== undefined) : this.docs.values()) {
      void this.save(doc);
    }
  }

  /** After a conflict: keep this tab's text, take the other version, or keep both (theirs first). */
  resolve(key: string, choice: "mine" | "theirs" | "both"): void {
    const doc = this.docs.get(key);
    if (!doc?.base || !doc.conflict) return;
    doc.conflict = false;
    const theirs = doc.base;
    if (choice === "theirs") {
      doc.local = { text: theirs.text, mood: theirs.mood };
      this.removeDraft(doc);
    } else if (choice === "both") {
      doc.local = {
        text: theirs.text.trim() ? `${theirs.text}\n\n${doc.local.text}` : doc.local.text,
        mood: doc.local.mood ?? theirs.mood,
      };
    }
    this.changed(doc);
    void this.save(doc);
    this.dropIfDone(doc);
  }

  /** The session is back (the same user signed in again): carry on saving. */
  resume(): void {
    this.signedOut = false;
    this.retryNow();
  }

  /** Fetches a day again if it has no changes here: another tab or device may have saved it. */
  refresh(key?: string): void {
    for (const doc of key ? [this.docs.get(key)].filter((d) => d !== undefined) : this.docs.values()) {
      if (!doc.base || doc.loading || doc.inflight || isDirty(doc) || doc.conflict || this.signedOut) continue;
      const rev = doc.base.rev;
      this.api.get(doc.journalId, doc.date).then(
        (page) => {
          if (!doc.base || doc.base.rev !== rev || isDirty(doc) || doc.inflight || doc.conflict) return;
          if (page.rev === rev) return;
          doc.base = { text: page.text, mood: page.mood, rev: page.rev };
          doc.local = { text: page.text, mood: page.mood };
          doc.updatedAt = page.updatedAt;
          this.changed(doc);
        },
        (err: unknown) => {
          if (err instanceof SignedOutError) this.failed(doc, err, false);
        },
      );
    }
  }

  /** Sends what other visits left unsaved in this browser (their drafts), as each one allows. */
  adoptDrafts(): void {
    for (const key of this.draftKeys()) {
      const [journalId, date] = key.slice(this.draftPrefix.length).split("/");
      if (!journalId || !date || this.docs.has(pageKey(journalId, date))) continue;
      void this.load(this.create(journalId, date));
    }
  }

  /** Listens to the window: leaving, coming back, going online. Returns a function that stops it. */
  attach(): () => void {
    const onPageHide = () => this.pageHide();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if ([...this.docs.values()].some(isDirty)) e.preventDefault();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? this.flush() : this.refresh());
    const onFocus = () => this.refresh();
    const onOnline = () => this.retryNow();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /** The page is closing: every change goes to storage, and to the server if it is small enough. */
  pageHide(): void {
    for (const doc of this.docs.values()) {
      if (!isDirty(doc)) continue;
      this.saveDraft(doc);
      if (doc.local.text.length < KEEPALIVE_CHARS) void this.save(doc, true);
    }
  }

  // ── Inside ───────────────────────────────────────────────────────────────────────────────────

  private create(journalId: string, date: string): Doc {
    const key = pageKey(journalId, date);
    const doc: Doc = {
      key,
      journalId,
      date,
      base: null,
      local: { text: "", mood: null },
      updatedAt: null,
      loading: false,
      inflight: false,
      conflict: false,
      problem: null,
      viewers: 0,
      quietTimer: null,
      maxTimer: null,
      draftTimer: null,
      state: undefined as unknown as DayState,
    };
    this.docs.set(key, doc);
    this.snapshot(doc);
    return doc;
  }

  private async load(doc: Doc): Promise<void> {
    doc.loading = true;
    doc.problem = null;
    this.changed(doc);
    let page: Page;
    try {
      page = await this.api.get(doc.journalId, doc.date);
    } catch (err) {
      doc.loading = false;
      // A draft left for a journal that is gone (or in the bin) waits in storage for it.
      if (doc.viewers <= 0 && err instanceof ApiFailure && err.status === 404) this.drop(doc);
      else this.failed(doc, err, false);
      this.changed(doc);
      return;
    }
    doc.loading = false;
    this.online();
    doc.base = { text: page.text, mood: page.mood, rev: page.rev };
    doc.local = { text: page.text, mood: page.mood };
    doc.updatedAt = page.updatedAt;
    const draft = this.readDraft(doc);
    if (draft && !sameContent(draft, page)) {
      // Unsaved text from earlier. Written on the version that is still there: it simply goes
      // out now. Written on an older one: the page changed since, so the writer chooses.
      doc.local = { text: draft.text, mood: draft.mood };
      if (draft.baseRev === page.rev) this.schedule(doc, 0);
      else doc.conflict = true;
    } else if (draft) {
      this.removeDraft(doc);
    }
    this.changed(doc);
    this.dropIfDone(doc);
  }

  private schedule(doc: Doc, delay: number): void {
    if (doc.quietTimer) clearTimeout(doc.quietTimer);
    doc.quietTimer = setTimeout(() => void this.save(doc), delay);
    doc.maxTimer ??= setTimeout(() => void this.save(doc), MAX_WAIT_MS);
  }

  private clearTimers(doc: Doc): void {
    if (doc.quietTimer) clearTimeout(doc.quietTimer);
    if (doc.maxTimer) clearTimeout(doc.maxTimer);
    doc.quietTimer = doc.maxTimer = null;
  }

  private async save(doc: Doc, keepalive = false): Promise<void> {
    this.clearTimers(doc);
    if (!doc.base || doc.inflight || doc.conflict || doc.problem || this.signedOut || !isDirty(doc)) return;
    const sent = doc.local;
    doc.inflight = true;
    this.changed(doc);
    try {
      const saved = await this.api.put(doc.journalId, doc.date, { ...sent, rev: doc.base.rev }, keepalive);
      doc.inflight = false;
      doc.base = { ...sent, rev: saved.rev };
      doc.updatedAt = saved.updatedAt;
      this.online();
      this.channel?.postMessage({ journalId: doc.journalId, date: doc.date });
      this.onSaved?.(doc.journalId, doc.date);
      // Typed on while it was on its way: that goes next.
      if (isDirty(doc)) this.schedule(doc, QUIET_MS);
      else this.removeDraft(doc);
    } catch (err) {
      doc.inflight = false;
      this.failed(doc, err, true);
    }
    this.changed(doc);
    this.dropIfDone(doc);
  }

  private failed(doc: Doc, err: unknown, saving: boolean): void {
    if (saving) this.saveDraft(doc);
    if (err instanceof SignedOutError) {
      if (!this.signedOut) {
        this.signedOut = true;
        this.onSignedOut?.(err);
      }
    } else if (err instanceof ApiFailure && err.code === "conflict" && err.body?.page) {
      const page = err.body.page;
      doc.base = { text: page.text, mood: page.mood, rev: page.rev };
      doc.updatedAt = page.updatedAt;
      // Both sides wrote the same thing: nothing to choose.
      if (sameContent(doc.base, doc.local)) this.removeDraft(doc);
      else doc.conflict = true;
    } else if (err instanceof ApiFailure && err.code === "other-user") {
      // api() is reloading the page for the new user; the draft waits for this one.
    } else if (
      err instanceof ApiFailure &&
      (err.status === 0 || err.status >= 500 || [408, 429].includes(err.status))
    ) {
      this.goOffline();
    } else {
      if (!(err instanceof ApiFailure)) console.error(err);
      doc.problem = err instanceof ApiFailure ? err.message : "Something went wrong. Try again in a moment.";
    }
  }

  private goOffline(): void {
    this.offline = true;
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.retry();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    }
    this.notify();
  }

  private online(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = RETRY_MIN_MS;
    if (this.offline) {
      this.offline = false;
      this.notify();
    }
  }

  private retryNow(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retry();
  }

  private retry(): void {
    for (const doc of this.docs.values()) {
      if (!doc.base && !doc.loading) void this.load(doc);
      else void this.save(doc);
    }
  }

  private dropIfDone(doc: Doc): void {
    if (doc.viewers <= 0 && !doc.loading && !doc.inflight && !doc.conflict && !isDirty(doc)) this.drop(doc);
  }

  private drop(doc: Doc): void {
    this.clearTimers(doc);
    if (doc.draftTimer) clearTimeout(doc.draftTimer);
    this.docs.delete(doc.key);
    this.notify();
  }

  // ── Drafts in localStorage ───────────────────────────────────────────────────────────────────

  private draftKey = (doc: Doc) => this.draftPrefix + doc.key;

  private draftKeys(): string[] {
    const keys: string[] = [];
    try {
      for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const key = this.storage!.key(i);
        if (key?.startsWith(this.draftPrefix)) keys.push(key);
      }
    } catch {
      // storage unavailable
    }
    return keys;
  }

  private readDraft(doc: Doc): Draft | null {
    try {
      const raw = this.storage?.getItem(this.draftKey(doc));
      const draft = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
      if (typeof draft?.text !== "string" || typeof draft.baseRev !== "number") return null;
      return { text: draft.text, mood: draft.mood ?? null, baseRev: draft.baseRev, at: draft.at ?? 0 };
    } catch {
      return null;
    }
  }

  private saveDraftSoon(doc: Doc): void {
    doc.draftTimer ??= setTimeout(() => {
      doc.draftTimer = null;
      this.saveDraft(doc);
    }, DRAFT_MS);
  }

  private saveDraft(doc: Doc): void {
    if (!isDirty(doc)) return;
    const draft: Draft = { ...doc.local, baseRev: doc.base!.rev, at: Date.now() };
    try {
      this.storage?.setItem(this.draftKey(doc), JSON.stringify(draft));
    } catch {
      // Full or blocked: the server is the only copy then.
    }
  }

  private removeDraft(doc: Doc): void {
    try {
      this.storage?.removeItem(this.draftKey(doc));
    } catch {
      // nothing to do
    }
  }

  // ── Telling React ────────────────────────────────────────────────────────────────────────────

  private snapshot(doc: Doc): void {
    doc.state = {
      key: doc.key,
      journalId: doc.journalId,
      date: doc.date,
      loaded: doc.base !== null,
      text: doc.local.text,
      mood: doc.local.mood,
      dirty: isDirty(doc),
      saving: doc.inflight,
      theirs: doc.conflict && doc.base ? { text: doc.base.text, mood: doc.base.mood } : null,
      problem: doc.problem,
      updatedAt: doc.updatedAt,
    };
  }

  private changed(doc: Doc): void {
    this.snapshot(doc);
    this.notify();
  }

  private notify(): void {
    const status = this.computeStatus();
    if (JSON.stringify(status) !== JSON.stringify(this.currentStatus)) this.currentStatus = status;
    for (const listener of this.listeners) listener();
  }

  private computeStatus(): SyncStatus {
    const docs = [...this.docs.values()];
    if (this.signedOut) return { kind: "signed-out" };
    const conflict = docs.find((d) => d.conflict);
    if (conflict) return { kind: "conflict", journalId: conflict.journalId, date: conflict.date };
    const problem = docs.find((d) => d.problem && isDirty(d));
    if (problem) return { kind: "problem", journalId: problem.journalId, date: problem.date };
    const busy = docs.some((d) => isDirty(d) || d.inflight || d.loading);
    if (this.offline && busy) return { kind: "offline" };
    return docs.some((d) => isDirty(d) || d.inflight) ? { kind: "saving" } : { kind: "saved" };
  }
}
