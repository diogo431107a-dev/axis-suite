// What Valhalla 2 knows about each picture: whose it is, what it was made from, and how far along
// it is. The bytes are files (../files.ts); the painter (painter.ts) moves a picture from "working"
// to "done" or "failed".
import type { DatabaseSync } from "node:sqlite";
import {
  LIMITS,
  type Orientation,
  type Picture,
  type PictureDraft,
  type PictureKind,
  type PictureParams,
} from "../../shared/protocol.ts";
import { notFound, StoreError, tooMany } from "../errors.ts";

interface Row {
  id: string;
  companion_id: string;
  kind: PictureKind;
  chat_id: string | null;
  chat_title: string | null;
  message_id: number | null;
  prompt: string;
  negative_prompt: string;
  orientation: Orientation;
  caption: string;
  params: string;
  status: Picture["status"];
  error: string | null;
  created_at: string;
}

const SELECT = `SELECT p.id, p.companion_id, p.kind, p.chat_id, c.title AS chat_title, p.message_id, p.prompt,
                       p.negative_prompt, p.orientation, p.caption, p.params, p.status, p.error, p.created_at
                FROM pictures p LEFT JOIN chats c ON c.id = p.chat_id`;

const pictureOf = (row: Row): Picture => ({
  id: row.id,
  companionId: row.companion_id,
  kind: row.kind,
  chatId: row.chat_id,
  chatTitle: row.chat_title,
  messageId: row.message_id,
  prompt: row.prompt,
  negativePrompt: row.negative_prompt,
  orientation: row.orientation,
  caption: row.caption,
  params: JSON.parse(row.params) as PictureParams,
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
});

export interface NewPicture extends PictureDraft {
  id: string;
  companionId: string;
  kind: PictureKind;
  chatId: string | null;
  messageId: number | null;
  params: PictureParams;
}

/** One person's pictures. The companion and chat a new one names are checked by the caller. */
export function createPictures(db: DatabaseSync, owner: string) {
  function get(id: string): Picture {
    const row = db
      .prepare(`${SELECT} JOIN companions o ON o.id = p.companion_id WHERE p.id = ? AND o.owner = ?`)
      .get(id, owner) as Row | undefined;
    return row ? pictureOf(row) : notFound("picture");
  }

  return {
    get,

    /** A companion's pictures, newest first. */
    of(companionId: string): Picture[] {
      const rows = db
        .prepare(
          `${SELECT} JOIN companions o ON o.id = p.companion_id
           WHERE p.companion_id = ? AND o.owner = ? ORDER BY p.created_at DESC, p.id`,
        )
        .all(companionId, owner) as unknown as Row[];
      return rows.map(pictureOf);
    },

    /** Records a picture about to be made. */
    create(picture: NewPicture): Picture {
      const { count } = db
        .prepare("SELECT count(*) AS count FROM pictures WHERE companion_id = ?")
        .get(picture.companionId) as { count: number };
      if (count >= LIMITS.pictures) tooMany(`Valhalla 2 keeps ${LIMITS.pictures} pictures of a companion at most`);
      const { working } = db
        .prepare(
          `SELECT count(*) AS working FROM pictures p JOIN companions o ON o.id = p.companion_id
           WHERE o.owner = ? AND p.status = 'working'`,
        )
        .get(owner) as { working: number };
      if (working >= LIMITS.picturesAtOnce) {
        throw new StoreError(
          409,
          `${LIMITS.picturesAtOnce} pictures are already being made. Wait for one to finish.`,
          "busy",
        );
      }
      db.prepare(
        `INSERT INTO pictures (id, companion_id, kind, chat_id, message_id, prompt, negative_prompt, orientation,
                               caption, params, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
      ).run(
        picture.id,
        picture.companionId,
        picture.kind,
        picture.chatId,
        picture.messageId,
        picture.prompt,
        picture.negativePrompt,
        picture.orientation,
        picture.caption,
        JSON.stringify(picture.params),
        new Date().toISOString(),
      );
      return get(picture.id);
    },

    /** The file of a finished picture, or null when it has none (yet). */
    fileOf(id: string): string | null {
      get(id);
      const row = db.prepare("SELECT file FROM pictures WHERE id = ? AND status = 'done'").get(id) as
        { file: string | null } | undefined;
      return row?.file ?? null;
    },

    /** Deletes a picture and returns its file's name, for the caller to delete too. */
    remove(id: string): string | null {
      get(id);
      const row = db.prepare("DELETE FROM pictures WHERE id = ? RETURNING file").get(id) as { file: string | null };
      return row.file;
    },

    /** The files of a companion's pictures, to delete along with it. */
    filesOf(companionId: string): string[] {
      const rows = db
        .prepare(
          `SELECT p.file FROM pictures p JOIN companions o ON o.id = p.companion_id
           WHERE p.companion_id = ? AND o.owner = ? AND p.file IS NOT NULL`,
        )
        .all(companionId, owner) as { file: string }[];
      return rows.map((row) => row.file);
    },
  };
}

export type Pictures = ReturnType<typeof createPictures>;

/** The pictures made from any of these messages of a chat, oldest first. Ownership is the caller's. */
export function picturesOn(db: DatabaseSync, chatId: string, messageIds: readonly number[]): Picture[] {
  if (messageIds.length === 0) return [];
  const rows = db
    .prepare(`${SELECT} WHERE p.chat_id = ? AND p.message_id IN (SELECT value FROM json_each(?)) ORDER BY p.created_at`)
    .all(chatId, JSON.stringify(messageIds)) as unknown as Row[];
  return rows.map(pictureOf);
}

// What the painter uses: it works on pictures by id, for whoever they belong to.

export interface Unfinished {
  id: string;
  /** The engine's id for the job, once it was asked; `workflow_id` from when only CivitAI made them. */
  workflowId: string | null;
  /** The engine it was asked of. */
  engine: string;
}

/** The pictures still being made, e.g. when the server was stopped in the middle of them. */
export function unfinished(db: DatabaseSync): Unfinished[] {
  const rows = db.prepare("SELECT id, workflow_id, engine FROM pictures WHERE status = 'working'").all() as {
    id: string;
    workflow_id: string | null;
    engine: string;
  }[];
  return rows.map((row) => ({ id: row.id, workflowId: row.workflow_id, engine: row.engine }));
}

/** What a picture is to be made from; null when it has been deleted meanwhile. */
export function jobOf(
  db: DatabaseSync,
  id: string,
): { prompt: string; negativePrompt: string; params: PictureParams } | null {
  const row = db.prepare("SELECT prompt, negative_prompt, params FROM pictures WHERE id = ?").get(id) as
    { prompt: string; negative_prompt: string; params: string } | undefined;
  return row ? { prompt: row.prompt, negativePrompt: row.negative_prompt, params: JSON.parse(row.params) } : null;
}

/** Keeps the engine's id for a picture's job, and which engine it was asked of. */
export function setWorkflow(db: DatabaseSync, id: string, workflowId: string, engine: string): void {
  db.prepare("UPDATE pictures SET workflow_id = ?, engine = ? WHERE id = ?").run(workflowId, engine, id);
}

/** Marks a picture done. False when it was deleted meanwhile, so its file has to go too. */
export function markDone(db: DatabaseSync, id: string, file: string, bytes: number): boolean {
  const { changes } = db
    .prepare(
      "UPDATE pictures SET status = 'done', file = ?, bytes = ?, error = NULL, finished_at = ? WHERE id = ? AND status = 'working'",
    )
    .run(file, bytes, new Date().toISOString(), id);
  return changes > 0;
}

export function markFailed(db: DatabaseSync, id: string, error: string): void {
  db.prepare(
    "UPDATE pictures SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'working'",
  ).run(error, new Date().toISOString(), id);
}

/** Every file a picture names, so the rest can be swept away. */
export function knownFiles(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT file FROM pictures WHERE file IS NOT NULL").all() as { file: string }[];
  return new Set(rows.map((row) => row.file));
}
