// Who is signed in comes from Heimdall: we forward the browser's cookie to its /whoami endpoint.
const HEIMDALL_INTERNAL_URL = process.env.HEIMDALL_INTERNAL_URL ?? 'http://127.0.0.1:3000';
// Where the browser goes to sign in or manage its session.
export const HEIMDALL_PUBLIC_URL = process.env.HEIMDALL_PUBLIC_URL ?? 'http://127.0.0.1:3000';

// The Heimdall cookie is also sent by sibling subdomains, so writes must come from our own page:
// JSON bodies need a CORS preflight we never grant, and a foreign Origin is refused outright.
export function sameOriginWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { /* malformed: treat as foreign */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request refused' });
  }
  if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected application/json' });
  }
  next();
}

export async function requireUser(req, res, next) {
  let r;
  try {
    r = await fetch(`${HEIMDALL_INTERNAL_URL}/whoami`, {
      headers: { cookie: req.get('cookie') ?? '' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error('Heimdall unreachable:', err.message);
    return res.status(503).json({ error: 'Sign-in service unavailable' });
  }
  if (r.status === 401) {
    return res.status(401).json({ error: 'Not signed in', loginUrl: HEIMDALL_PUBLIC_URL });
  }
  if (!r.ok) {
    console.error(`Heimdall /whoami returned ${r.status}`);
    return res.status(503).json({ error: 'Sign-in service unavailable' });
  }
  const { username, name } = await r.json();
  req.user = { username, name };
  next();
}
