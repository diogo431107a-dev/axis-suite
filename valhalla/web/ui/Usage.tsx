// What the last reply cost, and how much of the context window the conversation now fills.
//
// This is shown rather than assumed on purpose. The prompt cache only holds a prefix of at least
// 512 tokens, so a thin character definition quietly will not cache at all — and the only way to
// know caching is working is to watch "cached" climb turn after turn.
import { MODELS, type TokenView, type Turn } from "../../shared/protocol.ts";

const count = (n: number): string => n.toLocaleString("en-US");

/** What this turn cost, when the model's prices are known. */
function priceOf(turn: Turn): string | null {
  const model = MODELS.find((entry) => entry.id === turn.model);
  const usage = turn.usage;
  if (!model || !usage) return null;
  const dollars =
    (usage.input_tokens * model.input +
      (usage.cache_creation_input_tokens ?? 0) * model.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * model.cacheRead +
      usage.output_tokens * model.output) /
    1_000_000;
  return dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;
}

export function Usage({ last, tokens }: { last: Turn | null; tokens: TokenView | null }) {
  const usage = last?.usage ?? null;
  const price = last ? priceOf(last) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-faint">
      {tokens ? (
        <span title="What this conversation sends as it stands, against the model's context window">
          context {count(tokens.inputTokens)}
          {tokens.contextWindow ? ` / ${count(tokens.contextWindow)}` : ""}
        </span>
      ) : null}
      {usage ? (
        <>
          <span title="Tokens paid for at full price">new {count(usage.input_tokens)}</span>
          <span title="Tokens served from the prompt cache. This should grow turn after turn.">
            cached {count(usage.cache_read_input_tokens ?? 0)}
          </span>
          <span title="Tokens written into the cache this turn">
            written {count(usage.cache_creation_input_tokens ?? 0)}
          </span>
          <span title="Tokens the model wrote">out {count(usage.output_tokens)}</span>
          {price ? <span title="What this one turn cost, at the published prices">{price}</span> : null}
        </>
      ) : null}
    </div>
  );
}
