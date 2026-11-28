// Makes pictures in the background. A request to make one answers at once with a "working"
// picture; this then asks the picture engine (engine.ts: CivitAI) for it, waits, downloads it, and
// marks it done or failed. The page looks at the picture every few seconds until then.
import type { DatabaseSync } from "node:sqlite";
import { EngineError, type EngineJob, type PictureEngine } from "./engine.ts";
import type { FileStore } from "../files.ts";
import { jobOf, markDone, markFailed, setWorkflow, unfinished } from "./store.ts";

export interface PainterOptions {
  db: DatabaseSync;
  engine: PictureEngine;
  files: FileStore;
}

export function createPainter({ db, engine, files }: PainterOptions) {
  /** Takes a picture from asking (or from a job already asked for) to done or failed. */
  async function paint(id: string, jobId: string | null): Promise<void> {
    try {
      let job: EngineJob | string;
      if (jobId) {
        job = jobId;
      } else {
        const order = jobOf(db, id);
        if (!order) return;
        job = await engine.submit(order);
        setWorkflow(db, id, job.id, engine.id);
      }
      const url = await engine.finish(job);
      const { bytes, ext } = await engine.download(url);
      const file = files.write(id, ext, bytes);
      // Deleted while it was being made: nothing names the file, so it goes too.
      if (!markDone(db, id, file, bytes.length)) files.remove(file);
    } catch (err) {
      const message = err instanceof EngineError ? err.message : "Something went wrong making the picture";
      if (!(err instanceof EngineError)) console.error(`Picture ${id} failed:`, err);
      markFailed(db, id, message);
    }
  }

  return {
    paint,
    engine,

    /** Picks up the pictures the server was stopped in the middle of. Returns how many. */
    resume(): number {
      const left = unfinished(db);
      for (const { id, workflowId, engine: madeBy } of left) {
        if (workflowId && madeBy === engine.id) void paint(id, workflowId);
        else if (workflowId) markFailed(db, id, "This picture was asked of another picture engine. Make it again.");
        else markFailed(db, id, "The server stopped before this picture was asked for. Make it again.");
      }
      return left.length;
    },
  };
}

export type Painter = ReturnType<typeof createPainter>;
