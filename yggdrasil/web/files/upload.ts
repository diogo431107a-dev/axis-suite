// Uploading files into a bullet: each file is sent as it is (with a preview made here for large
// images), then one change inserts their markup at the caret, so undo takes them all out again.
// The text refers to a file; the server keeps a file nothing refers to for 30 days.
import { IMAGE_TYPES, LIMITS, USER_HEADER, type UploadedFile } from "../../shared/protocol.ts";
import { READ_ONLY, type Outliner } from "../model/outliner.ts";
import type { Field } from "../model/ui.ts";
import { fileMarkup } from "../text/inline.ts";
import type { Upload } from "./uploads.ts";

/** The longest side of an image's preview, in pixels. */
const PREVIEW_PX = 1200;

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Sends a body to the API with XMLHttpRequest, which (unlike fetch) reports upload progress. */
function send(o: Outliner, method: string, url: string, body: Blob, progress?: (loaded: number) => void) {
  return new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader(USER_HEADER, o.username);
    if (progress) xhr.upload.onprogress = (e) => progress(e.loaded);
    xhr.onload = () => {
      let answer: unknown = null;
      try {
        answer = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // not JSON: a proxy's error page, say
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(answer);
      const error = (answer as { error?: unknown } | null)?.error;
      reject(
        new Error(
          xhr.status === 401
            ? "you are signed out"
            : typeof error === "string"
              ? error
              : `the server answered ${xhr.status}`,
        ),
      );
    };
    xhr.onerror = () => reject(new Error("the server can’t be reached"));
    xhr.send(body);
  });
}

/**
 * A smaller copy of an image for the outline to show (WebP, or JPEG where the browser can't make
 * WebP), or null if the image is small enough as it is or can't be read here.
 */
async function makePreview(file: File): Promise<Blob | null> {
  if (file.type !== "image/jpeg" && file.type !== "image/png" && file.type !== "image/webp") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, PREVIEW_PX / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= LIMITS.previewBytes) {
    bitmap.close();
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const [type, quality] of [
    ["image/webp", 0.82],
    ["image/jpeg", 0.85],
    ["image/jpeg", 0.6],
  ] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (blob?.type === type && blob.size <= LIMITS.previewBytes) return blob;
  }
  return null;
}

/** Uploads one file into bullet `id`, with its preview. Returns what the server saved. */
async function uploadOne(o: Outliner, id: string, file: File): Promise<UploadedFile> {
  const upload: Upload = { name: file.name, loaded: 0, total: file.size };
  o.uploads.add(upload);
  try {
    const url = `/api/files?node=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name || "file")}`;
    const saved = (await send(o, "POST", url, file, (loaded) => o.uploads.update(upload, loaded))) as UploadedFile;
    if (IMAGE_TYPES.has(saved.type)) {
      // Without a preview the outline shows the original, so a failure here only costs speed.
      const preview = await makePreview(file);
      if (preview) await send(o, "PUT", `/api/files/${saved.id}/preview`, preview).catch(() => {});
    }
    return saved;
  } finally {
    o.uploads.remove(upload);
  }
}

/**
 * Uploads files into bullet `id` and inserts them into its text or note (`field`): at the caret
 * if it is still there, else at `at`, else at the end.
 */
export async function attachFiles(
  o: Outliner,
  id: string,
  field: Field,
  files: readonly File[],
  at?: number,
): Promise<void> {
  if (files.length === 0) return;
  if (!o.canEdit(id)) return o.notice(READ_ONLY);
  const big = files.find((f) => f.size > LIMITS.fileBytes);
  if (big) return o.notice(`${big.name} is ${mb(big.size)}. A file can be at most ${mb(LIMITS.fileBytes)}.`);

  // The server only takes files into a bullet it knows, so a bullet just typed is saved first.
  try {
    await o.sync.whenSaved();
  } catch (e) {
    return o.notice(`Files can’t be uploaded now: ${(e as Error).message.toLowerCase()}.`);
  }
  const saved: UploadedFile[] = [];
  for (const file of files) {
    try {
      saved.push(await uploadOne(o, id, file));
    } catch (e) {
      o.notice(`${file.name} could not be uploaded: ${(e as Error).message}.`);
    }
  }
  const node = o.store.get(id);
  if (saved.length === 0 || !node || node.deletedAt !== null) return;

  // Where to insert: the caret, if the user is still in this field; else where they were.
  const text = node[field];
  const caret = o.ui.caret;
  const editing = caret?.id === id && caret.field === field;
  const ta = editing ? document.querySelector<HTMLTextAreaElement>(`[data-editor="${CSS.escape(id)}"]`) : null;
  const start = Math.min(ta?.selectionStart ?? at ?? text.length, text.length);
  const end = Math.max(start, Math.min(ta?.selectionEnd ?? start, text.length));
  const sep = field === "note" ? "\n" : " ";
  const markup = saved.map((f) => fileMarkup(f.name, `/api/files/${f.id}`, IMAGE_TYPES.has(f.type))).join(sep);
  const before = start > 0 && !/\s/.test(text[start - 1]!) ? " " : "";
  const after = end < text.length && !/\s/.test(text[end]!) ? " " : "";
  const inserted = before + markup + after;
  const next = text.slice(0, start) + inserted + text.slice(end);
  const offset = start + inserted.length;
  o.commit(
    { ops: [field === "content" ? { op: "update", id, content: next } : { op: "update", id, note: next }] },
    { after: { kind: "caret", id, field, start: offset, end: offset } },
  );
  if (editing) o.ui.setCaret(id, offset, field);
}

/** Asks for files to upload with the browser's file picker. */
export function pickFiles(onPick: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => onPick([...(input.files ?? [])]));
  input.click();
}

/** Whether a dropped file is an outline to import rather than a file to attach. */
export const isOutlineFile = (file: File): boolean => /\.(opml|xml)$/i.test(file.name);
