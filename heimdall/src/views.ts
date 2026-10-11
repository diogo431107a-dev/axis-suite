import type { Session } from "./state.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="logo" aria-hidden="true">
<defs><linearGradient id="bifrost" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ff6b6b"/><stop offset=".25" stop-color="#ffb84d"/><stop offset=".5" stop-color="#7ee081"/><stop offset=".75" stop-color="#4dabf7"/><stop offset="1" stop-color="#b197fc"/>
</linearGradient></defs>
<path d="M32 4 56 14v18c0 14-11 24-24 28C19 56 8 46 8 32V14Z" fill="none" stroke="url(#bifrost)" stroke-width="3" stroke-linejoin="round"/>
<path d="M16 33c5-8 10-11 16-11s11 3 16 11c-5 8-10 11-16 11s-11-3-16-11Z" fill="none" stroke="#e6e9f0" stroke-width="2.5" stroke-linejoin="round"/>
<circle cx="32" cy="33" r="6" fill="url(#bifrost)"/><circle cx="32" cy="33" r="2.2" fill="#0b0f17"/>
</svg>`;

const FAVICON = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

const CSS = `
:root{color-scheme:dark;--bg:#0b0f17;--card:#121826;--field:#0d1320;--line:#232c3d;--text:#e6e9f0;--muted:#8b95a7;--accent:#4dabf7;
--bifrost:linear-gradient(90deg,#ff6b6b,#ffb84d,#7ee081,#4dabf7,#b197fc)}
*{box-sizing:border-box}
html,body{min-height:100%}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;color:var(--text);
background:radial-gradient(1200px 600px at 50% -10%,#1a2340 0%,var(--bg) 60%) fixed,var(--bg);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{position:relative;width:100%;max-width:380px;padding:36px 32px 32px;background:var(--card);border:1px solid var(--line);
border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);overflow:hidden}
.card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:var(--bifrost)}
.brand{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:28px;text-align:center}
.logo{width:56px;height:56px}
.wordmark{margin:0;font-size:22px;font-weight:600;letter-spacing:.32em;padding-left:.32em;text-transform:uppercase}
.tagline{margin:0;color:var(--muted);font-size:14px}
fieldset{border:0;margin:0;padding:0;min-width:0}
label{display:block;margin:0 0 6px;font-size:13px;color:var(--muted)}
input{width:100%;padding:11px 12px;margin:0 0 16px;background:var(--field);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(77,171,247,.2)}
button{width:100%;padding:11px;border:0;border-radius:8px;background:var(--text);color:var(--bg);font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#fff}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset:disabled{opacity:.5}
fieldset:disabled button,fieldset:disabled input{cursor:not-allowed}
.alert{margin:0 0 20px;padding:10px 12px;border:1px solid rgba(255,107,107,.35);background:rgba(255,107,107,.08);border-radius:8px;color:#ffc9c9;font-size:14px}
.alert.ok{border-color:rgba(126,224,129,.35);background:rgba(126,224,129,.08);color:#c3f0c4}
.clock{margin:0;text-align:center;font:600 48px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}
.date{margin:4px 0 24px;text-align:center;color:var(--muted)}
.who{margin:0 0 24px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--field)}
.who dt{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.who dd{margin:0 0 10px}
.who dd:last-child{margin:0}
.muted{color:var(--muted)}
.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}
.secondary:hover{background:#1a2233}
`;

function page(nonce: string, title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON}">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main class="card">
${body}
</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

function brand(tagline: string): string {
  return `<header class="brand">${LOGO_SVG}<h1 class="wordmark">Heimdall</h1><p class="tagline">${esc(tagline)}</p></header>`;
}

export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface LoginView {
  nonce: string;
  error?: string;
  username?: string;
  /** When > 0 the form is disabled and a countdown re-enables it. */
  lockedMs?: number;
  /** An allowed app URL to return to after signing in. */
  next?: string;
}

export function renderLogin({ nonce, error, username = "", lockedMs = 0, next }: LoginView): string {
  const body = `${brand("Sign in to continue")}
${error ? `<p class="alert" role="alert" id="alert">${esc(error)}</p>` : ""}
<form method="post" action="/login">
${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ""}
<fieldset id="fields"${lockedMs > 0 ? " disabled" : ""}>
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" required autofocus value="${esc(username)}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button>
</fieldset>
</form>`;

  // Live countdown that unlocks the form when the lockout ends.
  const script =
    lockedMs > 0
      ? `
var end = Date.now() + ${Math.ceil(lockedMs)};
var alertEl = document.getElementById("alert");
var fields = document.getElementById("fields");
function pad(n) { return String(n).padStart(2, "0"); }
var timer = setInterval(tick, 1000);
function tick() {
  var left = end - Date.now();
  if (left <= 0) {
    clearInterval(timer);
    alertEl.textContent = "You can try again now.";
    alertEl.className = "alert ok";
    fields.disabled = false;
    document.getElementById("password").focus();
    return;
  }
  var s = Math.ceil(left / 1000);
  alertEl.textContent = "Too many failed attempts. Try again in " + Math.floor(s / 60) + ":" + pad(s % 60) + ".";
}`
      : "";

  return page(nonce, "Sign in · Heimdall", body, script);
}

export function renderDashboard({ nonce, session, notice }: { nonce: string; session: Session; notice?: string }): string {
  const now = new Date();
  const body = `${brand(`Welcome, ${session.name}`)}
${notice ? `<p class="alert" role="alert">${esc(notice)}</p>` : ""}
<p class="clock" id="clock">${now.toLocaleTimeString("en-GB")}</p>
<p class="date" id="date">${now.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (server time)</p>
<dl class="who">
<dt>Signed in as</dt><dd>${esc(session.name)} <span class="muted">(${esc(session.username)})</span></dd>
<dt>Session started</dt><dd class="ts" data-ts="${session.loginAt}">${new Date(session.loginAt).toLocaleString("en-GB")}</dd>
<dt>Re-login required</dt><dd class="ts" data-ts="${session.expiresAt}">${new Date(session.expiresAt).toLocaleString("en-GB")}</dd>
</dl>
<form method="post" action="/logout">
<input type="hidden" name="user" value="${esc(session.username)}">
<button class="secondary" type="submit">Close session</button>
</form>`;

  // Replace the server-rendered fallback with a live clock in the viewer's local time.
  const script = `
var clock = document.getElementById("clock");
var date = document.getElementById("date");
function tick() {
  var d = new Date();
  clock.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  date.textContent = d.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
tick();
setInterval(tick, 1000);
document.querySelectorAll(".ts").forEach(function (el) {
  el.textContent = new Date(Number(el.dataset.ts)).toLocaleString();
});`;

  return page(nonce, "Heimdall", body, script);
}
