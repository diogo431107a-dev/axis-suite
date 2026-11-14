// What a turn cost, from the tokens the API reported and the published prices.
import { PRICES, type ReplyDetails, type TurnUsage } from "./protocol.ts";

/** Dollars for one attempt on one model, or null when its prices are unknown. */
export function dollarsFor(model: string | null | undefined, usage: TurnUsage): number | null {
  const price = model ? PRICES[model] : undefined;
  if (!price) return null;
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const prompt = usage.input_tokens + read + written;
  const rate = price.long && prompt > price.long.over ? price.long : price;
  // A cache write costs 1.25 times the input price for the 5-minute cache, twice for the hour.
  const writtenHour = Math.min(usage.cache_creation_1h_input_tokens ?? 0, written);
  const writeCost = (written - writtenHour) * rate.input * 1.25 + writtenHour * rate.input * 2;
  return (
    (usage.input_tokens * rate.input + writeCost + read * rate.cacheRead + usage.output_tokens * rate.output) /
    1_000_000
  );
}

/** What a reply cost across every attempt the API made, or null when any price is unknown. */
export function dollarsOf(turn: Pick<ReplyDetails, "attempts" | "usage" | "model">): number | null {
  const attempts = turn.attempts?.length
    ? turn.attempts
    : turn.usage
      ? [{ ...turn.usage, model: turn.model ?? null }]
      : [];
  if (attempts.length === 0) return null;
  let total = 0;
  for (const attempt of attempts) {
    const dollars = dollarsFor(attempt.model, attempt);
    if (dollars === null) return null;
    total += dollars;
  }
  return total;
}
