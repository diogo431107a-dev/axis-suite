// Replies read aloud. A reply is read by the voice engine its voice belongs to (engine.ts: Azure,
// or Grok for a `grok:` voice) the first time it is asked for, and the audio is kept as a file (in
// its own folder, see files.ts), so playing it again is instant and costs nothing. An edited reply,
// or another voice, is read again, and the old audio is deleted. Each companion may have its own
// voice; one that names none is read in the server's. A reply is read with the feeling of each line
// when its tags have been worked out (direct.ts, grokTags.ts), and is read again when that changes,
// or when its companion's speed, pitch or speaking style does, as far as its engine reads them.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  blockText,
  DEFAULT_TUNING,
  engineOfVoice,
  isDefaultTuning,
  type Feeling,
  type Message,
  type SpeechEngine,
  type ToneLine,
  type Voice,
  type VoiceTuning,
} from "../../shared/protocol.ts";
import { STATE_DIR, transaction } from "../db.ts";
import { invalid, notFound } from "../errors.ts";
import type { FileStore } from "../files.ts";
import { linesOf } from "../scene/lines.ts";
import type { VoiceEngine } from "./engine.ts";
import { spokenText } from "./text.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const SPEECH_DIR = resolve(STATE_DIR, "speech");

/** What a kept audio file is called: `<message id>-<16 hex>.<the engine's ending>`. */
export const SPEECH_FILE = /^[0-9]{1,15}-[0-9a-f]{16}\.(mp3|ogg|wav)$/;

/** This month, as `speech_usage` keys it. */
const monthOf = (when: Date): string => when.toISOString().slice(0, 7);

export interface Spoken {
  file: string;
  /** The engine that read it. */
  engine: SpeechEngine;
  /** Characters the engine read for it; 0 when it was already kept. */
  read: number;
}

/** A sample read aloud, and what its audio is. */
export interface Sample {
  audio: Uint8Array;
  type: string;
}

export interface SpeechOptions {
  db: DatabaseSync;
  /** What reads the replies: each engine the server has a key for. */
  engines: Partial<Record<SpeechEngine, VoiceEngine>>;
  files: FileStore;
  /** The voice a reply is read in when its companion names none. */
  voice: string;
}

/** How long each engine's list of voices is kept before it is asked again. */
const VOICES_MS = 24 * 60 * 60_000;
/** How many tried voices are kept in memory, so trying the same one again costs nothing. */
const SAMPLES_KEPT = 20;

/** Why a voice can't be read: its engine has no key on this server. */
const MISSING: Readonly<Record<SpeechEngine, string>> = {
  azure: "This Valhalla 2 has no Azure Speech key, so it can't read in Azure's voices",
  grok: "This Valhalla 2 has no xAI key, so it can't read in Grok's voices",
};

export function createSpeech({ db, engines, files, voice: serverVoice }: SpeechOptions) {
  /** Readings under way, so asking twice for the same one pays once. */
  const underway = new Map<string, Promise<Spoken>>();
  const voiceLists = new Map<SpeechEngine, { at: number; voices: Promise<Voice[]> }>();
  const samples = new Map<string, Promise<Uint8Array>>();
  const available = Object.values(engines);

  /** The engine that reads `voice`, or a refusal when the server has no key for it. */
  const engineFor = (voice: string): VoiceEngine =>
    engines[engineOfVoice(voice)] ?? invalid(MISSING[engineOfVoice(voice)]);

  /** Adds what an engine was asked to read to this month's count. */
  const count = (engine: SpeechEngine, chars: number) =>
    db
      .prepare(
        `INSERT INTO speech_usage (month, engine, chars) VALUES (?, ?, ?)
         ON CONFLICT (month, engine) DO UPDATE SET chars = chars + excluded.chars`,
      )
      .run(monthOf(new Date()), engine, chars);

  /** One engine's voices, asked once a day. A failed ask is tried again next time. */
  function voicesOf(engine: VoiceEngine): Promise<Voice[]> {
    const kept = voiceLists.get(engine.id);
    if (kept && Date.now() - kept.at <= VOICES_MS) return kept.voices;
    const asked = engine.voices();
    voiceLists.set(engine.id, { at: Date.now(), voices: asked });
    asked.catch(() => {
      if (voiceLists.get(engine.id)?.voices === asked) voiceLists.delete(engine.id);
    });
    return asked;
  }

  /**
   * Every voice the engines offer, Grok's first. An engine that can't be reached is left out, and
   * said in the log; only when none can be is the first failure the answer.
   */
  async function voices(): Promise<Voice[]> {
    const ordered = [...available].sort((a, b) => (a.id === "grok" ? -1 : b.id === "grok" ? 1 : 0));
    const lists = await Promise.allSettled(ordered.map(voicesOf));
    const found = lists.flatMap((list) => (list.status === "fulfilled" ? list.value : []));
    const failed = lists.flatMap((list) => (list.status === "rejected" ? [list.reason as Error] : []));
    for (const err of failed) console.warn("A voice engine's list couldn't be had:", err.message);
    if (failed.length === lists.length && failed[0]) throw failed[0];
    return found;
  }

  /** The voice's own styles, from its engine's list; none when the list can't be had. */
  async function stylesOf(engine: VoiceEngine, voice: string): Promise<string[]> {
    try {
      return (await voicesOf(engine)).find((one) => one.id === voice)?.styles ?? [];
    } catch {
      return [];
    }
  }

  /** The part of a tuning `engine` reads. */
  const tuneFor = (engine: VoiceEngine, tuning: VoiceTuning): VoiceTuning => engine.tune?.(tuning) ?? tuning;

  /**
   * The audio of `lines` in `voice`: each said its way, or the words plainly when no line has a way;
   * at the tuning's speed and pitch, and in its style if the voice has that style.
   */
  async function audioFor(
    engine: VoiceEngine,
    voice: string,
    lines: readonly ToneLine[] | null,
    text: string,
    tuning: VoiceTuning,
  ): Promise<Uint8Array> {
    const styles = lines || tuning.style ? await stylesOf(engine, voice) : [];
    const fit = tuning.style && !styles.includes(tuning.style) ? { ...tuning, style: null } : tuning;
    return engine.read({ voice, text, lines, tuning: fit, styles });
  }

  /**
   * What the hash adds for the engine: nothing for Azure, which read everything kept before engines
   * had names, so that audio stays.
   */
  const engineTag = (engine: VoiceEngine): string => (engine.id === "azure" ? "" : `${engine.id}\n`);

  /** What the hash adds for a tuning; nothing for the voice as it comes, so audio kept before stays. */
  const tuned = (tuning: VoiceTuning): string =>
    isDefaultTuning(tuning) ? "" : `\n${JSON.stringify([tuning.rate, tuning.pitch, tuning.style])}`;

  /** What the hash adds for the lines: a sound only on a line that has one, so audio kept before stays. */
  const directed = (lines: readonly ToneLine[] | null): string =>
    lines
      ? `\n${JSON.stringify(
          lines.map((line) =>
            line.sound
              ? [line.text, line.feeling, line.strength, line.sound]
              : [line.text, line.feeling, line.strength],
          ),
        )}`
      : "";

  async function read(
    engine: VoiceEngine,
    message: Message,
    voice: string,
    audio: Uint8Array,
    chars: number,
    hash: string,
  ): Promise<Spoken> {
    const file = files.write(`${message.id}-${hash.slice(0, 16)}`, engine.format.ext, audio);
    let replaced: string[];
    try {
      replaced = transaction(db, () => {
        const old = db.prepare("DELETE FROM speech WHERE message_id = ? RETURNING file").all(message.id) as {
          file: string;
        }[];
        db.prepare(
          `INSERT INTO speech (message_id, voice, text_hash, file, bytes, chars, created_at, engine)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(message.id, voice, hash, file, audio.length, chars, new Date().toISOString(), engine.id);
        count(engine.id, chars);
        return old.map((row) => row.file).filter((name) => name !== file);
      });
    } catch (err) {
      // The message was deleted with its chat while the engine was reading it.
      files.remove(file);
      if (String((err as Error).message).includes("FOREIGN KEY")) notFound("message");
      throw err;
    }
    for (const name of replaced) files.remove(name);
    return { file, engine: engine.id, read: chars };
  }

  return {
    voice: serverVoice,

    /**
     * The kept audio of a reply, read now in `voice` if it isn't kept yet: with `lines`, each said
     * the way its tags say (direct.ts, grokTags.ts), otherwise plainly, at the tuning's speed, pitch
     * and style. Another way of saying it is another reading. Whose message it is, and that it is
     * still there, is the caller's to check.
     */
    async of(
      message: Message,
      voice: string = serverVoice,
      lines: readonly ToneLine[] | null = null,
      tuning: VoiceTuning = DEFAULT_TUNING,
    ): Promise<Spoken> {
      if (message.role !== "assistant") invalid("Only a companion's replies are read aloud");
      const engine = engineFor(voice);
      const text = spokenText(message.content.map(blockText).join(""));
      if (!text) invalid("This reply has nothing to read aloud");
      const fit = tuneFor(engine, tuning);
      const hash = createHash("sha256")
        .update(`${engineTag(engine)}${voice}\n${text}${directed(lines)}${tuned(fit)}`)
        .digest("hex");

      const kept = db
        .prepare("SELECT file FROM speech WHERE message_id = ? AND voice = ? AND text_hash = ?")
        .get(message.id, voice, hash) as { file: string } | undefined;
      if (kept) return { file: kept.file, engine: engine.id, read: 0 };

      const key = `${message.id}:${hash}`;
      let reading = underway.get(key);
      if (!reading) {
        const chars = lines ? lines.reduce((sum, line) => sum + [...line.text].length, 0) : [...text].length;
        reading = audioFor(engine, voice, lines, text, fit)
          .then((audio) => read(engine, message, voice, audio, chars, hash))
          .finally(() => underway.delete(key));
        underway.set(key, reading);
      }
      return reading;
    },

    voices,

    /**
     * `text` read in `voice` with `tuning`, to hear it before choosing it: plainly, or every line
     * with `feeling`.
     * Not kept as a file: the last few are kept in memory, and the characters count like any other
     * reading.
     */
    async sample(
      voice: string,
      text: string,
      feeling: Feeling | null = null,
      tuning: VoiceTuning = DEFAULT_TUNING,
    ): Promise<Sample> {
      const engine = engineFor(voice);
      const spoken = spokenText(text);
      if (!spoken) invalid("Write something for the voice to read");
      const fit = tuneFor(engine, tuning);
      const key = createHash("sha256")
        .update(`${engineTag(engine)}${voice}\n${feeling ?? ""}\n${spoken}${tuned(fit)}`)
        .digest("hex");
      let audio = samples.get(key);
      if (!audio) {
        const lines = feeling ? linesOf(text).map((line) => ({ ...line, feeling, strength: 2 as const })) : null;
        audio = audioFor(engine, voice, lines, spoken, fit).then((bytes) => {
          count(engine.id, [...spoken].length);
          return bytes;
        });
        audio.catch(() => samples.delete(key));
        samples.set(key, audio);
        while (samples.size > SAMPLES_KEPT) samples.delete(samples.keys().next().value!);
      }
      return { audio: await audio, type: engine.format.type };
    },
  };
}

export type Speech = ReturnType<typeof createSpeech>;

/** How many characters `engine` was asked to read this month, for everyone. */
export function charsThisMonth(db: DatabaseSync, engine: SpeechEngine, now: Date = new Date()): number {
  const row = db.prepare("SELECT chars FROM speech_usage WHERE month = ? AND engine = ?").get(monthOf(now), engine) as
    { chars: number } | undefined;
  return row?.chars ?? 0;
}

/** Whether `file` reads a message of one of `owner`'s companions. */
export function ownsSpeech(db: DatabaseSync, owner: string, file: string): boolean {
  if (!SPEECH_FILE.test(file)) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM speech s JOIN messages m ON m.id = s.message_id JOIN chats c ON c.id = m.chat_id
       JOIN companions o ON o.id = c.companion_id WHERE s.file = ? AND o.owner = ?`,
    )
    .get(file, owner);
  return row !== undefined;
}

/** The audio files of a chat, or of every chat of a companion, to delete along with it. */
export function speechFilesOf(db: DatabaseSync, where: { chatId: string } | { companionId: string }): string[] {
  const rows =
    "chatId" in where
      ? db
          .prepare("SELECT s.file FROM speech s JOIN messages m ON m.id = s.message_id WHERE m.chat_id = ?")
          .all(where.chatId)
      : db
          .prepare(
            `SELECT s.file FROM speech s JOIN messages m ON m.id = s.message_id JOIN chats c ON c.id = m.chat_id
             WHERE c.companion_id = ?`,
          )
          .all(where.companionId);
  return (rows as { file: string }[]).map((row) => row.file);
}

/**
 * Forgets the audio of a chat's deleted messages and returns its files, for the caller to delete.
 * A deleted message stays in the database, marked; its audio has no reason to.
 */
export function forgetDeletedSpeech(db: DatabaseSync, chatId: string): string[] {
  const rows = db
    .prepare(
      `DELETE FROM speech WHERE message_id IN
         (SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NOT NULL) RETURNING file`,
    )
    .all(chatId) as { file: string }[];
  return rows.map((row) => row.file);
}

/** Every file a reading names, so the rest can be swept away. */
export function knownSpeechFiles(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT file FROM speech").all() as { file: string }[];
  return new Set(rows.map((row) => row.file));
}
