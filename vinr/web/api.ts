// fetch() for Vinr's API. Like apiFetch from heimdall-client, but it names the page's user in
// every request (USER_HEADER) and keeps the status, code and body of a refusal, so the page can
// tell a conflict (the contact changed elsewhere) from any other error.
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import { USER_HEADER, type ApiError, type ErrorCode } from "../shared/protocol.ts";

/** The API refused a request, or couldn't be reached (status 0). */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly body: ApiError | undefined;
  constructor(status: number, message: string, body?: ApiError) {
    super(message);
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

let pageUser: string | null = null;

/** From now on, requests say they come from this user's page. */
export function setPageUser(username: string): void {
  pageUser = username;
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
    throw new ApiFailure(0, "Vinr can't be reached. Check your connection.");
  }
  if (res.status === 401) {
    const { loginUrl } = (await res.json().catch(() => ({}))) as { loginUrl?: string };
    if (!loginUrl) throw new ApiFailure(401, "Not signed in");
    throw new SignedOutError(loginUrl);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    // Someone else signed in (in another tab): this page must not show or change their contacts.
    if (err.code === "other-user") location.reload();
    throw new ApiFailure(res.status, err.error || `Error ${res.status}`, err);
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

/** A query string from the values that are set: { a: "1", b: null } → "?a=1". */
export function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const s = search.toString();
  return s ? `?${s}` : "";
}
