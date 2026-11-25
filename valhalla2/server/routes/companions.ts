// Companions.
import { Router, type Request, type Response } from "express";
import { id as checkId } from "../check.ts";
import type { Services } from "../services.ts";
import { speechFilesOf } from "../speech/store.ts";

export function companionRoutes(s: Services): Router {
  const routes = Router();

  routes.get("/companions", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).companions.list());
  });

  routes.put("/companions/:id", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).companions.save(checkId(req.params.id), req.body));
  });

  routes.delete("/companions/:id", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    // The rows go with the companion; their files are deleted here.
    const files = my.pictures.filesOf(id);
    const audio = speechFilesOf(s.db, { companionId: id });
    my.companions.remove(id);
    for (const file of files) s.pictureFiles.remove(file);
    for (const file of audio) s.speechFiles.remove(file);
    res.status(204).end();
  });

  return routes;
}
