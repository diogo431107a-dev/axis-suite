// The one place Valhalla 2 talks to the xAI API is this folder and ../responses/; this file holds
// the client.
//
// Everything a Grok companion asks goes here and nowhere else: its chat replies, its memory runs,
// its pictures' prompts, its scenes and the tags its replies are read aloud with. xAI speaks OpenAI's
// Responses API, so the client is the `openai` SDK pointed at api.x.ai, and the requests are built
// by ../responses/, the same code an OpenAI companion's are. What is Grok's own:
//
//   key.ts       the key, from the systemd credential or XAI_API_KEY
//   client.ts    the client, and GROK: what sets Grok apart from OpenAI's API
//   tokens.ts    each model's context window
import type { Effort } from "../../shared/protocol.ts";
import type { ReasoningEffort } from "openai/resources/shared";
import { apiErrorOf, clientFor, needClient, type ResponsesApi } from "../responses/api.ts";
import { keySource } from "../responses/key.ts";
import { loadXaiKey } from "./key.ts";

const key = loadXaiKey();

/** The client, or null when the server has no xAI key. */
export const grok = clientFor(key, "https://api.x.ai/v1");

/** Where the key came from, for the server's log. */
export const grokKeySource = (): string => keySource(key, "XAI_API_KEY", "none set: no Grok models");

/** Whether the server can call Grok. */
export const hasGrokKey = (): boolean => grok !== null;

/** The client, or the refusal the page shows when there is no key. */
export const grokClient = () => needClient(grok, "Grok");

/** An xAI API failure as something the page can show, or null when `err` is not one. */
export const grokError = (err: unknown) => apiErrorOf("Grok", err);

/** Each of Valhalla 2's efforts as Grok takes it: Grok has no "max", so it goes out as "xhigh". */
export const GROK_EFFORT: Readonly<Record<Effort, ReasoningEffort>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

/** xAI's API, for ../responses/. */
export const GROK: ResponsesApi = {
  provider: "xai",
  name: "Grok",
  vendor: "Grok",
  client: grokClient,
  effort: GROK_EFFORT,
  temperature: true,
};
