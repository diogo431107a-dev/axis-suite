// Rules the server enforces and the page explains beforehand.
import type { Source } from "./protocol.ts";

/** A breach needs evidence beyond my own conclusions: a suspicion can't prove itself. */
export function evidenceCanProveBreach(sources: readonly Source[]): boolean {
  return sources.some((source) => source !== "N");
}
