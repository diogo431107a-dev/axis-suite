// Reading QR codes in the page: from a screenshot, an uploaded image, or camera frames. jsQR is
// plain JavaScript (no WebAssembly, so the site's CSP needs no change), loaded only when needed.
// Images are drawn from an ImageBitmap, never through a blob: URL, which the CSP doesn't allow.

type JsQR = typeof import("jsqr").default;
let jsQR: Promise<JsQR> | undefined;
const loadJsQR = () => (jsQR ??= import("jsqr").then((m) => m.default));

// Bigger images are scaled down first: decoding a 4K screenshot at full size takes seconds.
const MAX_SIDE = 2000;

let canvas: HTMLCanvasElement | undefined;

/** The text of a QR code in one frame of `source`, or null if there is none. */
export async function readQr(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  const decode = await loadJsQR();
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  canvas ??= document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, w, h);
  const { data } = context.getImageData(0, 0, w, h);
  return decode(data, w, h, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** The text of a QR code in an image file (a screenshot, a photo), or null if there is none. */
export async function readQrFromImage(image: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error("That file isn't an image this browser can read.");
  }
  try {
    return await readQr(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
