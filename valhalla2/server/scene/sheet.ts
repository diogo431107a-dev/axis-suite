// The kept readings of moments (`scenes`): where and when a moment happens, who is there and how,
// and how each line of a reply is said. A picture of the moment and reading it aloud share one.
//
// A reading is kept per message and used again while what it was read from still holds: the chat
// up to the moment, and the instructions. The memory changing doesn't count, or every filing of a
// chat would read its moments again. One you corrected stays as you left it until the message's
// own words change, since its lines would no longer match.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  blockText,
  FEELINGS,
  LIMITS,
  STRENGTHS,
  type Companion,
  type Feeling,
  type Message,
  type SceneLine,
  type ScenePerson,
  type SceneSheet,
  type SceneView,
  type Strength,
} from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";
import { object, text } from "../check.ts";
import type { SceneReader } from "../claude/scene.ts";
import { invalid, notFound } from "../errors.ts";
import { backgroundOf, chatUpTo, type Remembered } from "./context.ts";
import { linesOf, numbered, type Line } from "./lines.ts";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const textOf = (message: Message): string => message.content.map(blockText).join("").trim();

/** What is asked about one moment, and what decides whether a kept reading still holds. */
export interface MomentRequest {
  system: string;
  background: string;
  moment: string;
  lines: Line[];
  /** Of the instructions and the chat up to the moment; the memory aside. */
  contextHash: string;
  /** Of the message's own words. */
  textHash: string;
}

/** The request about the moment at the end of `path`. Only a companion's reply has lines to direct. */
export function momentRequest(
  companion: Companion,
  remembered: Remembered,
  path: readonly Message[],
  budget: number,
): MomentRequest {
  const message = path.at(-1) ?? invalid("There is no moment to read");
  const lines = message.role === "assistant" ? linesOf(textOf(message)) : [];
  const chat = chatUpTo(companion, path, budget);
  const moment =
    lines.length > 0
      ? `${chat}\n\n<lines>\n${numbered(lines)}\n</lines>\n\n` +
        "Work out the moment marked <moment>, and how each of its numbered lines is said."
      : `${chat}\n\nWork out the moment marked <moment>. It has no lines to direct: answer with an empty list of lines.`;
  const system = promptOf(companion, "scene");
  return {
    system,
    background: backgroundOf(companion, remembered),
    moment,
    lines,
    contextHash: hash(`${system}\n${moment}`),
    textHash: hash(textOf(message)),
  };
}

const isFeeling = (value: unknown): value is Feeling => FEELINGS.includes(value as Feeling);
const isStrength = (value: unknown): value is Strength => STRENGTHS.includes(value as Strength);

/** The lines, each said the way `said` gives for its number, or plainly. */
function directed(lines: Line[], said: (n: number) => { feeling?: Feeling; strength?: Strength }): SceneLine[] {
  return lines.map((line, at) => {
    const how = said(at + 1);
    return {
      ...line,
      feeling: how.feeling ?? (line.action ? "narration" : "neutral"),
      strength: how.strength ?? 2,
    };
  });
}

/** Claude's answer as a sheet. Whatever is missing or unknown is said plainly; nothing is refused. */
export function sheetOf(raw: unknown, lines: Line[]): SceneSheet {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, LIMITS.sceneField) : "");
  const people: ScenePerson[] = (Array.isArray(fields.people) ? fields.people : [])
    .slice(0, LIMITS.scenePeople)
    .map((entry) => {
      const person = (entry ?? {}) as Record<string, unknown>;
      return {
        name: str(person.name),
        appearance: str(person.appearance),
        clothes: str(person.clothes),
        action: str(person.action),
        mood: str(person.mood),
      };
    });
  const said = new Map<number, { feeling?: Feeling; strength?: Strength }>();
  for (const entry of Array.isArray(fields.lines) ? fields.lines : []) {
    const line = (entry ?? {}) as Record<string, unknown>;
    if (typeof line.line !== "number") continue;
    said.set(line.line, {
      feeling: isFeeling(line.feeling) ? line.feeling : undefined,
      strength: isStrength(line.strength) ? line.strength : undefined,
    });
  }
  return {
    place: str(fields.place),
    time: str(fields.time),
    weather: str(fields.weather),
    light: str(fields.light),
    people,
    lines: directed(lines, (n) => said.get(n) ?? {}),
  };
}

/**
 * A sheet you corrected, checked. Its lines stay the reply's own words, as Valhalla 2 cuts them:
 * only how each is said can change.
 */
export function correctedSheet(body: unknown, lines: Line[]): SceneSheet {
  const fields = object(body);
  const field = (value: unknown, what: string) => text(value ?? "", LIMITS.sceneField, what);
  const people = fields.people ?? [];
  if (!Array.isArray(people)) invalid("The people aren't valid");
  if (people.length > LIMITS.scenePeople) invalid(`${LIMITS.scenePeople} people at most`);
  const given = fields.lines ?? [];
  if (!Array.isArray(given) || given.length !== lines.length) {
    invalid("The lines don't match the reply any more. Read the moment again.");
  }
  return {
    place: field(fields.place, "The place"),
    time: field(fields.time, "The time"),
    weather: field(fields.weather, "The weather"),
    light: field(fields.light, "The light"),
    people: people.map((entry) => {
      const person = object(entry);
      return {
        name: field(person.name, "A name"),
        appearance: field(person.appearance, "A look"),
        clothes: field(person.clothes, "The clothes"),
        action: field(person.action, "What someone is doing"),
        mood: field(person.mood, "A mood"),
      };
    }),
    lines: directed(lines, (n) => {
      const line = object(given[n - 1]);
      if (!isFeeling(line.feeling)) invalid("A line's feeling isn't valid");
      if (!isStrength(line.strength)) invalid("A line's strength isn't valid");
      return { feeling: line.feeling, strength: line.strength };
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

const viewOf = (row: Row): SceneView => ({
  messageId: row.message_id,
  sheet: JSON.parse(row.sheet) as SceneSheet,
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
  read: SceneReader;
  /** The Claude model that reads moments. */
  model: string;
}

export function createScenes({ db, read, model }: ScenesOptions) {
  /** Readings under way, so a picture and reading aloud asking at once pay once. */
  const underway = new Map<string, Promise<SceneView>>();

  const kept = (messageId: number): Row | undefined =>
    db.prepare("SELECT * FROM scenes WHERE message_id = ?").get(messageId) as Row | undefined;

  async function ask(messageId: number, request: MomentRequest): Promise<SceneView> {
    const answer = await read(
      { system: request.system, background: request.background, moment: request.moment },
      model,
    );
    const sheet = sheetOf(answer.raw, request.lines);
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
      // The message was deleted with its chat while Claude was reading it.
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
      const sheet = correctedSheet(body, request.lines);
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
