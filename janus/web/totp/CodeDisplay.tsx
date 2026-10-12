import { useEffect, useRef, useState } from "react";
import { totp, type TotpCode, type TotpParams } from "../../shared/totp.ts";
import { api, describeError } from "../api.ts";

/** A code split in two halves, as authenticator apps show it: "123 456". */
function spaced(code: string): string {
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

interface CodeRingProps {
  code: string;
  period: number;
  /** seconds left */
  remaining: number;
}

/** A TOTP code with a ring counting down its last seconds. */
export function CodeRing({ code, period, remaining }: CodeRingProps) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const ending = remaining <= 5;
  const left = Math.max(0, Math.ceil(remaining));
  return (
    <span className="inline-flex items-center gap-3">
      <span
        className={`font-mono text-2xl tracking-wider tabular-nums ${ending ? "text-red-600" : "text-gray-900"}`}
        aria-live="polite"
      >
        {spaced(code)}
      </span>
      <svg viewBox="0 0 24 24" className="w-6 h-6 -rotate-90 shrink-0" role="img" aria-label={`${left} seconds left`}>
        <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="3" className="stroke-gray-200" />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, remaining / period))}
          className={`transition-[stroke-dashoffset] duration-200 ease-linear ${ending ? "stroke-red-500" : "stroke-blue-600"}`}
        />
      </svg>
      <span className="text-xs text-gray-400 tabular-nums w-7">{left}s</span>
    </span>
  );
}

/** Re-renders a few times a second while mounted, for countdowns. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return now;
}

interface ServerCodeProps {
  entryId: string;
  /** a new rev (the TOTP may have changed) fetches again */
  rev: number;
  /** told each new code, so a shortcut can copy it */
  onCode: (code: string | null) => void;
  onError: (err: unknown) => void;
}

/**
 * A stored entry's current code. The server makes it (the secret stays there); the page asks for
 * the next one when the period ends. While the tab is hidden it doesn't ask: every request counts
 * as use of the Heimdall session, and a forgotten tab shouldn't keep a session alive.
 */
export function ServerCode({ entryId, rev, onCode, onError }: ServerCodeProps) {
  const [current, setCurrent] = useState<{ code: string; period: number; until: number } | null>(null);
  const [error, setError] = useState("");
  const now = useNow();
  // The latest callbacks, without making them dependencies of the fetching effect.
  const callbacks = useRef({ onCode, onError });
  callbacks.current = { onCode, onError };

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      try {
        const c = await api<TotpCode>(`/api/entries/${entryId}/totp`);
        if (stopped) return;
        setCurrent({ code: c.code, period: c.period, until: Date.now() + c.remaining * 1000 });
        setError("");
        callbacks.current.onCode(c.code);
        timer = setTimeout(load, c.remaining * 1000 + 100);
      } catch (err) {
        if (stopped) return;
        setCurrent(null);
        callbacks.current.onCode(null);
        setError(describeError(err));
        callbacks.current.onError(err);
        timer = setTimeout(load, 10_000);
      }
    };
    const onVisibility = () => {
      if (!document.hidden) load();
    };

    load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      callbacks.current.onCode(null);
    };
  }, [entryId, rev]);

  if (error) return <span className="text-sm text-red-600">{error}</span>;
  if (!current) return <span className="text-sm text-gray-400">Loading code…</span>;
  return <CodeRing code={current.code} period={current.period} remaining={(current.until - now) / 1000} />;
}

/** The code for parameters the page holds (while setting up a TOTP, before it is saved). */
export function LocalCode({ params }: { params: TotpParams }) {
  const [current, setCurrent] = useState<TotpCode | null>(null);
  const now = useNow();
  // Which period it is: a new code only when it changes, not on every tick.
  const step = Math.floor(now / (params.period * 1000));

  useEffect(() => {
    let stopped = false;
    totp(params, step * params.period * 1000).then((c) => !stopped && setCurrent(c));
    return () => {
      stopped = true;
    };
  }, [params, step]);

  if (!current) return null;
  const remaining = params.period - ((now / 1000) % params.period);
  return <CodeRing code={current.code} period={current.period} remaining={remaining} />;
}
