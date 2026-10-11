// Server side: Node.js middleware (Express- and Connect-compatible) that asks Heimdall who is
// signed in. It forwards the browser's cookie to Heimdall's GET /whoami on every request, so
// closing a session in Heimdall signs the user out of every module at once.
import type { IncomingMessage, ServerResponse } from "node:http";

export interface HeimdallUser {
  /** Stable account id. Store this, not the name, as the owner of a module's data. */
  username: string;
  /** Display name. It can change at any time. */
  name: string;
}

export interface HeimdallOptions {
  /** Where this server reaches Heimdall. Default: $HEIMDALL_INTERNAL_URL, else http://127.0.0.1:3000. */
  internalUrl?: string;
  /** Where browsers reach Heimdall to sign in. Default: $HEIMDALL_PUBLIC_URL, else http://127.0.0.1:3000. */
  publicUrl?: string;
  /** How long to wait for Heimdall before answering 503. Default: 5000. */
  timeoutMs?: number;
}

type Next = (err?: unknown) => void;
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void | Promise<void>;
export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function heimdallAuth(options: HeimdallOptions = {}) {
  const internalUrl = options.internalUrl ?? process.env.HEIMDALL_INTERNAL_URL ?? "http://127.0.0.1:3000";
  const publicUrl = options.publicUrl ?? process.env.HEIMDALL_PUBLIC_URL ?? "http://127.0.0.1:3000";
  const timeoutMs = options.timeoutMs ?? 5000;
  const users = new WeakMap<IncomingMessage, HeimdallUser>();

  /**
   * Answers 401 { error, loginUrl } unless someone is signed in. Then user(req) returns them.
   * The browser helper (./browser) turns that 401 into a trip to Heimdall's sign-in page.
   */
  const requireUser: Middleware = async (req, res, next) => {
    let r: Response;
    try {
      r = await fetch(new URL("/whoami", internalUrl), {
        headers: { cookie: req.headers.cookie ?? "" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      console.error("Heimdall unreachable:", err instanceof Error ? err.message : err);
      return sendJson(res, 503, { error: "Sign-in service unavailable" });
    }
    if (r.status === 401) {
      return sendJson(res, 401, { error: "Not signed in", loginUrl: publicUrl });
    }
    const body = r.ok ? ((await r.json().catch(() => null)) as Partial<HeimdallUser> | null) : null;
    if (typeof body?.username !== "string" || typeof body.name !== "string") {
      console.error(`Heimdall /whoami answered ${r.status} without a user`);
      return sendJson(res, 503, { error: "Sign-in service unavailable" });
    }
    users.set(req, { username: body.username, name: body.name });
    next();
  };

  /**
   * The Heimdall cookie is sent by every sibling subdomain, so writes must come from this
   * module's own pages: a foreign Origin is refused, and bodies must be JSON, which needs a
   * CORS preflight that is never granted.
   */
  const sameOriginWrites: Middleware = (req, res, next) => {
    const method = req.method ?? "GET";
    if (READ_METHODS.has(method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        // malformed: treat as foreign
      }
      if (host !== req.headers.host) return sendJson(res, 403, { error: "Cross-origin request refused" });
    }
    const type = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (BODY_METHODS.has(method) && type !== "application/json") {
      return sendJson(res, 415, { error: "Expected application/json" });
    }
    next();
  };

  /** The signed-in user. Only valid in handlers that run after requireUser. */
  function user(req: IncomingMessage): HeimdallUser {
    const found = users.get(req);
    if (!found) throw new Error("user(req) called on a route that requireUser doesn't cover");
    return found;
  }

  /** GET /api/me: the signed-in user, and where they manage (and close) their session. */
  const me: Handler = (req, res) => sendJson(res, 200, { ...user(req), accountUrl: publicUrl });

  return { requireUser, sameOriginWrites, user, me, publicUrl };
}
