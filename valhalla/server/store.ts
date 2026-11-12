// The characters you talk to, and the people you are when you talk to them.
//
// One readable JSON file each, under data/characters and data/personas. Nothing here is a cache
// of anything: the file on disk is the truth, so editing one by hand is a supported way to work.
import { LIMITS, type Character, type Persona } from "../shared/protocol.ts";
import { object, required, settings, text } from "./check.ts";
import { notFound, tooMany } from "./errors.ts";
import { listIds, pathOf, readJson, remove, writeJson } from "./files.ts";

const characterFile = (id: string) => pathOf("characters", `${id}.json`);
const personaFile = (id: string) => pathOf("personas", `${id}.json`);

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** What a character's file has to contain. Everything but the name may be left empty. */
function checkedCharacter(body: unknown) {
  const fields = object(body);
  return {
    name: required(fields.name, LIMITS.name, "The name"),
    personality: text(fields.personality ?? "", LIMITS.field, "The personality"),
    appearance: text(fields.appearance ?? "", LIMITS.field, "The appearance"),
    behavior: text(fields.behavior ?? "", LIMITS.field, "The behavior"),
    settings: settings(fields.settings),
  };
}

function checkedPersona(body: unknown) {
  const fields = object(body);
  return {
    name: required(fields.name, LIMITS.name, "The name"),
    description: text(fields.description ?? "", LIMITS.field, "The description"),
    appearance: text(fields.appearance ?? "", LIMITS.field, "The appearance"),
  };
}

export function createStore() {
  async function characters(): Promise<Character[]> {
    const ids = await listIds(pathOf("characters"));
    const all = await Promise.all(ids.map((id) => readJson(characterFile(id))));
    return (all.filter(Boolean) as Character[]).sort(byName);
  }

  async function character(id: string): Promise<Character> {
    return ((await readJson(characterFile(id))) as Character | null) ?? notFound("character");
  }

  async function personas(): Promise<Persona[]> {
    const ids = await listIds(pathOf("personas"));
    const all = await Promise.all(ids.map((id) => readJson(personaFile(id))));
    return (all.filter(Boolean) as Persona[]).sort(byName);
  }

  async function persona(id: string): Promise<Persona> {
    return ((await readJson(personaFile(id))) as Persona | null) ?? notFound("persona");
  }

  return {
    characters,
    character,
    personas,
    persona,

    /** Saves a character under this id, whether it is new or a change to one already there. */
    async saveCharacter(id: string, body: unknown): Promise<Character> {
      const existing = (await readJson(characterFile(id))) as Character | null;
      if (!existing && (await listIds(pathOf("characters"))).length >= LIMITS.characters) {
        tooMany(`Valhalla keeps ${LIMITS.characters} characters at most`);
      }
      const now = new Date().toISOString();
      const saved: Character = {
        id,
        ...checkedCharacter(body),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await writeJson(characterFile(id), saved);
      return saved;
    },

    async removeCharacter(id: string): Promise<void> {
      await character(id);
      await remove(characterFile(id));
    },

    async savePersona(id: string, body: unknown): Promise<Persona> {
      const existing = (await readJson(personaFile(id))) as Persona | null;
      if (!existing && (await listIds(pathOf("personas"))).length >= LIMITS.personas) {
        tooMany(`Valhalla keeps ${LIMITS.personas} personas at most`);
      }
      const now = new Date().toISOString();
      const saved: Persona = {
        id,
        ...checkedPersona(body),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await writeJson(personaFile(id), saved);
      return saved;
    },

    async removePersona(id: string): Promise<void> {
      await persona(id);
      await remove(personaFile(id));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
