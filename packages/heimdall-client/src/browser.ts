// Browser side: calls a module's own /api and sends the user to Heimdall when they aren't
// signed in. Pairs with heimdallAuth() from ./server, which answers 401 { loginUrl }.

/** What GET /api/me returns. */
export interface Me {
  username: string;
  name: string;
  /** Heimdall, where the user manages (and closes) their session. */
  accountUrl: string;
}

/** The Heimdall session is missing, expired or closed. */
export class SignedOutError extends Error {
  readonly loginUrl: string;
  constructor(loginUrl: string) {
    super("Not signed in");
    this.loginUrl = loginUrl;
  }
}

/**
 * fetch() for a module's JSON API. Returns the parsed body, or null for 204.
 * Throws SignedOutError on 401, and Error for any other failure.
 */
export async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T | null> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (res.status === 401) {
    const { loginUrl } = (await res.json().catch(() => ({}))) as { loginUrl?: string };
    if (!loginUrl) throw new Error(`${path} answered 401 without a loginUrl`);
    throw new SignedOutError(loginUrl);
  }
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

/** The signed-in user. Throws SignedOutError if nobody is. */
export async function fetchMe(): Promise<Me> {
  const me = await apiFetch<Me>("/api/me");
  if (!me) throw new Error("/api/me returned no user");
  return me;
}

/** Heimdall's sign-in page, set to bring the user back to `next` afterwards. */
export function signInUrl(loginUrl: string, next: string = location.href): string {
  const url = new URL("/", loginUrl);
  url.searchParams.set("next", next);
  return url.href;
}

/** Leaves the page for Heimdall's sign-in page. Use it when nothing on the page is worth keeping. */
export function goToSignIn(error: SignedOutError): void {
  location.replace(signInUrl(error.loginUrl));
}

/**
 * For a page that stays open after the session ended (to keep a draft, say): each time the
 * user comes back to this tab, checks whether they signed in again. Calls onBack when the same
 * user is back. Someone else signing in gets a fresh page. Returns a function that stops watching.
 */
export function watchForSignIn(username: string, onBack: () => void): () => void {
  const recheck = () => {
    fetchMe()
      .then((me) => (me.username === username ? onBack() : location.reload()))
      .catch(() => {
        // still signed out
      });
  };
  window.addEventListener("focus", recheck);
  return () => window.removeEventListener("focus", recheck);
}
