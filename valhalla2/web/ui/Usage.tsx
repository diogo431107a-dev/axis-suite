// What the last reply cost, and how much of the context window the conversation now fills.
//
// This is shown rather than assumed on purpose. The prompt cache only holds a prefix of at least
// 512 tokens, so a thin character definition quietly will not cache at all — and the only way to
// know caching is working is to watch "cached" climb turn after turn.
import { dollarsOf } from "../../shared/price.ts";
import type { ReplyDetails, TokenView } from "../../shared/protocol.ts";

const count = (n: number): string => n.toLocaleString("en-US");

/** What this turn cost, when every model's prices are known. */
function priceOf(turn: ReplyDetails): string | null {
  const dollars = dollarsOf(turn);
  if (dollars === null) return null;
  return dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;
}

export function Usage({ last, tokens }: { last: ReplyDetails | null; tokens: TokenView | null }) {
  const usage = last?.usage ?? null;
  const price = last ? priceOf(last) : null;
  // Without a count beforehand (Grok, or GPT when counting failed), the last reply's own input is the
  // nearest there is.
  const sentLast = usage
    ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    : null;
  const context = tokens?.inputTokens ?? sentLast;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-faint">
      {tokens ? (
        <span
          title={
            tokens.inputTokens === null
              ? "What the last reply sent, against the model's context window. This API can't count a chat before it is sent."
              : "What this chat sends as it stands, against the model's context window"
          }
        >
          context {context === null ? "—" : count(context)}
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
          {price ? (
            <span
              title={
                last?.attempts
                  ? "What this one turn cost at the published prices, every model that tried it included. A decline before any reply may not be billed."
                  : "What this one turn cost, at the published prices"
              }
            >
              {price}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
