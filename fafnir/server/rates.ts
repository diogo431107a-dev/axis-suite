// The USD/BRL rate of each day: fetched from outside, kept in the database, and never needed to
// save an entry (the user can always type the dollars). Only the server talks to the sources, and
// it asks for the same pair whatever the users hold, so they learn nothing about anyone's money.
import type { DatabaseSync } from "node:sqlite";
import type { IsoDate, Rate } from "../shared/protocol.ts";

export const PTAX = "Banco Central (PTAX)";
export const FRANKFURTER = "Frankfurter";

export interface DayRate {
  date: IsoDate;
  value: number;
}

/** Fetches the rates of the days from `from` to `to`, both included. */
export type RateFetcher = (from: IsoDate, to: IsoDate) => Promise<DayRate[]>;

export interface RateSource {
  name: string;
  fetch: RateFetcher;
}

const TIMEOUT_MS = 6_000;
/** A longer gap than any run of weekend and holidays means the rates of those days are missing. */
const COVERED_DAYS = 6;
const REFRESH_DAYS = 10;
const REFRESH_EVERY_MS = 60 * 60 * 1000;
/** After a failure, entries are saved without waiting for the sources again for this long. */
const RETRY_AFTER_MS = 60 * 1000;

const plausible = (value: unknown): value is number => typeof value === "number" && value > 0.5 && value < 100;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

/** Brazil's central bank: the selling rate it publishes around midday on business days. */
export const fetchPtax: RateFetcher = async (from, to) => {
  const mdy = (date: IsoDate) => `${date.slice(5, 7)}-${date.slice(8, 10)}-${date.slice(0, 4)}`;
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${mdy(from)}'&@dataFinalCotacao='${mdy(to)}'&$format=json`;
  const { value } = (await fetchJson(url)) as { value: { cotacaoVenda: number; dataHoraCotacao: string }[] };
  return value.map((row) => ({ date: row.dataHoraCotacao.slice(0, 10), value: row.cotacaoVenda }));
};

/** The same figures through a second service, for when the bank's site is down. */
export const fetchFrankfurter: RateFetcher = async (from, to) => {
  const url = `https://api.frankfurter.dev/v2/rates?providers=BCB&base=USD&quotes=BRL&from=${from}&to=${to}`;
  const rows = (await fetchJson(url)) as { date: string; rate: number }[];
  return rows.map((row) => ({ date: row.date, value: row.rate }));
};

export const SOURCES: RateSource[] = [
  { name: PTAX, fetch: fetchPtax },
  { name: FRANKFURTER, fetch: fetchFrankfurter },
];

export const today = (): IsoDate => new Date().toISOString().slice(0, 10);

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last day of a month (YYYY-MM). */
export function lastDayOf(month: string): IsoDate {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/** The days a month's change in worth runs between: the eve of its first day, and its end or today. */
export function monthSpan(month: string): { start: IsoDate; end: IsoDate } {
  const last = lastDayOf(month);
  return { start: addDays(`${month}-01`, -1), end: last > today() ? today() : last };
}

export interface Rates {
  /** The rate of `date`, or of the closest day before it that has one. */
  lookup(date: IsoDate): Rate | null;
  /** Gets the rates around `date` from outside if they aren't known yet. Never throws. */
  ensure(date: IsoDate): Promise<void>;
  /** Gets the last few days' rates from outside. Never throws. */
  refresh(): Promise<void>;
  /** Refreshes now and every hour. Returns a function that stops it. */
  start(): () => void;
}

export function createRates(db: DatabaseSync, sources: RateSource[] = SOURCES): Rates {
  const select = db.prepare(`
    SELECT value, date, source FROM rates
    WHERE base = 'USD' AND quote = 'BRL' AND date <= ? ORDER BY date DESC LIMIT 1
  `);
  // The bank's own figure replaces a copy from elsewhere, never the other way round.
  const insert = db.prepare(`
    INSERT INTO rates (date, base, quote, value, source, fetched_at) VALUES (?, 'USD', 'BRL', ?, ?, ?)
    ON CONFLICT (base, quote, date) DO UPDATE
      SET value = excluded.value, source = excluded.source, fetched_at = excluded.fetched_at
      WHERE excluded.source = '${PTAX}' OR rates.source <> '${PTAX}'
  `);

  let lastFailure = 0;
  // One request at a time per range: a form asking twice shouldn't fetch twice.
  const running = new Map<string, Promise<void>>();

  async function fetchRange(from: IsoDate, to: IsoDate): Promise<void> {
    const failures: string[] = [];
    for (const source of sources) {
      try {
        const rows = (await source.fetch(from, to)).filter((row) => plausible(row.value));
        const at = new Date().toISOString();
        for (const row of rows) insert.run(row.date, row.value, source.name, at);
        lastFailure = 0;
        return;
      } catch (err) {
        failures.push(`${source.name}: ${(err as Error).message}`);
      }
    }
    lastFailure = Date.now();
    console.warn(`Could not fetch the rates of ${from} to ${to}. ${failures.join("; ")}`);
  }

  function once(from: IsoDate, to: IsoDate): Promise<void> {
    const key = `${from}..${to}`;
    let promise = running.get(key);
    if (!promise) {
      promise = fetchRange(from, to).finally(() => running.delete(key));
      running.set(key, promise);
    }
    return promise;
  }

  const rates: Rates = {
    lookup(date) {
      const row = select.get(date) as unknown as Rate | undefined;
      return row ? { value: row.value, date: row.date, source: row.source } : null;
    },

    async ensure(date) {
      const now = today();
      const day = date > now ? now : date;
      const known = rates.lookup(day);
      if (known && known.date >= addDays(day, -COVERED_DAYS)) return;
      if (Date.now() - lastFailure < RETRY_AFTER_MS) return;
      await once(addDays(day, -REFRESH_DAYS), day);
    },

    async refresh() {
      const now = today();
      await once(addDays(now, -REFRESH_DAYS), now);
    },

    start() {
      void rates.refresh();
      const timer = setInterval(() => void rates.refresh(), REFRESH_EVERY_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return rates;
}
