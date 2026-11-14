// Refusing a request.
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

export function conflict(message: string): never {
  throw new StoreError(409, message, "conflict");
}

export function tooMany(message: string): never {
  throw new StoreError(409, message, "too-many");
}
