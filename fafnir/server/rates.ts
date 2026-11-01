// The rate of each day, for reais and for coins: fetched from outside, kept in the database, and never
// needed to save an entry (the user can always type the dollars). Only the server talks to the sources,
// and it asks for the same pairs whatever the users hold, so they learn nothing about anyone's money.
import type { DatabaseSync } from "node:sqlite";
import type { Coin } from "../shared/currencies.ts";
import { USDC_PEG, type Currency, type IsoDate, type Rate, type RatedCurrency } from "../shared/protocol.ts";

export const PTAX = "Banco Central (PTAX)";
export const FRANKFURTER = "Frankfurter";
export const COINBASE = "Coinbase";
export const KRAKEN = "Kraken";

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

/** Which currencies have rates to fetch, each from its sources in order. */
export type RateSources = Partial<Record<RatedCurrency, RateSource[]>>;

interface PairRules {
  /** How the rate is stored: quote for one base. */
  base: string;
  quote: string;
  /** A longer gap than this before a day means the rates around it are missing. */
  coveredDays: number;
  refreshEveryMs: number;
  /** Anything outside this isn't a rate, whatever a source says. */
  least: number;
  most: number;
}

const MINUTE = 60 * 1000;

const PAIRS: Record<RatedCurrency, PairRules> = {
  // Business days only, so a long holiday weekend has to fit.
  BRL: { base: "USD", quote: "BRL", coveredDays: 6, refreshEveryMs: 60 * MINUTE, least: 0.5, most: 100 },
  // Coins trade around the clock, and What I'm worth should follow them.
  BTC: { base: "BTC", quote: "USD", coveredDays: 2, refreshEveryMs: 15 * MINUTE, least: 1, most: 100_000_000 },
  ICP: { base: "ICP", quote: "USD", coveredDays: 2, refreshEveryMs: 15 * MINUTE, least: 0.001, most: 1_000_000 },
  USDC: { base: "USDC", quote: "USD", coveredDays: 2, refreshEveryMs: 60 * MINUTE, least: 0.2, most: 2 },
};
const RATED = Object.keys(PAIRS) as RatedCurrency[];

const TIMEOUT_MS = 6_000;
const REFRESH_DAYS = 10;
const TICK_MS = 15 * MINUTE;
/** After a failure, entries are saved without waiting for the sources again for this long. */
const RETRY_AFTER_MS = 60 * 1000;
/** USDC counts as exactly $1 unless the market is further than this from it. */
const PEG_TOLERANCE = 0.01;

async function fetchJson(url: string): Promise<unknown> {
  // Coinbase refuses a request that doesn't say who is asking.
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "fafnir-personal-finances" },
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

const dayOf = (seconds: number): IsoDate => new Date(seconds * 1000).toISOString().slice(0, 10);

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

/**
 * Coinbase's daily closing price in dollars; today's is the latest so far. It keeps BTC from 2015 and
 * ICP from 2021, and answers at most 300 days at a time, more than `ensure` ever asks for.
 */
export const fetchCoinbase =
  (coin: Coin): RateFetcher =>
  async (from, to) => {
    const url =
      `https://api.exchange.coinbase.com/products/${coin}-USD/candles` +
      `?granularity=86400&start=${from}&end=${addDays(to, 1)}`;
    const rows = (await fetchJson(url)) as [number, number, number, number, number, number][];
    return rows
      .map(([time, , , , close]) => ({ date: dayOf(time), value: close }))
      .filter((row) => row.date >= from && row.date <= to);
  };

const KRAKEN_PAIRS: Record<Coin, string> = { BTC: "XBTUSD", ICP: "ICPUSD", USDC: "USDCUSD" };

/** Kraken's daily closing price in dollars. It only keeps about the last two years of them. */
export const fetchKraken =
  (coin: Coin): RateFetcher =>
  async (from, to) => {
    const since = Date.parse(`${addDays(from, -1)}T00:00:00Z`) / 1000;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_PAIRS[coin]}&interval=1440&since=${since}`;
    const { error, result } = (await fetchJson(url)) as {
      error: string[];
      result?: Record<string, [number, string, string, string, string][] | number>;
    };
    if (error.length > 0 || !result) throw new Error(`Kraken answered ${error.join(", ")}`);
    const rows = Object.entries(result).find(([key]) => key !== "last")?.[1];
    if (!Array.isArray(rows)) throw new Error("Kraken's answer has no prices");
    return rows
      .map(([time, , , , close]) => ({ date: dayOf(time), value: Number(close) }))
      .filter((row) => row.date >= from && row.date <= to);
  };

export const SOURCES: RateSources = {
  BRL: [
    { name: PTAX, fetch: fetchPtax },
    { name: FRANKFURTER, fetch: fetchFrankfurter },
  ],
  BTC: [
    { name: COINBASE, fetch: fetchCoinbase("BTC") },
    { name: KRAKEN, fetch: fetchKraken("BTC") },
  ],
  ICP: [
    { name: COINBASE, fetch: fetchCoinbase("ICP") },
    { name: KRAKEN, fetch: fetchKraken("ICP") },
  ],
  // Coinbase treats USDC and dollars as the same thing, so only Kraken shows a market price.
  USDC: [{ name: KRAKEN, fetch: fetchKraken("USDC") }],
};

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
  /**
   * What a currency is worth on `date`, or on the closest day before it that has a figure: reais per
   * dollar for BRL, dollars per coin for a coin. Null for USD, which needs none, and if nothing is known.
   */
  lookup(currency: Currency, date: IsoDate): Rate | null;
  /** Every currency's rate on a day, for a form. */
  lookupAll(date: IsoDate): Record<RatedCurrency, Rate | null>;
  /** Gets every currency's rates around `date` from outside if they aren't known yet. Never throws. */
  ensure(date: IsoDate): Promise<void>;
  /** Gets the last few days' rates of whatever is due. Never throws. */
  refresh(): Promise<void>;
  /** Refreshes now and from then on. Returns a function that stops it. */
  start(): () => void;
}

export function createRates(db: DatabaseSync, sources: RateSources = SOURCES): Rates {
  const select = db.prepare(`
    SELECT value, date, source FROM rates
    WHERE base = ? AND quote = ? AND date <= ? ORDER BY date DESC LIMIT 1
  `);
  // A pair's first source (?7) replaces a figure from a later one, never the other way round.
  const insert = db.prepare(`
    INSERT INTO rates (date, base, quote, value, source, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (base, quote, date) DO UPDATE
      SET value = excluded.value, source = excluded.source, fetched_at = excluded.fetched_at
      WHERE excluded.source = ?7 OR rates.source <> ?7
  `);

  const lastFailure = new Map<RatedCurrency, number>();
  const lastRefresh = new Map<RatedCurrency, number>();
  // Ranges a source has answered, so a day before a coin existed isn't asked about on every load.
  const answered = new Set<string>();
  // One request at a time per range: a form asking twice shouldn't fetch twice.
  const running = new Map<string, Promise<void>>();

  async function fetchRange(currency: RatedCurrency, from: IsoDate, to: IsoDate): Promise<void> {
    const pair = PAIRS[currency];
    const list = sources[currency] ?? [];
    const failures: string[] = [];
    for (const source of list) {
      try {
        const rows = await source.fetch(from, to);
        const at = new Date().toISOString();
        for (const { date, value } of rows) {
          if (typeof value !== "number" || !(value >= pair.least && value <= pair.most)) continue;
          insert.run(date, pair.base, pair.quote, value, source.name, at, list[0]!.name);
        }
        lastFailure.delete(currency);
        answered.add(`${currency}:${from}..${to}`);
        return;
      } catch (err) {
        failures.push(`${source.name}: ${(err as Error).message}`);
      }
    }
    if (list.length === 0) return;
    lastFailure.set(currency, Date.now());
    console.warn(`Could not fetch ${currency} rates of ${from} to ${to}. ${failures.join("; ")}`);
  }

  function once(currency: RatedCurrency, from: IsoDate, to: IsoDate): Promise<void> {
    const key = `${currency}:${from}..${to}`;
    let promise = running.get(key);
    if (!promise) {
      promise = fetchRange(currency, from, to).finally(() => running.delete(key));
      running.set(key, promise);
    }
    return promise;
  }

  /** What the database has, as it is: USDC's rule comes on top of this. */
  function stored(currency: RatedCurrency, date: IsoDate): Omit<Rate, "currency"> | null {
    const pair = PAIRS[currency];
    const row = select.get(pair.base, pair.quote, date) as unknown as Omit<Rate, "currency"> | undefined;
    return row ? { value: row.value, date: row.date, source: row.source } : null;
  }

  async function ensureOne(currency: RatedCurrency, date: IsoDate): Promise<void> {
    const now = today();
    const day = date > now ? now : date;
    const known = stored(currency, day);
    if (known && known.date >= addDays(day, -PAIRS[currency].coveredDays)) return;
    const from = addDays(day, -REFRESH_DAYS);
    if (answered.has(`${currency}:${from}..${day}`)) return;
    if (Date.now() - (lastFailure.get(currency) ?? 0) < RETRY_AFTER_MS) return;
    await once(currency, from, day);
  }

  const rates: Rates = {
    lookup(currency, date) {
      if (currency === "USD") return null;
      const known = stored(currency, date);
      if (currency === "USDC") {
        // Off its peg, the market's figure counts. Otherwise, or with no figure at all, it is a dollar.
        if (known && Math.abs(known.value - 1) > PEG_TOLERANCE) return { ...known, currency };
        return { value: 1, date, source: USDC_PEG, currency };
      }
      return known ? { ...known, currency } : null;
    },

    lookupAll(date) {
      return Object.fromEntries(RATED.map((c) => [c, rates.lookup(c, date)])) as Record<RatedCurrency, Rate | null>;
    },

    async ensure(date) {
      await Promise.all(RATED.map((currency) => ensureOne(currency, date)));
    },

    async refresh() {
      const now = today();
      const due = RATED.filter((c) => Date.now() - (lastRefresh.get(c) ?? 0) >= PAIRS[c].refreshEveryMs - MINUTE);
      await Promise.all(
        due.map((currency) => {
          lastRefresh.set(currency, Date.now());
          return once(currency, addDays(now, -REFRESH_DAYS), now);
        }),
      );
    },

    start() {
      void rates.refresh();
      const timer = setInterval(() => void rates.refresh(), TICK_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return rates;
}
