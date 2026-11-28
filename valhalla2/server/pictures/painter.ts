// Makes pictures in the background. A request to make one answers at once with a "working"
// picture; this then asks the picture's engine (engine.ts: CivitAI or Grok Imagine) for it, waits
// or not, keeps it, and marks it done or failed. The page looks at the picture every few seconds
// until then.
import type { DatabaseSync } from "node:sqlite";
import { PICTURE_ENGINE_LABELS, type PictureEngineId } from "../../shared/protocol.ts";
import { EngineError, type EngineJob, type PictureEngine } from "./engine.ts";
import type { FileStore } from "../files.ts";
import { jobOf, markDone, markFailed, setWorkflow, unfinished } from "./store.ts";

export interface PainterOptions {
  db: DatabaseSync;
  /** The engines the server has keys for. */
  engines: Partial<Record<PictureEngineId, PictureEngine>>;
  files: FileStore;
}

export function createPainter({ db, engines, files }: PainterOptions) {
  /** Keeps a finished picture. Deleted while it was being made: nothing names the file, so it goes too. */
  function keep(id: string, bytes: Uint8Array, ext: string, cost: number | null): void {
    const file = files.write(id, ext, bytes);
    if (!markDone(db, id, file, bytes.length, cost)) files.remove(file);
  }

  /** Takes a picture from asking (or from a job already asked for) to done or failed. */
  async function paint(id: string, jobId: string | null): Promise<void> {
    try {
      const order = jobOf(db, id);
      if (!order) return;
      const engine = engines[order.engine];
      if (!engine) {
        markFailed(db, id, `This Valhalla 2 has no key for ${PICTURE_ENGINE_LABELS[order.engine]} any more.`);
        return;
      }
      let job: EngineJob | string;
      if (jobId) {
        job = jobId;
      } else {
        const asked = await engine.submit(order);
        if ("image" in asked) {
          keep(id, asked.image.bytes, asked.image.ext, asked.image.cost);
          return;
        }
        job = asked.job;
        setWorkflow(db, id, job.id, engine.id);
      }
      const url = await engine.finish(job);
      const { bytes, ext } = await engine.download(url);
      keep(id, bytes, ext, null);
    } catch (err) {
      const message = err instanceof EngineError ? err.message : "Something went wrong making the picture";
      if (!(err instanceof EngineError)) console.error(`Picture ${id} failed:`, err);
      markFailed(db, id, message);
    }
  }

  return {
    paint,
    /** The engines this painter has, by id. */
    engines,
    /** Their ids, in the order the page lists them. */
    available: (Object.keys(engines) as PictureEngineId[]).sort(),

    /** Picks up the pictures the server was stopped in the middle of. Returns how many. */
    resume(): number {
      const left = unfinished(db);
      for (const { id, workflowId, engine: madeBy } of left) {
        const engine = engines[madeBy as PictureEngineId];
        if (workflowId && engine && engine.id === madeBy) void paint(id, workflowId);
        else if (workflowId) markFailed(db, id, "This picture was asked of another picture engine. Make it again.");
        else if (madeBy === "grok") {
          markFailed(db, id, "The server stopped while Grok Imagine was making this picture. Make it again.");
        } else markFailed(db, id, "The server stopped before this picture was asked for. Make it again.");
      }
      return left.length;
    },
  };
}

export type Painter = ReturnType<typeof createPainter>;
