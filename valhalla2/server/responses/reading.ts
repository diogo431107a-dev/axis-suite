// A reading (../reading.ts) on a Responses API (Grok's, OpenAI's): one structured request, not
// streamed. As for a chat reply: effort goes out as the API's `reasoning.effort` (on Grok, max as
// xhigh), `store: false`, and caching is automatic, kept on one cache per companion and kind of
// reading by `prompt_cache_key`. The profile and memory go first, so that cache holds them.
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { dollarsOf } from "../../shared/price.ts";
import { blockText } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import type { ReadingAnswer, ReadingAsk } from "../reading.ts";
import { apiErrorOf, type ResponsesApi } from "./api.ts";
import { replyOf } from "./reply.ts";

/** The request as it goes to the API. */
export function readingRequest(api: ResponsesApi, ask: ReadingAsk): ResponseCreateParamsNonStreaming {
  return {
    model: ask.model,
    input: [
      { role: "system", content: ask.system },
      { role: "user", content: `${ask.background}\n\n${ask.moment}` },
    ],
    reasoning: { effort: api.effort[ask.effort] },
    max_output_tokens: 8_000,
    store: false,
    prompt_cache_key: ask.cacheKey,
    text: { format: { type: "json_schema", name: ask.name, schema: ask.schema, strict: true } },
  };
}

/** Reads the model's answer, or refuses with what the page shows. */
export function readingOf(api: ResponsesApi, response: Response, ask: ReadingAsk): ReadingAnswer {
  const { details, content } = replyOf(response, ask.model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.explanation ? `: ${details.stopDetails.explanation}` : "";
    throw new StoreError(422, `${api.name} declined to read ${ask.what}${why}.`, "api");
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, `${api.name} ran out of room reading ${ask.what}. Try again.`, "api");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.map(blockText).join(""));
  } catch {
    throw new StoreError(502, `${api.name}'s reading of ${ask.what} wasn't readable. Try again.`, "api");
  }
  return { raw, model: details.model ?? ask.model, cost: dollarsOf(details) };
}

/** Asks the API. */
export async function readOn(api: ResponsesApi, ask: ReadingAsk): Promise<ReadingAnswer> {
  let response: Response;
  try {
    response = await api.client().responses.create(readingRequest(api, ask));
  } catch (err) {
    throw apiErrorOf(api.vendor, err) ?? err;
  }
  return readingOf(api, response, ask);
}
