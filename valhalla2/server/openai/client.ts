// The one place Valhalla 2 talks to the OpenAI API is this folder and ../responses/; this file holds
// the client.
//
// Everything a GPT companion asks goes here and nowhere else: its chat replies, its memory runs,
// its pictures' prompts, its scenes and the tags its replies are read aloud with. The requests are
// built by ../responses/, the same code a Grok companion's are. What is OpenAI's own:
//
//   key.ts       the key, from the systemd credential or OPENAI_API_KEY
//   client.ts    the client, and OPENAI: what sets it apart from xAI's API
//   tokens.ts    each model's context window, and counting a chat before it is sent
import type { Effort } from "../../shared/protocol.ts";
import type { ReasoningEffort } from "openai/resources/shared";
import { apiErrorOf, clientFor, needClient, type ResponsesApi } from "../responses/api.ts";
import { keySource } from "../responses/key.ts";
import { loadOpenAiKey } from "./key.ts";

const key = loadOpenAiKey();

/** The client, or null when the server has no OpenAI key. */
export const openai = clientFor(key);

/** Where the key came from, for the server's log. */
export const openAiKeySource = (): string => keySource(key, "OPENAI_API_KEY", "none set: no GPT models");

/** Whether the server can call OpenAI. */
export const hasOpenAiKey = (): boolean => openai !== null;

/** The client, or the refusal the page shows when there is no key. */
export const openAiClient = () => needClient(openai, "OpenAI");

/** An OpenAI API failure as something the page can show, or null when `err` is not one. */
export const openAiError = (err: unknown) => apiErrorOf("OpenAI", err);

/** Each of Valhalla 2's efforts as OpenAI takes it: the same five, "max" included. */
export const OPENAI_EFFORT: Readonly<Record<Effort, ReasoningEffort>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** OpenAI's API, for ../responses/. Its reasoning models take no temperature. */
export const OPENAI: ResponsesApi = {
  provider: "openai",
  name: "GPT",
  vendor: "OpenAI",
  client: openAiClient,
  effort: OPENAI_EFFORT,
  temperature: false,
};
