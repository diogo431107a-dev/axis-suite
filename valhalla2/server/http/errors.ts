// How the API answers when it can't: an unknown path, a refused request, or a bug.
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";

/** Anything under /api that no router answered. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
};

/**
 * Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
 * Anything else is a bug: logged, and answered without details.
 */
export const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  // A reply that already started streaming can only be closed.
  if (res.headersSent) return void res.end();
  if (err instanceof StoreError) {
    return void res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiError);
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: (err as Error).message } satisfies ApiError);
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" } satisfies ApiError);
};
