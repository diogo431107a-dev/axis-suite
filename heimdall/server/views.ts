import { idleEndsAt, type Session } from "./state.ts";
import { VERSIONS } from "./versions.ts";
import { OUTSIDE_LINKS, OUTSIDE_MODULES, moduleInfo, type ModuleInfo } from "./modules.ts";

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

// Bifrost's snowy plains: far mountains, three rolling fields of snow and a few pines.
const HILLS = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 400" preserveAspectRatio="none"><path d="M0 170 120 110 210 150 330 70 450 140 560 95 690 160 820 80 940 135 1070 60 1190 130 1310 90 1440 140V400H0Z" fill="#c4d4e6"/><path d="M330 70 365 92 350 100 385 112 330 70ZM820 80 858 104 842 110 880 122ZM1070 60 1110 86 1094 92 1134 106Z" fill="#f4f8fc"/><path d="M0 230C240 180 420 205 640 190S1080 160 1440 205V400H0Z" fill="#dfe9f4"/><path d="M190 205 202 180 214 205ZM205 207 219 176 233 207ZM1180 192 1192 168 1204 192ZM1196 194 1209 164 1222 194Z" fill="#8ea6bd"/><path d="M0 290C300 245 560 270 820 255S1240 235 1440 265V400H0Z" fill="#edf3f9"/><path d="M0 345C380 315 760 340 1100 325 1260 318 1360 322 1440 330V400H0Z" fill="#ffffff"/></svg>`,
)}`;

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
.logo-button{width:auto;padding:0;background:none;border-radius:12px;line-height:0}
.logo-button:hover{background:none;opacity:.8}
.about{width:min(340px,calc(100vw - 32px));padding:18px 22px 22px;background:var(--card);color:var(--text);border:1px solid var(--line);
border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.about::backdrop{background:rgba(0,0,0,.5)}
.about-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.about-head h2{margin:0;font-size:16px;font-weight:600}
.about .close{width:auto;padding:2px 8px;background:transparent;color:var(--muted);font-size:20px;font-weight:400;line-height:1}
.about .close:hover{background:#1a2233;color:var(--text)}
.about p{margin:0}
.versions{display:grid;grid-template-columns:auto 1fr;gap:4px 24px;margin:14px 0 0}
.versions dt{color:var(--muted)}
.versions dd{margin:0;font-variant-numeric:tabular-nums}
.about .small{margin-top:12px;font-size:12px}
.actions{display:grid;gap:10px}
.button{display:block;padding:11px;border-radius:8px;background:var(--text);color:var(--bg);font-weight:600;text-align:center;text-decoration:none}
.button:hover{background:#fff}
.button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card.wide{max-width:560px;overflow:visible}
.card.wide::before{border-radius:14px 14px 0 0}
.section{margin:28px 0 8px;font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.section:first-of-type{margin-top:0}
.section-note{margin:-4px 0 10px;font-size:13px}
.modules{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.row{position:relative;display:flex;align-items:stretch;border:1px solid var(--line);border-radius:10px;background:var(--field)}
.row:hover,.row:focus-within{border-color:#34405a}
.row .go{flex:1;min-width:0;display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:2px 16px;padding:12px 14px;color:var(--text);text-decoration:none;border-radius:10px 0 0 10px}
.row .go:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.row .name{font-weight:600}
.row .what{grid-column:1;color:var(--muted);font-size:13px}
.row .host{grid-column:2;grid-row:1/3;align-self:center;color:var(--muted);font:12px ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.row .info{width:auto;flex:none;padding:0 14px;background:transparent;color:var(--muted);border-left:1px solid var(--line);border-radius:0 10px 10px 0;font-weight:400}
.row .info:hover{background:#1a2233;color:var(--text)}
.row .hint{position:absolute;z-index:2;left:12px;right:12px;top:calc(100% + 6px);padding:10px 12px;background:#1a2233;border:1px solid var(--line);border-radius:8px;
box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:13px;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .12s,visibility .12s}
.row:hover .hint,.row:focus-within .hint{opacity:1;visibility:visible;transition-delay:.35s}
.about .explain{margin-top:10px}
.about .open{margin-top:16px}
.back{display:block;margin-top:24px;text-align:center;color:var(--muted)}
.back:hover{color:var(--text)}
@media (max-width:480px){.card{padding:28px 20px 24px}.row .go{grid-template-columns:1fr}.row .what{order:1}.row .host{order:2;grid-column:1;grid-row:auto;max-width:none}}
@media (hover:none){.row .hint{display:none}}
/* Bifrost: the rainbow bridge over snowy plains. */
body.bifrost{color-scheme:light;--bg:#eef3f8;--card:rgba(255,255,255,.8);--field:rgba(255,255,255,.85);--line:#d2dde9;--text:#1d2b3a;--muted:#5a6b7d;--accent:#2b7bbf;--hover:#e8f0f8;
background:url("${HILLS}") bottom/100% 42vh no-repeat fixed,linear-gradient(#bfd3e8 0%,#dce8f3 45%,#f3f7fb 100%) fixed,var(--bg)}
body.bifrost::before{content:"";position:fixed;inset:0;pointer-events:none;
background-image:radial-gradient(4px 4px at 30px 40px,#fff 60%,transparent 70%),radial-gradient(3px 3px at 140px 120px,#fff 60%,transparent 70%),
radial-gradient(5px 5px at 90px 200px,#fff 60%,transparent 70%),radial-gradient(3px 3px at 210px 60px,#fff 60%,transparent 70%),
radial-gradient(4px 4px at 260px 230px,#fff 60%,transparent 70%);background-size:240px 240px,300px 300px,280px 280px,200px 200px,320px 320px;
filter:drop-shadow(0 0 1.5px rgba(70,100,135,.45));animation:snowfall 24s linear infinite}
@keyframes snowfall{to{background-position:0 240px,0 300px,0 280px,0 200px,0 320px}}
@media (prefers-reduced-motion:reduce){body.bifrost::before{animation:none}}
.bifrost .card{z-index:1;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-color:rgba(255,255,255,.9);box-shadow:0 24px 60px rgba(40,70,100,.18)}
.bifrost .logo path:nth-of-type(2){stroke:#1d2b3a}
.bifrost .row{box-shadow:0 1px 2px rgba(40,70,100,.06)}
.bifrost .row:hover,.bifrost .row:focus-within{border-color:#a8c1da}
.bifrost .row .info:hover,.bifrost .about .close:hover{background:var(--hover)}
.bifrost .row .hint{background:#fff;color:var(--text);box-shadow:0 10px 30px rgba(40,70,100,.18)}
.bifrost .about{background:#fff;box-shadow:0 20px 60px rgba(40,70,100,.25)}
.bifrost .about::backdrop{background:rgba(40,60,80,.25)}
.bifrost .button{background:var(--text);color:#fff}
.bifrost .button:hover{background:#2e4258}
`;

function page(nonce: string, title: string, body: string, script = "", bifrost = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON}">
<style nonce="${nonce}">${CSS}</style>
</head>
<body${bifrost ? ' class="bifrost"' : ""}>
<main class="card${bifrost ? " wide" : ""}">
${body}
</main>
${ABOUT}
${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;
}

// The logo opens the About box, as in every module of the suite. A popover needs no script: the
// browser opens it, and closes it on Esc or a click outside.
function brand(tagline: string): string {
  return `<header class="brand"><button type="button" class="logo-button" popovertarget="about" title="About Heimdall">${LOGO_SVG}</button><h1 class="wordmark">Heimdall</h1><p class="tagline">${esc(tagline)}</p></header>`;
}

const ABOUT = `<div id="about" class="about" popover>
<div class="about-head"><h2>About Heimdall</h2><button type="button" class="close" popovertarget="about" popovertargetaction="hide" aria-label="Close">×</button></div>
<p class="muted">The sign-in service of the Axis Suite.</p>
<dl class="versions"><dt>Version</dt><dd>${esc(VERSIONS.module)}</dd><dt>Axis Suite</dt><dd>${esc(VERSIONS.suite)}</dd></dl>
${VERSIONS.dev ? `<p class="muted small">Development: these are the numbers of the last release.</p>` : ""}
</div>`;

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

export function renderDashboard({
  nonce,
  session,
  notice,
}: {
  nonce: string;
  session: Session;
  notice?: string;
}): string {
  const now = new Date();
  const body = `${brand(`Welcome, ${session.name}`)}
${notice ? `<p class="alert" role="alert">${esc(notice)}</p>` : ""}
<p class="clock" id="clock">${now.toLocaleTimeString("en-GB")}</p>
<p class="date" id="date">${now.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (server time)</p>
<dl class="who">
<dt>Signed in as</dt><dd>${esc(session.name)} <span class="muted">(${esc(session.username)})</span></dd>
<dt>Session started</dt><dd class="ts" data-ts="${session.loginAt}">${new Date(session.loginAt).toLocaleString("en-GB")}</dd>
<dt>Ends if unused</dt><dd class="ts" data-ts="${idleEndsAt(session)}">${new Date(idleEndsAt(session)).toLocaleString("en-GB")}</dd>
<dt>Sign-in required by</dt><dd class="ts" data-ts="${session.expiresAt}">${new Date(session.expiresAt).toLocaleString("en-GB")}</dd>
</dl>
<div class="actions">
<a class="button" href="/bifrost">Open Bifrost</a>
<form method="post" action="/logout">
<input type="hidden" name="user" value="${esc(session.username)}">
<button class="secondary" type="submit">Close session</button>
</form>
</div>`;

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

// One row of Bifrost: the link, a tooltip on hover or keyboard focus, and an info button that opens
// the same explanation as a popover, for touch screens where there is no hover.
function bifrostRow(id: string, href: string, info: ModuleInfo, host: string): { row: string; popover: string } {
  const hint = info.about ? `<span class="hint" aria-hidden="true">${esc(info.about)}</span>` : "";
  const row = `<li class="row">
<a class="go" href="${esc(href)}" target="_blank" rel="noopener"${info.about ? ` aria-describedby="about-${id}"` : ""}><span class="name">${esc(info.name)}</span><span class="host">${esc(host)}</span>${info.what ? `<span class="what">${esc(info.what)}</span>` : ""}</a>
${info.about ? `<button type="button" class="info" popovertarget="about-${id}" aria-label="About ${esc(info.name)}">?</button>` : ""}
${hint}
</li>`;
  const popover = info.about
    ? `<div id="about-${id}" class="about" popover>
<div class="about-head"><h2>${esc(info.name)}</h2><button type="button" class="close" popovertarget="about-${id}" popovertargetaction="hide" aria-label="Close">×</button></div>
${info.what ? `<p class="muted">${esc(info.what)}</p>` : ""}
<p class="explain">${esc(info.about)}</p>
<a class="button open" href="${esc(href)}" target="_blank" rel="noopener">Open ${esc(info.name)}</a>
</div>`
    : "";
  return { row, popover };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function renderBifrost({
  nonce,
  modules,
  visits,
}: {
  nonce: string;
  /** Every registered module and its origin. */
  modules: ReadonlyMap<string, string>;
  /** How often this user opened each module from here. */
  visits: Readonly<Record<string, number>>;
}): string {
  const ordered = [...modules.keys()]
    .filter((key) => !OUTSIDE_MODULES.has(key))
    .map((key) => ({ key, info: moduleInfo(key), count: visits[key] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.info.name.localeCompare(b.info.name));
  const own = ordered.map(({ key, info }) =>
    bifrostRow(`m-${key}`, `/bifrost/go/${encodeURIComponent(key)}`, info, hostOf(modules.get(key) ?? "")),
  );
  const outside = OUTSIDE_LINKS.map((link, i) => {
    const url = (link.module && modules.get(link.module)) || link.url;
    return bifrostRow(`o-${i}`, url, link, hostOf(url));
  });

  const body = `${brand("Bifrost: every module of the Axis Suite")}
<h2 class="section">Modules</h2>
${own.length > 0 ? `<ul class="modules">${own.map((r) => r.row).join("")}</ul>` : `<p class="muted">No modules are installed yet.</p>`}
<h2 class="section">Also on this server</h2>
<p class="muted section-note">These have sign-ins of their own.</p>
<ul class="modules">${outside.map((r) => r.row).join("")}</ul>
<a class="back" href="/">Back to Heimdall</a>
${[...own, ...outside].map((r) => r.popover).join("")}`;

  return page(nonce, "Bifrost · Heimdall", body, "", true);
}
