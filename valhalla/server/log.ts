// Conversations: who is talking to whom, and every turn they have taken.
//
// A conversation is a folder: conversation.json names the pair and the settings, turns.jsonl is
// the dialogue. The log is append-only, and that is not a storage preference — thinking blocks
// the API returns are bound to the model and to the conversation that produced them, so a turn
// that has been sent has to go back exactly as it came. Changing the past is a fork, not an edit.
import {
  LIMITS,
  type Conversation,
  type ConversationPage,
  type ConversationSummary,
  type Turn,
} from "../shared/protocol.ts";
import { id as checkId, object, settings as checkSettings, text } from "./check.ts";
import { conflict, notFound, tooMany } from "./errors.ts";
import { join } from "node:path";
import { appendLines, listFolders, readJson, readLines, remove, writeJson } from "./files.ts";
import type { Store } from "./store.ts";

/** One person's conversations, kept under root (see users.ts) beside their store's files. */
export function createConversations(store: Store, root: string) {
  const pathOf = (...parts: string[]) => join(root, ...parts);
  const folderOf = (id: string) => pathOf("conversations", id);
  const metaFile = (id: string) => pathOf("conversations", id, "conversation.json");
  const turnsFile = (id: string) => pathOf("conversations", id, "turns.jsonl");

  async function get(id: string): Promise<Conversation> {
    return ((await readJson(metaFile(id))) as Conversation | null) ?? notFound("conversation");
  }

  async function turns(id: string): Promise<Turn[]> {
    return (await readLines(turnsFile(id))) as Turn[];
  }

  return {
    get,
    turns,

    async list(): Promise<ConversationSummary[]> {
      const ids = await listFolders(pathOf("conversations"));
      const metas = (await Promise.all(ids.map((id) => readJson(metaFile(id))))).filter(Boolean) as Conversation[];
      const [characters, personas] = await Promise.all([store.characters(), store.personas()]);
      const nameOf = (list: { id: string; name: string }[], id: string) =>
        list.find((item) => item.id === id)?.name ?? "(deleted)";
      return metas
        .map((meta) => ({
          id: meta.id,
          title: meta.title,
          characterId: meta.characterId,
          characterName: nameOf(characters, meta.characterId),
          personaId: meta.personaId,
          personaName: nameOf(personas, meta.personaId),
          updatedAt: meta.updatedAt,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    /** Opens a conversation between a character and one of your personas. */
    async create(body: unknown): Promise<Conversation> {
      const fields = object(body);
      const id = checkId(fields.id);
      if (await readJson(metaFile(id))) conflict("That id is already taken");
      if ((await listFolders(pathOf("conversations"))).length >= LIMITS.conversations) {
        tooMany(`Valhalla keeps ${LIMITS.conversations} conversations at most`);
      }
      const character = await store.character(checkId(fields.characterId));
      const persona = await store.persona(checkId(fields.personaId));
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id,
        title: text(fields.title ?? "", LIMITS.title, "The title") || `${character.name} & ${persona.name}`,
        characterId: character.id,
        personaId: persona.id,
        // A new conversation starts from the character's own settings; changing them here later
        // does not touch the character.
        settings: fields.settings === undefined ? character.settings : checkSettings(fields.settings),
        createdAt: now,
        updatedAt: now,
      };
      await writeJson(metaFile(id), conversation);
      return conversation;
    },

    /** Everything the page needs to show a conversation. */
    async page(id: string): Promise<ConversationPage> {
      const conversation = await get(id);
      const [character, persona, history] = await Promise.all([
        store.character(conversation.characterId),
        store.persona(conversation.personaId),
        turns(id),
      ]);
      return { conversation, character, persona, turns: history };
    },

    async changeSettings(id: string, body: unknown): Promise<Conversation> {
      const conversation = await get(id);
      const changed: Conversation = {
        ...conversation,
        settings: checkSettings(body),
        updatedAt: new Date().toISOString(),
      };
      await writeJson(metaFile(id), changed);
      return changed;
    },

    async rename(id: string, body: unknown): Promise<Conversation> {
      const conversation = await get(id);
      const fields = object(body);
      const changed: Conversation = {
        ...conversation,
        title: text(fields.title, LIMITS.title, "The title") || conversation.title,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(metaFile(id), changed);
      return changed;
    },

    /**
     * Adds turns to the end of the log, together. Nothing already written is touched.
     *
     * turns.jsonl is the conversation; conversation.json only names the pair and carries the time
     * the list is sorted by. So the turns go down first, in one write, and a failure to stamp that
     * time afterwards is said out loud but does not fail the turn: the words are already safe, and
     * reporting a failure for words that were saved is what makes someone send them twice.
     */
    async appendTurns(id: string, ...turns: Turn[]): Promise<void> {
      const last = turns.at(-1);
      if (!last) return;
      const conversation = await get(id);
      await appendLines(turnsFile(id), turns);
      try {
        await writeJson(metaFile(id), { ...conversation, updatedAt: last.at });
      } catch (err) {
        console.error(`${metaFile(id)}: the turns were saved, but the time on them was not.`, err);
      }
    },

    async remove(id: string): Promise<void> {
      await get(id);
      await remove(folderOf(id));
    },

    /**
     * Refuses to delete a character or persona that conversations still point at — the log would
     * stay on disk with nothing to read it against.
     */
    async refuseIfUsed(kind: "character" | "persona", id: string): Promise<void> {
      const ids = await listFolders(pathOf("conversations"));
      const metas = (await Promise.all(ids.map((at) => readJson(metaFile(at))))).filter(Boolean) as Conversation[];
      const using = metas.filter((meta) => (kind === "character" ? meta.characterId : meta.personaId) === id);
      if (using.length === 0) return;
      const which = using.length === 1 ? "1 conversation still uses" : `${using.length} conversations still use`;
      conflict(`${which} this ${kind}. Delete them first, or keep it.`);
    },
  };
}

export type Conversations = ReturnType<typeof createConversations>;
