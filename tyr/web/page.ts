// What every part of the page shares: the drawer, what is on screen, and how to change either.
import { createContext, useContext } from "react";
import type { Question, Source } from "../shared/protocol.ts";
import type { Index } from "./model.ts";

export type View = "file" | "threads" | "places" | "search";

export interface Ui {
  view: View;
  /** The open file. */
  pid: string | null;
  tab: "profile" | "timeline";
  ledger: "spont" | "prompt";
  life: "ours" | "past";
  order: "told" | "hap";
  /** Which sources the spontaneous ledger shows. */
  srcf: ReadonlySet<Source>;
  /** Entries showing their details. */
  open: ReadonlySet<string>;
  /** The entry just saved or jumped to. */
  flash: string | null;
  showClosed: boolean;
  q: string;
  qsrc: ReadonlySet<Source>;
  qplace: string;
  place: string | null;
  /** The drawer's open letters; all others show only the letter. */
  expanded: ReadonlySet<string>;
}

export type Sheet =
  | { what: "entry"; pid: string; mode: "new" }
  | { what: "entry"; pid: string; mode: "amend" | "complete"; eid: string }
  | { what: "muninn"; tab: "capture" | "met" }
  | { what: "answer"; pid: string; q: Question }
  | { what: "details"; pid: string }
  | null;

export interface Page {
  ix: Index;
  today: string;
  ui: Ui;
  patch: (change: Partial<Ui>) => void;
  setSheet: (sheet: Sheet) => void;
  /** Sends a change and loads the drawer again. Refuses by throwing: see describeError. */
  send: (path: string, method: string, body?: unknown) => Promise<void>;
  /** The same, from a button with no form to show an error in. */
  act: (path: string, method: string, body?: unknown, done?: string) => void;
  toast: (message: string) => void;
  openFile: (pid: string) => void;
  /** Opens an entry where it lives: its file's timeline, in the right ledger. */
  gotoEntry: (eid: string) => void;
  /** Shows an entry just saved. */
  showSaved: (pid: string, eid: string, src: Source, expand: boolean) => void;
}

const PageContext = createContext<Page | null>(null);
export const PageProvider = PageContext.Provider;

export function usePage(): Page {
  const page = useContext(PageContext);
  if (!page) throw new Error("usePage needs a PageProvider");
  return page;
}

export const newId = (): string => crypto.randomUUID();
