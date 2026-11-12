// What every view needs: the lists in the rail, and a way to ask for them again after a write.
import { createContext, useContext } from "react";
import type { Character, ConversationSummary, Persona } from "../shared/protocol.ts";

export interface Health {
  apiKeyInEnvironment: boolean;
  dataDir: string;
}

export interface Page {
  characters: Character[];
  personas: Persona[];
  conversations: ConversationSummary[];
  health: Health | null;
  /** Reads the lists again. Called after anything is saved or deleted. */
  reload: () => Promise<void>;
  /** Shows a conversation, a definition, or the welcome. */
  open: (selection: Selection) => void;
}

export type Selection =
  | { kind: "none" }
  | { kind: "conversation"; id: string }
  | { kind: "character"; id: string | null }
  | { kind: "persona"; id: string | null };

const context = createContext<Page | null>(null);

export const PageContext = context;

export function usePage(): Page {
  const page = useContext(context);
  if (!page) throw new Error("usePage was called outside the page");
  return page;
}
