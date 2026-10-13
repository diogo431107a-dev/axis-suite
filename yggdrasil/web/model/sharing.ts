// The requests behind sharing: the share dialog and "Remove from my list". What the outline looks
// like afterwards comes through sync, as any other change does (the API announces it).
import { SignedOutError, apiFetch } from "@axis-suite/heimdall-client/browser";
import { USER_HEADER, type Share } from "../../shared/protocol.ts";
import type { Outliner } from "./outliner.ts";

/** A request to the API on behalf of the page's user. Fails with the API's own message. */
async function request<T>(o: Outliner, path: string, method = "GET", body?: unknown): Promise<T | null> {
  try {
    return await apiFetch<T>(path, {
      method,
      headers: { [USER_HEADER]: o.username },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    if (err instanceof SignedOutError) throw new Error("Your session has ended. Sign in again, then try once more.");
    // The API answers { error }.
    let message = err instanceof Error ? err.message : String(err);
    try {
      message = (JSON.parse(message) as { error?: string }).error ?? message;
    } catch {
      // not JSON: the text as it came
    }
    throw new Error(message);
  }
}

/** The usernames a bullet can be shared with: everyone in Heimdall but the user. */
export async function listUsers(o: Outliner): Promise<string[]> {
  return (await request<string[]>(o, "/api/users")) ?? [];
}

/** Replaces everyone bullet id is shared with. */
export async function saveShares(o: Outliner, id: string, shares: Share[]): Promise<Share[]> {
  return (await request<Share[]>(o, `/api/nodes/${id}/shares`, "PUT", shares)) ?? [];
}

/** Stops sharing bullet id with one person (the owner, or that person themselves). */
export async function removeShare(o: Outliner, id: string, username: string): Promise<void> {
  await request(o, `/api/nodes/${id}/shares/${encodeURIComponent(username)}`, "DELETE");
}
