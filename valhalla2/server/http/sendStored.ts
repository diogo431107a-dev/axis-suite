// A kept file (a picture, a reply's audio) sent to its owner. Such a file never changes, since
// different content is a different file, so the browser may keep it for good; and it is served
// sandboxed, so it can never run as a page.
import type { Response } from "express";
import type { ApiError } from "../../shared/protocol.ts";

export function sendStored(res: Response, path: string, missing: string, contentType?: string): void {
  res.sendFile(
    path,
    {
      cacheControl: false,
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    },
    (err) => {
      // Its file is gone (deleted by hand, say), or the download was cut off.
      if (err && !res.headersSent) res.status(404).json({ error: missing } satisfies ApiError);
    },
  );
}
