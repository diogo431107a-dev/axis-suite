// A companion's memory: its files, their history, the runs of the memory model, its pins, and the
// backups.
import { Router, type Request, type Response } from "express";
import type { Companion, MemoryPage } from "../../shared/protocol.ts";
import { backUp, backups } from "../backup.ts";
import { id as checkId, object, rowId } from "../check.ts";
import { config } from "../config.ts";
import { invalid } from "../errors.ts";
import { pinsOf } from "../pins.ts";
import type { Services } from "../services.ts";

export function memoryRoutes(s: Services): Router {
  const routes = Router();

  const memoryPage = (companion: Companion): MemoryPage => ({
    ...s.memoryService.page(companion),
    rebuilding: s.scheduler.rebuilding(companion.id),
    backups: backups(s.backupDir).map(({ day, bytes }) => ({ day, bytes })),
    pins: pinsOf(s.db, companion.id),
  });

  routes.get("/companions/:id/memory", (req: Request, res: Response) => {
    res.json(memoryPage(s.companionOf(req)));
  });

  /** Tidies the companion's memory now, and says how that went. */
  routes.post("/companions/:id/memory/tidy", async (req: Request, res: Response) => {
    const companion = s.companionOf(req);
    const outcome = await s.scheduler.tidy(companion.id);
    res.json({ outcome, page: memoryPage(companion) });
  });

  /**
   * Starts rebuilding the companion's memory from every chat. It can take minutes, so this answers
   * at once; the page watches the runs come in.
   */
  routes.post("/companions/:id/memory/rebuild", (req: Request, res: Response) => {
    const companion = s.companionOf(req);
    s.scheduler.rebuild(companion.id).then(
      (outcome) => {
        if (outcome.kind === "failed")
          console.error(`Rebuilding the memory of ${companion.id} failed: ${outcome.error}`);
      },
      (err: unknown) => console.error(`Rebuilding the memory of ${companion.id} failed:`, err),
    );
    res.status(202).json(memoryPage(companion));
  });

  /** Backs the whole database up now, as today's backup. */
  routes.post("/companions/:id/memory/backup", (req: Request, res: Response) => {
    const companion = s.companionOf(req);
    backUp(s.db, s.backupDir, config.backupsKept);
    res.json(memoryPage(companion));
  });

  routes.get("/companions/:id/memory/file", (req: Request, res: Response) => {
    res.json(s.memoryService.file(s.companionOf(req), req.query.path));
  });

  routes.put("/companions/:id/memory/file", async (req: Request, res: Response) => {
    const body = object(req.body);
    if (typeof body.content !== "string") invalid("The file's text isn't valid");
    res.json(await s.memoryService.save(s.companionOf(req), body.path, body.content));
  });

  routes.delete("/companions/:id/memory/file", async (req: Request, res: Response) => {
    await s.memoryService.remove(s.companionOf(req), req.query.path);
    res.status(204).end();
  });

  routes.get("/companions/:id/memory/versions", (req: Request, res: Response) => {
    res.json(s.memoryService.versions(s.companionOf(req), req.query.path));
  });

  routes.get("/companions/:id/memory/versions/:versionId", (req: Request, res: Response) => {
    res.json(s.memoryService.version(s.companionOf(req), rowId(req.params.versionId, "That version id")));
  });

  routes.post("/companions/:id/memory/versions/:versionId/revert", async (req: Request, res: Response) => {
    await s.memoryService.revert(s.companionOf(req), rowId(req.params.versionId, "That version id"));
    res.status(204).end();
  });

  /** Unpins a moment. The chat it came from stops sending it on its next turn. */
  routes.delete("/companions/:id/pins/:pinId", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const companion = my.companions.get(checkId(req.params.id));
    my.pins.remove(companion.id, rowId(req.params.pinId, "That pin"));
    res.json(memoryPage(companion));
  });

  return routes;
}
