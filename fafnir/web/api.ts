// fetch() for Fafnir's API. Like apiFetch from heimdall-client, but it names the page's user in
// every request (USER_HEADER), keeps the code of a refusal so a form can respond to it, and lets a
// form stay open with what was typed when the session ends.
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import { USER_HEADER, type ApiError, type ErrorCode } from "../shared/protocol.ts";

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

let pageUser: string | null = null;
let onSignedOut: (loginUrl: string) => void = () => {};

/** From now on, requests say they come from this user's page. */
export function setPageUser(username: string): void {
  pageUser = username;
}

/** Who to tell when a request finds the session has ended. */
export function setSignedOutHandler(handler: (loginUrl: string) => void): void {
  onSignedOut = handler;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (pageUser) headers[USER_HEADER] = pageUser;
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(0, "Fafnir can't be reached. Check your connection and try again.");
  }
  if (res.status === 401) {
    const { loginUrl } = (await res.json().catch(() => ({}))) as { loginUrl?: string };
    if (!loginUrl) throw new ApiFailure(401, "Not signed in");
    throw new SignedOutError(loginUrl);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    // Someone else signed in (in another tab): this page must not show or change their money.
    if (err.code === "other-user") location.reload();
    throw new ApiFailure(res.status, err.error || `Error ${res.status}`, err.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A sentence for an error from api(), for a notice on the page. */
export function describeError(err: unknown): string {
  if (err instanceof SignedOutError) {
    onSignedOut(err.loginUrl);
    return "Your session has ended. Sign in again, then try once more.";
  }
  if (err instanceof ApiFailure) return err.message;
  console.error(err);
  return "Something went wrong. Try again in a moment.";
}
