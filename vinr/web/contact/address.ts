import type { Address } from "../../shared/protocol.ts";

/** An address as it is written on an envelope, one line per part. */
export function addressLines(a: Address): string[] {
  const street = [a.street, a.number].filter(Boolean).join(", ");
  const place = [a.city, a.state].filter(Boolean).join(" – ");
  return [
    [street, a.complement].filter(Boolean).join(", "),
    a.district,
    [place, a.postalCode].filter(Boolean).join(", "),
    a.country,
  ].filter(Boolean);
}

/** A Google Maps search for an address (opened only by the user's click). */
export const mapsLink = (a: Address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLines(a).join(", "))}`;
