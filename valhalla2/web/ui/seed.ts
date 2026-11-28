// Picture seeds on the page: rolled as the server rolls them, and read from what is typed.
import { LIMITS } from "../../shared/protocol.ts";

/** A ten-digit seed, as Valhalla 2 rolls them: it fits in 32 bits too. */
export const rollSeed = (): number => 1_000_000_000 + Math.floor(Math.random() * (2 ** 32 - 1_000_000_000));

/** A seed typed in: digits only, up to ten of them; empty is null. */
export function seedFrom(typed: string): number | null {
  const digits = typed.replace(/\D/g, "").slice(0, String(LIMITS.pictureSeedMax).length);
  return digits === "" ? null : Number(digits);
}
