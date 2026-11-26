// Each Grok model's context window. There is no way to count a chat before it is sent: xAI has no
// token-counting endpoint, so the page shows what the last reply actually sent instead.
import { grok } from "./client.ts";

const windows = new Map<string, number | null>();

/** The model's context window, as GET /v1/models/{id} reports it, asked once per model. */
export async function grokContextWindow(model: string): Promise<number | null> {
  const known = windows.get(model);
  if (known !== undefined) return known;
  if (!grok) return null;
  try {
    // `context_length` is xAI's own field; the OpenAI SDK's type doesn't know it.
    const info = (await grok.models.retrieve(model)) as unknown as { context_length?: unknown };
    const size = typeof info.context_length === "number" ? info.context_length : null;
    windows.set(model, size);
    return size;
  } catch {
    // An unknown or renamed model id: the page simply shows no window. Not worth refusing over.
    windows.set(model, null);
    return null;
  }
}
