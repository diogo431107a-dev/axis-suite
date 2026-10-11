import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { authenticate } from "./users.ts";
import {
  SESSION_TTL_MS,
  clearFailures,
  createSession,
  destroySession,
  getSession,
  lockedFor,
  recordFailure,
} from "./state.ts";
import { formatCountdown, renderDashboard, renderLogin } from "./views.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
// Set TRUST_PROXY=1 only when running behind a reverse proxy (Caddy) on the same host.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
// Set COOKIE_SECURE=1 when served over HTTPS so the session cookie is never sent in clear text.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
// Set COOKIE_DOMAIN=example.com to share the session with sibling apps on its subdomains (e.g. Loggbok).
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim() || undefined;
// Origins (e.g. https://loggbok.example.com) that may send users here with ?next= and get them
// back after signing in. Anything else is ignored, so this can't be an open redirect. Each module
// adds its own RETURN_ORIGIN_<MODULE> (the installer writes one systemd drop-in per module), and
// RETURN_ORIGINS may hold a comma-separated list.
const RETURN_ORIGINS = Object.entries(process.env)
  .filter(([key]) => key === "RETURN_ORIGINS" || key.startsWith("RETURN_ORIGIN_"))
  .flatMap(([, value]) => (value ?? "").split(","))
  .map((o) => o.trim())
  .filter(Boolean);
const COOKIE_NAME = "heimdall_sid";
const MAX_BODY_BYTES = 4096;

// Clients with a login check in progress. Rejecting overlapping requests stops
// parallel guesses from slipping past the 3-attempt limit.
const inFlight = new Set<string>();

function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  if (TRUST_PROXY) {
    // Caddy appends the address it saw, so the last entry is the real client.
    const header = req.headers["x-forwarded-for"];
    const last = (Array.isArray(header) ? header.join(",") : header)?.split(",").pop()?.trim();
    if (last) return last;
  }
  return remote;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function sessionCookie(value: string, maxAgeSeconds: number, domain = COOKIE_DOMAIN): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${domain ? `; Domain=${domain}` : ""}${COOKIE_SECURE ? "; Secure" : ""}`;
}

/** Set-Cookie values for the session. With COOKIE_DOMAIN set, any older host-only cookie is cleared too. */
function sessionCookies(value: string, maxAgeSeconds: number): string[] {
  const cookies = [sessionCookie(value, maxAgeSeconds)];
  if (COOKIE_DOMAIN) cookies.push(sessionCookie("", 0, ""));
  return cookies;
}

/** The URL to send the user back to, if it belongs to an allowed app. */
function returnTo(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  try {
    return RETURN_ORIGINS.includes(new URL(next).origin) ? next : undefined;
  } catch {
    return undefined;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function securityHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:; form-action ${["'self'", ...RETURN_ORIGINS].join(" ")}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };
}

function sendHtml(res: ServerResponse, status: number, nonce: string, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...securityHeaders(nonce) });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store", ...headers });
  res.end();
}

const lockMessage = (ms: number) => `Too many failed attempts. Try again in ${formatCountdown(ms)}.`;

async function handleLogin(req: IncomingMessage, res: ServerResponse, nonce: string, ip: string): Promise<void> {
  const form = new URLSearchParams(await readBody(req));
  const next = returnTo(form.get("next"));

  const lockedMs = lockedFor(ip);
  if (lockedMs > 0) {
    sendHtml(res, 429, nonce, renderLogin({ nonce, error: lockMessage(lockedMs), lockedMs, next }));
    return;
  }

  const username = (form.get("username") ?? "").trim();
  const password = form.get("password") ?? "";

  const user = await authenticate(username, password);
  if (!user) {
    const { remaining, lockedMs } = recordFailure(ip);
    if (lockedMs > 0) {
      console.warn(`${ip} locked out for ${lockedMs / 60_000} minutes after failed logins`);
      sendHtml(res, 429, nonce, renderLogin({ nonce, error: lockMessage(lockedMs), username, lockedMs, next }));
    } else {
      const error = `Invalid username or password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
      sendHtml(res, 401, nonce, renderLogin({ nonce, error, username, next }));
    }
    return;
  }

  clearFailures(ip);
  destroySession(readCookie(req, COOKIE_NAME)); // never reuse a pre-login session id
  const { token } = createSession(user);
  console.log(`${user.username} logged in from ${ip}`);
  redirect(res, next ?? "/", { "Set-Cookie": sessionCookies(token, SESSION_TTL_MS / 1000) });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");
  const nonce = randomBytes(16).toString("base64");
  const ip = clientIp(req);
  const sid = readCookie(req, COOKIE_NAME);

  if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
    const session = getSession(sid);
    const next = returnTo(searchParams.get("next"));
    if (session && sid && next) {
      // Already signed in: go straight back to the app. Re-issuing the cookie moves a session
      // that predates COOKIE_DOMAIN onto the shared domain, so the app can see it.
      const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000);
      redirect(res, next, { "Set-Cookie": sessionCookies(sid, maxAge) });
    } else if (session) {
      sendHtml(res, 200, nonce, renderDashboard({ nonce, session }));
    } else {
      const lockedMs = lockedFor(ip);
      sendHtml(
        res,
        200,
        nonce,
        renderLogin({ nonce, error: lockedMs > 0 ? lockMessage(lockedMs) : undefined, lockedMs, next }),
      );
    }
    return;
  }

  // For sibling apps (e.g. Loggbok): their server forwards the browser's Cookie header here
  // to learn who is signed in.
  if (pathname === "/whoami" && req.method === "GET") {
    const session = getSession(sid);
    res.writeHead(session ? 200 : 401, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(
      JSON.stringify(
        session
          ? { username: session.username, name: session.name, expiresAt: session.expiresAt }
          : { error: "Not signed in" },
      ),
    );
    return;
  }

  if (pathname === "/login" && req.method === "POST") {
    // One user per browser: a signed-in browser must close its session before anyone else logs in.
    const current = getSession(sid);
    if (current) {
      const notice = `You're already signed in as ${current.name}. Close the session first to sign in as someone else.`;
      sendHtml(res, 409, nonce, renderDashboard({ nonce, session: current, notice }));
      return;
    }
    if (inFlight.has(ip)) {
      sendHtml(res, 429, nonce, renderLogin({ nonce, error: "A sign-in is already in progress. Please wait." }));
      return;
    }
    inFlight.add(ip);
    try {
      await handleLogin(req, res, nonce, ip);
    } finally {
      inFlight.delete(ip);
    }
    return;
  }

  if (pathname === "/logout" && req.method === "POST") {
    const session = getSession(sid);
    if (session) {
      // Only close the session of the user the page was showing. A stale tab from an
      // earlier user just refreshes to whoever is signed in now.
      const form = new URLSearchParams(await readBody(req));
      if (form.get("user") !== session.username) {
        redirect(res, "/");
        return;
      }
      console.log(`${session.username} logged out`);
    }
    destroySession(sid);
    redirect(res, "/", { "Set-Cookie": sessionCookies("", 0) });
    return;
  }

  // Liveness check for the installer and monitoring. Every module answers it.
  if (pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("ok");
    return;
  }

  if (pathname === "/login" || pathname === "/logout") {
    redirect(res, "/");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error("Request failed:", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on http://${HOST}:${PORT}`);
  if (RETURN_ORIGINS.length > 0) console.log(`Users may return to: ${RETURN_ORIGINS.join(", ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
