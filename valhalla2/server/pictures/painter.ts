// Makes pictures in the background. A request to make one answers at once with a "working"
// picture; this then asks CivitAI for it, waits, downloads it, and marks it done or failed. The
// page looks at the picture every few seconds until then.
import type { DatabaseSync } from "node:sqlite";
import { CivitaiError, type Civitai, type Workflow } from "./civitai.ts";
import type { FileStore } from "../files.ts";
import { jobOf, markDone, markFailed, setWorkflow, unfinished } from "./store.ts";

export interface PainterOptions {
  db: DatabaseSync;
  civitai: Civitai;
  files: FileStore;
}

export function createPainter({ db, civitai, files }: PainterOptions) {
  /** Takes a picture from asking (or from a workflow already asked for) to done or failed. */
  async function paint(id: string, workflowId: string | null): Promise<void> {
    try {
      let workflow: Workflow | string;
      if (workflowId) {
        workflow = workflowId;
      } else {
        const job = jobOf(db, id);
        if (!job) return;
        workflow = await civitai.submit({ prompt: job.prompt, negativePrompt: job.negativePrompt, ...job.params });
        setWorkflow(db, id, workflow.id);
      }
      const url = await civitai.finish(workflow);
      const { bytes, ext } = await civitai.download(url);
      const file = files.write(id, ext, bytes);
      // Deleted while it was being made: nothing names the file, so it goes too.
      if (!markDone(db, id, file, bytes.length)) files.remove(file);
    } catch (err) {
      const message = err instanceof CivitaiError ? err.message : "Something went wrong making the picture";
      if (!(err instanceof CivitaiError)) console.error(`Picture ${id} failed:`, err);
      markFailed(db, id, message);
    }
  }

  return {
    paint,

    /** Picks up the pictures the server was stopped in the middle of. Returns how many. */
    resume(): number {
      const left = unfinished(db);
      for (const { id, workflowId } of left) {
        if (workflowId) void paint(id, workflowId);
        else markFailed(db, id, "The server stopped before this picture was asked for. Make it again.");
      }
      return left.length;
    },
  };
}

export type Painter = ReturnType<typeof createPainter>;
