// fetch() for Valhalla's API, and the reader for a reply as it is written.
import type { ApiError, ErrorCode, StreamEvent } from "../shared/protocol.ts";
import { createFrameReader } from "../shared/sse.ts";

/** The API refused a request, or couldn't be reached (status 0). */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  constructor(status: number, message: string, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(0, "Valhalla can't be reached. Is the server still running?");
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new ApiFailure(res.status, err.error || `Error ${res.status}`, err.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A sentence for an error from api(), for a notice on the page. */
export function describeError(err: unknown): string {
  if (err instanceof ApiFailure) return err.message;
  console.error(err);
  return "Something went wrong. Try again in a moment.";
}

/**
 * Sends a message and reports the reply as it arrives.
 *
 * EventSource only does GET, so the response body is read here instead. The server keeps writing
 * and still saves the reply if this page goes away mid-stream.
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${conversationId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new ApiFailure(0, "Valhalla can't be reached. Is the server still running?");
  }
  // A refusal before the stream starts is still ordinary JSON.
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new ApiFailure(res.status, err.error || `Error ${res.status}`, err.code);
  }
  if (!res.body) throw new ApiFailure(0, "Valhalla sent no reply to read.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const read = createFrameReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of read(decoder.decode(value, { stream: true }))) onEvent(event);
  }
}
