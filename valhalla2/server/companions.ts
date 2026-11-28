// The companions one person talks to.
//
// A companion is a name for the list, one profile text box the model reads as written (the user
// persona goes inside it), its settings, its own versions of Valhalla 2's prompt texts, and the
// voice its replies are read aloud in. Two things are chosen when it is created: the API it talks
// to (Claude, Grok or GPT), which never changes, and whether it has memory (which a Grok or GPT
// companion can turn on later). Nothing a companion says goes to any API but its own.
import type { DatabaseSync } from "node:sqlite";
import {
  LIMITS,
  ownReadingDefaults,
  hasScenes,
  PROVIDER_NAMES,
  PROVIDERS,
  providerOf,
  type Companion,
  type Provider,
  type Settings,
} from "../shared/protocol.ts";
import {
  object,
  prompts as checkPrompts,
  required,
  settings as checkSettings,
  text,
  voice as checkVoice,
  voiceTuning as checkTuning,
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
  voice_rate: number;
  voice_pitch: number;
  voice_style: string | null;
  provider: string;
  memory: number;
  created_at: string;
  updated_at: string;
}

/**
 * A companion's settings as kept. One saved before a setting existed has none of it, and gets what
 * a new one on its API would start with: no temperature, and its tone and scene read at low effort,
 * by the server's models on Claude and by its own chat model on Grok or GPT.
 */
function settingsOf(row: Row): Settings {
  const kept = JSON.parse(row.settings) as Partial<Settings> & Pick<Settings, "model">;
  const readings =
    providerOfRow(row) !== "anthropic"
      ? ownReadingDefaults(kept.model)
      : {
          toneModel: config.defaults.toneModel,
          toneEffort: config.defaults.toneEffort,
          sceneModel: config.defaults.sceneModel,
          sceneEffort: config.defaults.sceneEffort,
        };
  return { ...config.defaults, temperature: null, ...readings, ...kept };
}

/** The API a companion talks to, as kept. Rows from before there was a choice are Claude's. */
const providerOfRow = (row: Row): Provider =>
  (PROVIDERS as readonly string[]).includes(row.provider) ? (row.provider as Provider) : "anthropic";

export const companionOf = (row: Row): Companion => ({
  id: row.id,
  name: row.name,
  profile: row.profile,
  settings: settingsOf(row),
  provider: providerOfRow(row),
  memory: row.memory === 1,
  prompts: JSON.parse(row.prompts) as Companion["prompts"],
  voice: row.voice,
  voiceFeeling: row.voice_feeling === 1,
  voiceTuning: { rate: row.voice_rate, pitch: row.voice_pitch, style: row.voice_style },
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
  "voice_rate",
  "voice_pitch",
  "voice_style",
  "provider",
  "memory",
  "created_at",
  "updated_at",
];
const COLUMNS = NAMES.join(", ");

/** The columns companionOf() reads, each prefixed with a table alias, for a query that joins. */
export const companionColumns = (alias: string): string => NAMES.map((name) => `${alias}.${name}`).join(", ");

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

      // Claude, Grok or GPT, and memory or not: taken from a new companion, and held to on every change.
      // The API is checked first, so a model of the other one is refused for what it is.
      const otherApi = (model: unknown, provider: Provider) => {
        if (typeof model === "string" && providerOf(model) !== provider) {
          invalid(
            `This companion talks to ${PROVIDER_NAMES[provider]}, so it can't use ${model}. ` +
              "Claude, Grok or GPT is chosen when a companion is created.",
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
      const tuning = checkTuning(fields.voiceTuning);
      const now = new Date().toISOString();
      const asked = fields.memory === undefined ? undefined : fields.memory === true;
      // On unless said otherwise, on every API alike. Once made, it changes only one way: a Grok or
      // GPT companion without memory can have it turned on (memory/rebuild.ts), never off.
      const memory = existing ? existing.memory === 1 : asked !== false;
      if (existing && asked !== undefined && asked !== memory) {
        invalid("Whether a companion has memory is chosen when it is created, and can't be changed here");
      }
      if (existing) {
        db.prepare(
          `UPDATE companions SET name = ?, profile = ?, settings = ?, prompts = ?, voice = ?, voice_feeling = ?,
           voice_rate = ?, voice_pitch = ?, voice_style = ?, updated_at = ? WHERE id = ?`,
        ).run(
          name,
          profile,
          JSON.stringify(settings),
          JSON.stringify(prompts),
          voice,
          voiceFeeling,
          tuning.rate,
          tuning.pitch,
          tuning.style,
          now,
          id,
        );
      } else {
        const { count } = db.prepare("SELECT count(*) AS count FROM companions WHERE owner = ?").get(owner) as {
          count: number;
        };
        if (count >= LIMITS.companions) tooMany(`Valhalla 2 keeps ${LIMITS.companions} companions at most`);
        db.prepare(`INSERT INTO companions (${COLUMNS}, owner) VALUES (${NAMES.map(() => "?").join(", ")}, ?)`).run(
          id,
          name,
          profile,
          JSON.stringify(settings),
          JSON.stringify(prompts),
          voice,
          voiceFeeling,
          tuning.rate,
          tuning.pitch,
          tuning.style,
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

    /**
     * Keeps the seed a picture was made with as the companion's, so the next one carries on from
     * it. Only that one setting changes, and not when the companion was last edited.
     */
    setPictureSeed(id: string, seed: number): void {
      db.prepare(
        "UPDATE companions SET settings = json_set(settings, '$.pictureSeed', ?) WHERE id = ? AND owner = ?",
      ).run(seed, id, owner);
    },

    /** Deletes a companion with every chat it had. */
    remove(id: string): void {
      get(id);
      db.prepare("DELETE FROM companions WHERE id = ? AND owner = ?").run(id, owner);
    },
  };
}

export type Companions = ReturnType<typeof createCompanions>;

/** The companion, or a refusal when it has no scenes (hasScenes) and what was asked needs them. */
export function needScenes(companion: Companion): Companion {
  return hasScenes(companion) ? companion : invalid("This companion has no scenes");
}

/** The companion, or a refusal when it has no memory and what was asked needs it. */
export function needMemory(companion: Companion): Companion {
  return companion.memory ? companion : invalid("This companion has no memory");
}
