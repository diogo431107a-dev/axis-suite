// Who is signed in, and what this server can do.
import { Router } from "express";
import type { Health } from "../../shared/protocol.ts";
import { hasApiKey } from "../claude/client.ts";
import { config } from "../config.ts";
import type { Services } from "../services.ts";

export function metaRoutes(s: Services): Router {
  const routes = Router();

  routes.get("/me", s.auth.me);

  routes.get("/health", (_req, res) => {
    res.json({
      apiKey: hasApiKey(),
      pictures: s.painter !== null,
      speech: s.speech !== null,
      voice: s.speech?.voice ?? null,
      defaults: config.defaults,
    } satisfies Health);
  });

  return routes;
}
