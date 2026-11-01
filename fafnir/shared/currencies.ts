// Every currency Fafnir knows, and the arithmetic that depends on it. Amounts are always whole numbers
// of a currency's smallest unit (cents, satoshis), so a sum is never off by a rounding error.

export const CURRENCIES = ["USD", "BRL", "BTC", "ICP", "USDC"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const FIAT = ["USD", "BRL"] as const satisfies readonly Currency[];
export const COINS = ["BTC", "ICP", "USDC"] as const satisfies readonly Currency[];
export type Coin = (typeof COINS)[number];

export interface CurrencyInfo {
  name: string;
  /** How many decimal places its smallest unit is worth. */
  decimals: number;
  /** How many of them are always shown; the rest only if they aren't zeros. */
  shown: number;
  /** The largest amount of one entry, in smallest units. */
  largest: number;
}

const LARGEST_FIAT = 50_000_000_000;
const LARGEST_COIN = 1_000_000_000_000_000;

export const CURRENCY_INFO: Record<Currency, CurrencyInfo> = {
  USD: { name: "US dollars", decimals: 2, shown: 2, largest: LARGEST_FIAT },
  BRL: { name: "Brazilian reais", decimals: 2, shown: 2, largest: LARGEST_FIAT },
  BTC: { name: "Bitcoin", decimals: 8, shown: 8, largest: LARGEST_COIN },
  ICP: { name: "Internet Computer", decimals: 8, shown: 4, largest: LARGEST_COIN },
  USDC: { name: "USD Coin", decimals: 6, shown: 2, largest: LARGEST_COIN },
};

export const isCoin = (currency: unknown): currency is Coin => COINS.includes(currency as Coin);

/** How many smallest units make one whole unit. */
export const unitOf = (currency: Currency): number => 10 ** CURRENCY_INFO[currency].decimals;

/**
 * An amount as digits, like 1234.50 or 0.00500000, always exact: it is worked out from the whole
 * number, never through a fraction. Without a sign, and with thousands separators if `grouped`.
 */
export function amountDigits(amount: number, currency: Currency, grouped = false): string {
  const { decimals, shown } = CURRENCY_INFO[currency];
  const unit = unitOf(currency);
  const size = Math.abs(amount);
  const whole = Math.floor(size / unit);
  const fraction = String(size % unit)
    .padStart(decimals, "0")
    .replace(/0+$/, "")
    .padEnd(shown, "0");
  const wholeText = grouped ? whole.toLocaleString("en-US") : String(whole);
  return fraction ? `${wholeText}.${fraction}` : wholeText;
}

/** What an amount is worth in US cents, at a rate: reais per dollar for BRL, dollars per coin for a coin. */
export function usdCents(amount: number, currency: Currency, rate: number): number {
  if (currency === "USD") return amount;
  if (currency === "BRL") return Math.round(amount / rate);
  return Math.round((amount / unitOf(currency)) * rate * 100);
}

/** The other way: how much of a currency some US cents buy, at a rate. */
export function fromUsdCents(usd: number, currency: Currency, rate: number): number {
  if (currency === "USD") return usd;
  if (currency === "BRL") return Math.round(usd * rate);
  return Math.round((usd / 100 / rate) * unitOf(currency));
}
