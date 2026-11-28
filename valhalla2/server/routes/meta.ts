// Who is signed in, and what this server can do.
import { Router } from "express";
import type { Health } from "../../shared/protocol.ts";
import { hasApiKey } from "../claude/client.ts";
import { hasGrokKey } from "../grok/client.ts";
import { hasOpenAiKey } from "../openai/client.ts";
import { config } from "../config.ts";
import type { Services } from "../services.ts";

export function metaRoutes(s: Services): Router {
  const routes = Router();

  routes.get("/me", s.auth.me);

  routes.get("/health", (_req, res) => {
    res.json({
      apiKey: hasApiKey(),
      grok: hasGrokKey(),
      openai: hasOpenAiKey(),
      pictures: s.painter !== null,
      pictureEngines: s.painter?.available ?? [],
      speech: s.speech !== null,
      voice: s.speech?.voice ?? null,
      defaults: config.defaults,
    } satisfies Health);
  });

  return routes;
}
