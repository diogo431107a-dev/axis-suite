// What maps.ts and ops.ts share: refusing a request, and running work in one transaction.
import type { DatabaseSync } from "node:sqlite";
import type { ErrorCode } from "../shared/protocol.ts";

/** A request that is refused, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  constructor(status: number, message: string, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

export function notFound(what: string): never {
  throw new StoreError(404, `No such ${what}`, "not-found");
}

export function tooMany(message: string): never {
  throw new StoreError(409, message, "too-many");
}

export function objectBody(input: unknown, what = "The request body"): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid(`${what} must be a JSON object`);
  return input as Record<string, unknown>;
}

/** Runs `fn` in one transaction: all of it is saved, or nothing. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
