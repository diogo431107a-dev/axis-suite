// Replies read aloud. A reply is read by Azure the first time it is asked for, and the MP3 is kept
// as a file (in its own folder, see files.ts), so playing it again
// is instant and costs nothing. An edited reply, or another voice, is read again, and the old
// audio is deleted. Each companion may have its own voice; one that names none is read in the
// server's. A reply is read with the feeling of each line when the scene has worked it out
// (direct.ts), and is read again when that changes, or when its companion's speed, pitch or
// speaking style does.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  blockText,
  DEFAULT_TUNING,
  isDefaultTuning,
  type Feeling,
  type Message,
  type SceneLine,
  type Voice,
  type VoiceTuning,
} from "../../shared/protocol.ts";
import { STATE_DIR, transaction } from "../db.ts";
import { invalid, notFound } from "../errors.ts";
import type { FileStore } from "../files.ts";
import { linesOf } from "../scene/lines.ts";
import type { AzureSpeech } from "./azure.ts";
import { directedSsml } from "./direct.ts";
import { spokenText, ssmlOf } from "./text.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const SPEECH_DIR = resolve(STATE_DIR, "speech");

/** What a kept audio file is called: `<message id>-<16 hex>.mp3`. */
export const SPEECH_FILE = /^[0-9]{1,15}-[0-9a-f]{16}\.mp3$/;

/** This month, as `speech_usage` keys it. */
const monthOf = (when: Date): string => when.toISOString().slice(0, 7);

export interface Spoken {
  file: string;
  /** Characters Azure read for it; 0 when it was already kept. */
  read: number;
}

export interface SpeechOptions {
  db: DatabaseSync;
  azure: AzureSpeech;
  files: FileStore;
  /** The voice a reply is read in when its companion names none. */
  voice: string;
}

/** How long the list of voices is kept before Azure is asked again. */
const VOICES_MS = 24 * 60 * 60_000;
/** How many tried voices are kept in memory, so trying the same one again costs nothing. */
const SAMPLES_KEPT = 20;

export function createSpeech({ db, azure, files, voice: serverVoice }: SpeechOptions) {
  /** Readings under way, so asking twice for the same one pays once. */
  const underway = new Map<string, Promise<Spoken>>();
  let voiceList: { at: number; voices: Promise<Voice[]> } | null = null;
  const samples = new Map<string, Promise<Uint8Array>>();

  /** Adds what Azure was asked to read to this month's count. */
  const count = (chars: number) =>
    db
      .prepare(
        `INSERT INTO speech_usage (month, chars) VALUES (?, ?)
         ON CONFLICT (month) DO UPDATE SET chars = chars + excluded.chars`,
      )
      .run(monthOf(new Date()), chars);

  /** The voice's own styles, from Azure's list; none when the list can't be had. */
  async function stylesOf(voice: string): Promise<string[]> {
    try {
      return (await voices()).find((one) => one.id === voice)?.styles ?? [];
    } catch {
      return [];
    }
  }

  /** Every voice Azure offers, asked once a day. A failed ask is tried again next time. */
  function voices(): Promise<Voice[]> {
    if (!voiceList || Date.now() - voiceList.at > VOICES_MS) {
      const asked = azure.voices();
      voiceList = { at: Date.now(), voices: asked };
      asked.catch(() => {
        if (voiceList?.voices === asked) voiceList = null;
      });
    }
    return voiceList.voices;
  }

  /**
   * The SSML for `lines` in `voice`: each said its way, or the words plainly when no line has a way;
   * at the tuning's speed and pitch, and in its style if the voice has that style.
   */
  async function ssmlFor(
    voice: string,
    lines: readonly SceneLine[] | null,
    text: string,
    tuning: VoiceTuning,
  ): Promise<string> {
    const styles = lines || tuning.style ? await stylesOf(voice) : [];
    const fit = tuning.style && !styles.includes(tuning.style) ? { ...tuning, style: null } : tuning;
    return lines ? directedSsml(lines, voice, styles, fit) : ssmlOf(text, voice, fit);
  }

  /** What the hash adds for a tuning; nothing for the voice as it comes, so audio kept before stays. */
  const tuned = (tuning: VoiceTuning): string =>
    isDefaultTuning(tuning) ? "" : `\n${JSON.stringify([tuning.rate, tuning.pitch, tuning.style])}`;

  async function read(message: Message, voice: string, ssml: string, chars: number, hash: string): Promise<Spoken> {
    const audio = await azure.synthesize(ssml);
    const file = files.write(`${message.id}-${hash.slice(0, 16)}`, "mp3", audio);
    let replaced: string[];
    try {
      replaced = transaction(db, () => {
        const old = db.prepare("DELETE FROM speech WHERE message_id = ? RETURNING file").all(message.id) as {
          file: string;
        }[];
        db.prepare(
          `INSERT INTO speech (message_id, voice, text_hash, file, bytes, chars, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(message.id, voice, hash, file, audio.length, chars, new Date().toISOString());
        count(chars);
        return old.map((row) => row.file).filter((name) => name !== file);
      });
    } catch (err) {
      // The message was deleted with its chat while Azure was reading it.
      files.remove(file);
      if (String((err as Error).message).includes("FOREIGN KEY")) notFound("message");
      throw err;
    }
    for (const name of replaced) files.remove(name);
    return { file, read: chars };
  }

  return {
    voice: serverVoice,

    /**
     * The kept audio of a reply, read now in `voice` if it isn't kept yet: with `lines`, each said
     * the way the scene says (direct.ts), otherwise plainly, at the tuning's speed, pitch and style.
     * Another way of saying it is another reading. Whose message it is, and that it is still there,
     * is the caller's to check.
     */
    async of(
      message: Message,
      voice: string = serverVoice,
      lines: readonly SceneLine[] | null = null,
      tuning: VoiceTuning = DEFAULT_TUNING,
    ): Promise<Spoken> {
      if (message.role !== "assistant") invalid("Only a companion's replies are read aloud");
      const text = spokenText(message.content.map(blockText).join(""));
      if (!text) invalid("This reply has nothing to read aloud");
      const how = lines ? `\n${JSON.stringify(lines.map((line) => [line.text, line.feeling, line.strength]))}` : "";
      const hash = createHash("sha256")
        .update(`${voice}\n${text}${how}${tuned(tuning)}`)
        .digest("hex");

      const kept = db
        .prepare("SELECT file FROM speech WHERE message_id = ? AND voice = ? AND text_hash = ?")
        .get(message.id, voice, hash) as { file: string } | undefined;
      if (kept) return { file: kept.file, read: 0 };

      const key = `${message.id}:${hash}`;
      let reading = underway.get(key);
      if (!reading) {
        const chars = lines ? lines.reduce((sum, line) => sum + [...line.text].length, 0) : [...text].length;
        reading = ssmlFor(voice, lines, text, tuning)
          .then((ssml) => read(message, voice, ssml, chars, hash))
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
    sample(
      voice: string,
      text: string,
      feeling: Feeling | null = null,
      tuning: VoiceTuning = DEFAULT_TUNING,
    ): Promise<Uint8Array> {
      const spoken = spokenText(text);
      if (!spoken) invalid("Write something for the voice to read");
      const key = createHash("sha256")
        .update(`${voice}\n${feeling ?? ""}\n${spoken}${tuned(tuning)}`)
        .digest("hex");
      let audio = samples.get(key);
      if (!audio) {
        const lines = feeling ? linesOf(text).map((line) => ({ ...line, feeling, strength: 2 as const })) : null;
        audio = ssmlFor(voice, lines, spoken, tuning)
          .then((ssml) => azure.synthesize(ssml))
          .then((bytes) => {
            count([...spoken].length);
            return bytes;
          });
        audio.catch(() => samples.delete(key));
        samples.set(key, audio);
        while (samples.size > SAMPLES_KEPT) samples.delete(samples.keys().next().value!);
      }
      return audio;
    },
  };
}

export type Speech = ReturnType<typeof createSpeech>;

/** How many characters Azure was asked to read this month, for everyone. */
export function charsThisMonth(db: DatabaseSync, now: Date = new Date()): number {
  const row = db.prepare("SELECT chars FROM speech_usage WHERE month = ?").get(monthOf(now)) as
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
