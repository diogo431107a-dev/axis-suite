// The kept tags of replies (`tones`): how each line of a reply is said when it is read aloud with
// feeling. Worked out the first time the reply is read so, and kept.
//
// A reading holds while the reply's own words and the tone instructions are what it was read
// from. Unlike the scene, the chat before the reply changing doesn't count: a new reading would
// mean reading the reply aloud again, at Azure's price. One you corrected stays as you left it
// until the reply's own words change, since its lines would no longer match. "Read it again" asks
// afresh.
import type { DatabaseSync } from "node:sqlite";
import {
  FEELINGS,
  STRENGTHS,
  type Effort,
  type Feeling,
  type Strength,
  type ToneLine,
  type ToneView,
} from "../../shared/protocol.ts";
import { object } from "../check.ts";
import { invalid, notFound } from "../errors.ts";
import type { Reader } from "../reading.ts";
import type { Line } from "../scene/lines.ts";
import { hashOf, textOf, TONE_SCHEMA, type ToneRequest } from "./request.ts";

const isFeeling = (value: unknown): value is Feeling => FEELINGS.includes(value as Feeling);
const isStrength = (value: unknown): value is Strength => STRENGTHS.includes(value as Strength);

/** The lines, each said the way `said` gives for its number, or plainly. */
export function directed(
  lines: readonly Line[],
  said: (n: number) => { feeling?: Feeling; strength?: Strength },
): ToneLine[] {
  return lines.map((line, at) => {
    const how = said(at + 1);
    return {
      ...line,
      feeling: how.feeling ?? (line.action ? "narration" : "neutral"),
      strength: how.strength ?? 2,
    };
  });
}

/** The model's answer as lines. Whatever is missing or unknown is said plainly; nothing is refused. */
export function tonesOf(raw: unknown, lines: readonly Line[]): ToneLine[] {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const said = new Map<number, { feeling?: Feeling; strength?: Strength }>();
  for (const entry of Array.isArray(fields.lines) ? fields.lines : []) {
    const line = (entry ?? {}) as Record<string, unknown>;
    if (typeof line.line !== "number") continue;
    said.set(line.line, {
      feeling: isFeeling(line.feeling) ? line.feeling : undefined,
      strength: isStrength(line.strength) ? line.strength : undefined,
    });
  }
  return directed(lines, (n) => said.get(n) ?? {});
}

/** Lines you corrected, checked. The words stay the reply's own: only how each is said changes. */
export function correctedTones(body: unknown, lines: readonly Line[]): ToneLine[] {
  const given = object(body).lines;
  if (!Array.isArray(given) || given.length !== lines.length) {
    invalid("The lines don't match the reply any more. Read it again.");
  }
  return directed(lines, (n) => {
    const line = object(given[n - 1]);
    if (!isFeeling(line.feeling)) invalid("A line's feeling isn't valid");
    if (!isStrength(line.strength)) invalid("A line's strength isn't valid");
    return { feeling: line.feeling, strength: line.strength };
  });
}

interface Row {
  message_id: number;
  prompt_hash: string;
  text_hash: string;
  lines: string;
  model: string;
  effort: string;
  cost: number | null;
  request: string;
  created_at: string;
  edited_at: string | null;
}

const viewOf = (row: Row): ToneView => ({
  messageId: row.message_id,
  lines: JSON.parse(row.lines) as ToneLine[],
  edited: row.edited_at !== null,
  model: row.model,
  effort: row.effort as Effort,
  cost: row.cost,
  request: JSON.parse(row.request) as ToneView["request"],
  createdAt: row.created_at,
});

/** Whether a kept reading still holds for this request. */
const holds = (row: Row, request: ToneRequest): boolean =>
  row.text_hash === request.textHash && (row.prompt_hash === request.promptHash || row.edited_at !== null);

export function createTones({ db, read }: { db: DatabaseSync; read: Reader }) {
  /** Readings under way, so the speaker and the dialog asking at once pay once. */
  const underway = new Map<string, Promise<ToneView>>();

  const kept = (messageId: number): Row | undefined =>
    db.prepare("SELECT * FROM tones WHERE message_id = ?").get(messageId) as Row | undefined;

  async function ask(messageId: number, request: ToneRequest): Promise<ToneView> {
    const answer = await read({
      provider: request.provider,
      model: request.model,
      effort: request.effort,
      system: request.system,
      background: request.background,
      moment: request.moment,
      schema: TONE_SCHEMA as unknown as Record<string, unknown>,
      name: "tone",
      what: "this reply",
      cacheKey: request.cacheKey,
    });
    const lines = tonesOf(answer.raw, request.lines);
    const sent = { system: request.system, prompt: `${request.background}\n\n${request.moment}` };
    try {
      db.prepare(
        `INSERT OR REPLACE INTO tones
           (message_id, prompt_hash, text_hash, lines, model, effort, cost, request, created_at, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        messageId,
        request.promptHash,
        request.textHash,
        JSON.stringify(lines),
        answer.model,
        request.effort,
        answer.cost,
        JSON.stringify(sent),
        new Date().toISOString(),
      );
    } catch (err) {
      // The reply was deleted with its chat while it was being read.
      if (String((err as Error).message).includes("FOREIGN KEY")) notFound("message");
      throw err;
    }
    return viewOf(kept(messageId)!);
  }

  return {
    /** The kept reading while it still holds, or null. Nothing is asked. */
    peek(messageId: number, request: ToneRequest): ToneView | null {
      const row = kept(messageId);
      return row && holds(row, request) ? viewOf(row) : null;
    },

    /** The reading of a reply: the kept one while it holds, otherwise a new one. `fresh` always asks. */
    of(messageId: number, request: ToneRequest, fresh = false): Promise<ToneView> {
      const row = kept(messageId);
      if (!fresh && row && holds(row, request)) return Promise.resolve(viewOf(row));
      const key = `${messageId}:${request.textHash}:${request.promptHash}:${fresh ? "fresh" : ""}`;
      let reading = underway.get(key);
      if (!reading) {
        reading = ask(messageId, request).finally(() => underway.delete(key));
        underway.set(key, reading);
      }
      return reading;
    },

    /** Keeps your correction of a reading, which has to exist and still match the reply. */
    save(messageId: number, request: ToneRequest, body: unknown): ToneView {
      const row = kept(messageId);
      if (!row || row.text_hash !== request.textHash) invalid("Read the reply again before correcting it");
      const lines = correctedTones(body, request.lines);
      db.prepare("UPDATE tones SET lines = ?, edited_at = ? WHERE message_id = ?").run(
        JSON.stringify(lines),
        new Date().toISOString(),
        messageId,
      );
      return viewOf(kept(messageId)!);
    },

    /** The replies of a chat whose kept reading still matches their words. */
    keptIn(chatId: string): number[] {
      const rows = db
        .prepare(
          `SELECT t.message_id AS id, t.text_hash AS hash, m.content AS content
             FROM tones t JOIN messages m ON m.id = t.message_id
            WHERE m.chat_id = ? AND m.deleted_at IS NULL`,
        )
        .all(chatId) as { id: number; hash: string; content: string }[];
      return rows
        .filter((row) => hashOf(textOf({ content: JSON.parse(row.content) as ToneLineContent })) === row.hash)
        .map((row) => row.id);
    },
  };
}

type ToneLineContent = Parameters<typeof textOf>[0]["content"];

export type Tones = ReturnType<typeof createTones>;
