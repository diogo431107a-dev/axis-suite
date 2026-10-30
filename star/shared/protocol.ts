// The API's wire format, used by the server and the page.

/** A page names the user whose sky it shows, so its changes can't land on someone else's. */
export const USER_HEADER = "X-Star-User";

export const LIMITS = {
  name: 200,
  relation: 100,
  memo: 20_000,
  starsPerUser: 2_000,
  linksPerUser: 5_000,
  opsPerBatch: 500,
  /** How far from the middle of the sky a star can be placed. */
  coordinate: 1_000_000,
} as const;

/** How many colours a constellation can have; a main star's hue is one of 0 to HUES - 1. */
export const HUES = 6;

export interface Star {
  /** Made by the browser. */
  id: string;
  name: string;
  memo: string;
  /** The star this one is tied to; null for a main star, someone the user knows. */
  parent: string | null;
  /** What this star is to its parent ("Mark is Bob's brother"). Empty on a main star. */
  relation: string;
  /** The constellation's colour. Only a main star's counts. */
  hue: number;
  x: number;
  y: number;
}

/** A connection between two stars: "b is a's relation". */
export interface Link {
  id: string;
  a: string;
  b: string;
  relation: string;
}

export interface Sky {
  stars: Star[];
  links: Link[];
  /** Raised by every batch of changes, so a page can tell whether its sky is out of date. */
  rev: number;
}

export type Op =
  | { op: "addStar"; star: Star }
  | { op: "updateStar"; id: string; name?: string; memo?: string; relation?: string }
  | { op: "moveStars"; moves: { id: string; x: number; y: number }[] }
  /** Removes the star, every star charted around it, and their connections. */
  | { op: "removeStar"; id: string }
  /** Makes a relative a main star, with a connection to the star it was tied to. */
  | { op: "promoteStar"; id: string; hue: number; linkId: string }
  | { op: "addLink"; link: Link }
  | { op: "removeLink"; id: string };

export interface OpsRequest {
  /** Made by the page. Sending a batch again (its answer got lost) doesn't apply it twice. */
  batch: string;
  ops: Op[];
}

export interface OpsResult {
  rev: number;
}

export type ErrorCode = "invalid" | "not-found" | "too-many" | "other-user";

export interface ApiError {
  error: string;
  code?: ErrorCode;
}
