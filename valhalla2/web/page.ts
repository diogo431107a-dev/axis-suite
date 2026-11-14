// What every view needs: the lists in the rail, and a way to ask for them again after a write.
import { createContext, useContext } from "react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { ChatSummary, Companion, Health } from "../shared/protocol.ts";

export interface Page {
  companions: Companion[];
  chats: ChatSummary[];
  health: Health;
  /** Who is signed in through Heimdall. */
  me: Me;
  /** Reads the lists again. Called after anything is saved or deleted. */
  reload: () => Promise<void>;
  /** Shows a chat, a companion, or the welcome. */
  open: (selection: Selection) => void;
}

export type Selection =
  | { kind: "none" }
  /** `greet`: the chat was just opened, so ask for its greeting straight away. */
  | { kind: "chat"; id: string; greet?: boolean }
  | { kind: "companion"; id: string | null }
  | { kind: "memory"; companionId: string };

const context = createContext<Page | null>(null);

export const PageContext = context;

export function usePage(): Page {
  const page = useContext(context);
  if (!page) throw new Error("usePage was called outside the page");
  return page;
}
