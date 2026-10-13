// The map as a PNG picture: its SVG (svgExport.ts) painted on a canvas by the browser. The page's
// CSP allows images from data: addresses, not blob: ones, so the SVG goes in as a data: address.
// Browsers cap a canvas's size, iPhones and iPads more tightly, so a big map comes out smaller.
import type { ShownArrow } from "../layout/geometry.ts";
import type { Layout } from "../layout/layout.ts";
import { mapToSvg, svgSize } from "./svgExport.ts";

const MAX_SIDE = 16_384;
const isApple = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

/** The scale for a picture of `width` × `height` px: 2 (sharp on any screen) unless that is too big. */
export function pictureScale(width: number, height: number, maxArea: number): number {
  return Math.min(2, Math.sqrt(maxArea / (width * height)), MAX_SIDE / width, MAX_SIDE / height);
}

/** The picture, and the scale it came out at (below 1: smaller than on screen). */
export async function mapToPng(layout: Layout, arrows: readonly ShownArrow[]): Promise<{ blob: Blob; scale: number }> {
  const { width, height } = svgSize(layout, arrows);
  let scale = pictureScale(width, height, isApple() ? 16_700_000 : 64_000_000);
  for (let attempt = 0; attempt < 4; attempt++, scale /= 2) {
    const svg = mapToSvg(layout, arrows, { scale });
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    // Let the memory go: big canvases are heavy.
    canvas.width = 0;
    canvas.height = 0;
    if (blob) return { blob, scale };
  }
  throw new Error("The browser could not make a picture this big.");
}
