// Where a picture's file is, and keeping an eye on pictures still being made.
import { useEffect, useRef } from "react";
import type { Picture } from "../../shared/protocol.ts";
import { api } from "../api.ts";

export const fileOf = (picture: Picture): string => `/api/pictures/${picture.id}/file`;

/**
 * Looks again every few seconds at the pictures still being made, and hands back each one that
 * has changed. Nothing is asked while none are working.
 */
export function useWatched(pictures: readonly Picture[], onChange: (picture: Picture) => void): void {
  const working = pictures
    .filter((picture) => picture.status === "working")
    .map((picture) => picture.id)
    .join(",");
  const told = useRef(onChange);
  told.current = onChange;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      for (const id of working.split(",")) {
        api<Picture>(`/api/pictures/${id}`)
          .then((picture) => {
            if (picture.status !== "working") told.current(picture);
          })
          .catch((err: unknown) => console.warn("Valhalla 2 could not look at a picture:", err));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [working]);
}
