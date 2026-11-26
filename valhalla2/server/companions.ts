// The companions one person talks to.
//
// A companion is a name for the list, one profile text box the model reads as written (the user
// persona goes inside it), its settings, its own versions of Valhalla 2's prompt texts, and the
// voice its replies are read aloud in. Two things are chosen once, when it is created, and never
// change: the API it talks to (Claude or Grok), and whether it has memory. Nothing a Grok companion
// says goes to Anthropic, and nothing a Claude one says goes to xAI.
import type { DatabaseSync } from "node:sqlite";
import { LIMITS, providerOf, type Companion, type Provider, type Settings } from "../shared/protocol.ts";
import {
  object,
  prompts as checkPrompts,
  required,
  settings as checkSettings,
  text,
  voice as checkVoice,
} from "./check.ts";
import { config } from "./config.ts";
import { invalid, notFound, tooMany } from "./errors.ts";
import { createMemory } from "./memory/store.ts";

interface Row {
  id: string;
  name: string;
  profile: string;
  settings: string;
  prompts: string;
  voice: string | null;
  voice_feeling: number;
  provider: string;
  memory: number;
  created_at: string;
  updated_at: string;
}

export const companionOf = (row: Row): Companion => ({
  id: row.id,
  name: row.name,
  profile: row.profile,
  // A companion saved before temperature existed has none in its settings.
  settings: { temperature: null, ...(JSON.parse(row.settings) as Omit<Settings, "temperature">) },
  provider: row.provider === "xai" ? "xai" : "anthropic",
  memory: row.memory === 1,
  prompts: JSON.parse(row.prompts) as Companion["prompts"],
  voice: row.voice,
  voiceFeeling: row.voice_feeling === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const NAMES = [
  "id",
  "name",
  "profile",
  "settings",
  "prompts",
  "voice",
  "voice_feeling",
  "provider",
  "memory",
  "created_at",
  "updated_at",
];
const COLUMNS = NAMES.join(", ");

/** The columns companionOf() reads, each prefixed with a table alias, for a query that joins. */
export const companionColumns = (alias: string): string => NAMES.map((name) => `${alias}.${name}`).join(", ");

const PROVIDER_NAMES: Record<Provider, string> = { anthropic: "Claude", xai: "Grok" };

/** One person's companions. `defaults` fills in settings a request leaves out. */
export function createCompanions(db: DatabaseSync, owner: string, defaults: Settings) {
  function get(id: string): Companion {
    const row = db.prepare(`SELECT ${COLUMNS} FROM companions WHERE id = ? AND owner = ?`).get(id, owner) as
      Row | undefined;
    return row ? companionOf(row) : notFound("companion");
  }

  return {
    get,

    list(): Companion[] {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM companions WHERE owner = ? ORDER BY name COLLATE NOCASE`)
        .all(owner) as unknown as Row[];
      return rows.map(companionOf);
    },

    /** Saves a companion under this id, whether it is new or a change to one already there. */
    save(id: string, body: unknown): Companion {
      const fields = object(body);
      const name = required(fields.name, LIMITS.name, "The name");
      const profile = text(fields.profile ?? "", LIMITS.profile, "The profile");

      const existing = db.prepare("SELECT owner, provider, memory FROM companions WHERE id = ?").get(id) as
        { owner: string; provider: Provider; memory: number } | undefined;
      if (existing && existing.owner !== owner) notFound("companion");

      // Claude or Grok, and memory or not: taken from a new companion, and held to on every change.
      // The API is checked first, so a model of the other one is refused for what it is.
      const otherApi = (model: unknown, provider: Provider) => {
        if (typeof model === "string" && providerOf(model) !== provider) {
          invalid(
            `This companion talks to ${PROVIDER_NAMES[provider]}, so it can't use ${model}. ` +
              "Claude or Grok is chosen when a companion is created.",
          );
        }
      };
      if (existing && typeof fields.settings === "object" && fields.settings !== null) {
        otherApi((fields.settings as Record<string, unknown>).model, existing.provider);
      }
      const settings = checkSettings(fields.settings, defaults);
      const provider = existing?.provider ?? providerOf(settings.model);
      otherApi(settings.model, provider);
      const prompts = checkPrompts(fields.prompts);
      const voice = checkVoice(fields.voice);
      // On unless said otherwise.
      const voiceFeeling = fields.voiceFeeling === false ? 0 : 1;
      const now = new Date().toISOString();
      const asked = fields.memory === undefined ? undefined : fields.memory === true;
      if (provider === "xai" && asked === true) invalid("A Grok companion has no memory");
      const memory = existing ? existing.memory === 1 : provider === "anthropic" && asked !== false;
      if (existing && asked !== undefined && asked !== memory) {
        invalid("Whether a companion has memory is chosen when it is created, and can't be changed");
      }
      if (existing) {
        db.prepare(
          "UPDATE companions SET name = ?, profile = ?, settings = ?, prompts = ?, voice = ?, voice_feeling = ?, updated_at = ? WHERE id = ?",
        ).run(name, profile, JSON.stringify(settings), JSON.stringify(prompts), voice, voiceFeeling, now, id);
      } else {
        const { count } = db.prepare("SELECT count(*) AS count FROM companions WHERE owner = ?").get(owner) as {
          count: number;
        };
        if (count >= LIMITS.companions) tooMany(`Valhalla 2 keeps ${LIMITS.companions} companions at most`);
        db.prepare(`INSERT INTO companions (${COLUMNS}, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          name,
          profile,
          JSON.stringify(settings),
          JSON.stringify(prompts),
          voice,
          voiceFeeling,
          provider,
          memory ? 1 : 0,
          now,
          now,
          owner,
        );
        // A new companion with memory starts with its files laid out, empty but for what goes where.
        if (memory) createMemory(db, config.memory).seed(id, now);
      }
      return get(id);
    },

    /** Deletes a companion with every chat it had. */
    remove(id: string): void {
      get(id);
      db.prepare("DELETE FROM companions WHERE id = ? AND owner = ?").run(id, owner);
    },
  };
}

export type Companions = ReturnType<typeof createCompanions>;

/** The companion, or a refusal when it has no memory and what was asked needs it. */
export function needMemory(companion: Companion): Companion {
  return companion.memory ? companion : invalid("This companion has no memory");
}
