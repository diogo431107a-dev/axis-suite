// The kept readings of moments (`scenes`), for pictures: where and when a moment happens, who is in
// it and how they look, and its atmosphere. By default the character alone; you add anyone else.
// How a reply is read aloud is apart (../tone/).
//
// A reading is kept per message and used again while what it was read from still holds: the chat
// up to the moment, and the instructions. The memory changing doesn't count, or every filing of a
// chat would read its moments again. One you corrected stays as you left it until the message's
// own words change.
import type { DatabaseSync } from "node:sqlite";
import {
  LIMITS,
  type Companion,
  type Effort,
  type Message,
  type Provider,
  type ScenePerson,
  type SceneSheet,
  type SceneView,
} from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";
import { object, text } from "../check.ts";
import { invalid, notFound } from "../errors.ts";
import type { Reader } from "../reading.ts";
import { hashOf, textOf } from "../tone/request.ts";
import { backgroundOf, chatUpTo, type Remembered } from "./context.ts";

const str = { type: "string" } as const;

/** The shape the scene model answers in. */
export const SCENE_SCHEMA = {
  type: "object",
  properties: {
    place: str,
    time: str,
    weather: str,
    light: str,
    atmosphere: str,
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: str,
          appearance: str,
          clothes: str,
          action: str,
          pose: str,
          view: str,
          mood: str,
          expression: str,
        },
        required: ["name", "appearance", "clothes", "action", "pose", "view", "mood", "expression"],
        additionalProperties: false,
      },
    },
  },
  required: ["place", "time", "weather", "light", "atmosphere", "people"],
  additionalProperties: false,
} as const;

/** What is asked about one moment, and what decides whether a kept reading still holds. */
export interface MomentRequest {
  provider: Provider;
  model: string;
  effort: Effort;
  system: string;
  background: string;
  moment: string;
  cacheKey: string;
  /** Of the instructions and the chat up to the moment; the memory aside. */
  contextHash: string;
  /** Of the message's own words. */
  textHash: string;
}

/** The request about the moment at the end of `path`. */
export function momentRequest(
  companion: Companion,
  remembered: Remembered,
  path: readonly Message[],
  budget: number,
): MomentRequest {
  const message = path.at(-1) ?? invalid("There is no moment to read");
  const moment = `${chatUpTo(companion, path, budget)}\n\nWork out the moment marked <moment>, for a picture of it.`;
  const system = promptOf(companion, "scene");
  return {
    provider: companion.provider,
    model: companion.settings.sceneModel,
    effort: companion.settings.sceneEffort,
    system,
    background: backgroundOf(companion, remembered),
    moment,
    cacheKey: `scene:${companion.id}`,
    contextHash: hashOf(`${system}\n${moment}`),
    textHash: hashOf(textOf(message)),
  };
}

const PERSON_FIELDS = ["name", "appearance", "clothes", "action", "pose", "view", "mood", "expression"] as const;
const SHEET_FIELDS = ["place", "time", "weather", "light", "atmosphere"] as const;

/** The model's answer as a sheet. Whatever is missing or unknown is left empty; nothing is refused. */
export function sheetOf(raw: unknown): SceneSheet {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, LIMITS.sceneField) : "");
  const people: ScenePerson[] = (Array.isArray(fields.people) ? fields.people : [])
    .slice(0, LIMITS.scenePeople)
    .map((entry) => {
      const person = (entry ?? {}) as Record<string, unknown>;
      return Object.fromEntries(PERSON_FIELDS.map((key) => [key, str(person[key])])) as unknown as ScenePerson;
    });
  return {
    ...(Object.fromEntries(SHEET_FIELDS.map((key) => [key, str(fields[key])])) as Omit<SceneSheet, "people">),
    people,
  };
}

/** A sheet you corrected, checked. */
export function correctedSheet(body: unknown): SceneSheet {
  const fields = object(body);
  const field = (value: unknown, what: string) => text(value ?? "", LIMITS.sceneField, what);
  const people = fields.people ?? [];
  if (!Array.isArray(people)) invalid("The people aren't valid");
  if (people.length > LIMITS.scenePeople) invalid(`${LIMITS.scenePeople} people at most`);
  return {
    place: field(fields.place, "The place"),
    time: field(fields.time, "The time"),
    weather: field(fields.weather, "The weather"),
    light: field(fields.light, "The light"),
    atmosphere: field(fields.atmosphere, "The atmosphere"),
    people: people.map((entry) => {
      const person = object(entry);
      return {
        name: field(person.name, "A name"),
        appearance: field(person.appearance, "A look"),
        clothes: field(person.clothes, "The clothes"),
        action: field(person.action, "What someone is doing"),
        pose: field(person.pose, "A pose"),
        view: field(person.view, "How someone is seen"),
        mood: field(person.mood, "A mood"),
        expression: field(person.expression, "An expression"),
      };
    }),
  };
}

interface Row {
  message_id: number;
  context_hash: string;
  text_hash: string;
  sheet: string;
  model: string;
  cost: number | null;
  request: string;
  created_at: string;
  edited_at: string | null;
}

// A sheet kept before atmosphere, expression, pose or view existed (one you corrected then) reads as
// empty there.
const viewOf = (row: Row): SceneView => ({
  messageId: row.message_id,
  sheet: sheetOf(JSON.parse(row.sheet)),
  edited: row.edited_at !== null,
  model: row.model,
  cost: row.cost,
  request: JSON.parse(row.request) as SceneView["request"],
  createdAt: row.created_at,
});

/** Whether a kept reading still holds for this request. */
const holds = (row: Row, request: MomentRequest): boolean =>
  row.context_hash === request.contextHash || (row.edited_at !== null && row.text_hash === request.textHash);

export interface ScenesOptions {
  db: DatabaseSync;
  read: Reader;
}

export function createScenes({ db, read }: ScenesOptions) {
  /** Readings under way, so two pictures asked at once pay once. */
  const underway = new Map<string, Promise<SceneView>>();

  const kept = (messageId: number): Row | undefined =>
    db.prepare("SELECT * FROM scenes WHERE message_id = ?").get(messageId) as Row | undefined;

  async function ask(messageId: number, request: MomentRequest): Promise<SceneView> {
    const answer = await read({
      provider: request.provider,
      model: request.model,
      effort: request.effort,
      system: request.system,
      background: request.background,
      moment: request.moment,
      schema: SCENE_SCHEMA as unknown as Record<string, unknown>,
      name: "scene",
      what: "this moment",
      cacheKey: request.cacheKey,
    });
    const sheet = sheetOf(answer.raw);
    const sent = { system: request.system, prompt: `${request.background}\n\n${request.moment}` };
    try {
      db.prepare(
        `INSERT OR REPLACE INTO scenes
           (message_id, context_hash, text_hash, sheet, model, cost, request, created_at, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        messageId,
        request.contextHash,
        request.textHash,
        JSON.stringify(sheet),
        answer.model,
        answer.cost,
        JSON.stringify(sent),
        new Date().toISOString(),
      );
    } catch (err) {
      // The message was deleted with its chat while it was being read.
      if (String((err as Error).message).includes("FOREIGN KEY")) notFound("message");
      throw err;
    }
    return viewOf(kept(messageId)!);
  }

  return {
    /** The kept reading while it still holds, or null. Nothing is asked. */
    peek(messageId: number, request: MomentRequest): SceneView | null {
      const row = kept(messageId);
      return row && holds(row, request) ? viewOf(row) : null;
    },

    /** The reading of a moment: the kept one while it holds, otherwise a new one. `fresh` always asks. */
    of(messageId: number, request: MomentRequest, fresh = false): Promise<SceneView> {
      const row = kept(messageId);
      if (!fresh && row && holds(row, request)) return Promise.resolve(viewOf(row));
      const key = `${messageId}:${request.contextHash}:${fresh ? "fresh" : ""}`;
      let reading = underway.get(key);
      if (!reading) {
        reading = ask(messageId, request).finally(() => underway.delete(key));
        underway.set(key, reading);
      }
      return reading;
    },

    /** Keeps your correction of a reading, which has to exist and still match the message. */
    save(messageId: number, request: MomentRequest, body: unknown): SceneView {
      const row = kept(messageId);
      if (!row || row.text_hash !== request.textHash) invalid("Read the moment again before correcting it");
      const sheet = correctedSheet(body);
      db.prepare("UPDATE scenes SET sheet = ?, edited_at = ? WHERE message_id = ?").run(
        JSON.stringify(sheet),
        new Date().toISOString(),
        messageId,
      );
      return viewOf(kept(messageId)!);
    },
  };
}

export type Scenes = ReturnType<typeof createScenes>;
