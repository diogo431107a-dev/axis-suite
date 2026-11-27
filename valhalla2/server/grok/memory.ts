// A run of the memory model for a Grok companion: Grok, with the memory tool, until it is done.
//
// Claude's runs use Anthropic's memory tool (../claude/memory.ts). xAI has no such tool, so here it
// is an ordinary function, `memory`, with the same six commands and the same arguments. Each call
// is carried out by the very handlers a Claude run uses (../memory/tool.ts): the same limits, the
// same one-shot lock, the same answers, the same memory_ops log. Only the loop around them differs:
//
// - Not streamed, and no stop sequences, as for Claude: nobody watches it, and a memory file may
//   well contain one.
// - `store: false`, so the whole run goes out with every step. Grok's reasoning comes back
//   encrypted and is sent back with the step after it, so the model keeps its train of thought.
// - Caching is automatic; `prompt_cache_key` keeps one run's steps on the same cache, so each step
//   reads the ones before it at the cached rate.
// - A refused command goes back as its error text, the way Claude's tool runner sends `is_error`,
//   so the model can condense and try again.
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  FunctionTool,
} from "openai/resources/responses/responses";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import { blockText, type Attempt } from "../../shared/protocol.ts";
import type { MemoryRunRequest, MemoryRunResult } from "../claude/memory.ts";
import { grokClient, grokError } from "./client.ts";
import { replyOf } from "./reply.ts";

/** The memory tool, described as a function: Grok has no built-in memory tool to lean on. */
export const MEMORY_FUNCTION: FunctionTool = {
  type: "function",
  name: "memory",
  description:
    "Reads and changes the companion's memory: Markdown files under /memories. The <current_memory> in the " +
    "prompt is exactly what the files hold right now, so there is no need to view them before changing them; " +
    "view a file again only to see its line numbers or a change you made. Commands:\n" +
    "- view: show a file with line numbers (optionally view_range [start, end], end -1 for the last line), " +
    "or list a directory.\n" +
    "- create: create a file with file_text, or replace a file's whole content.\n" +
    "- str_replace: replace old_str, which must appear exactly once in the file, with new_str.\n" +
    "- insert: insert insert_text after line insert_line (0 puts it first).\n" +
    "- delete: delete a file or directory.\n" +
    "- rename: move old_path to new_path.\n" +
    "Every path starts with /memories. A command that can't be done is refused with the reason, and " +
    "nothing changes: read the reason and do something else (condense, pick another line, leave a " +
    "read-only file alone). When memory is up to date, stop calling the tool and say in a sentence or " +
    "two what you changed.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", enum: ["view", "create", "str_replace", "insert", "delete", "rename"] },
      path: { type: "string", description: "The file or directory, e.g. /memories/user.md" },
      view_range: {
        type: "array",
        items: { type: "integer" },
        description: "view only: [start, end] line numbers, from 1; end -1 for the last line",
      },
      file_text: { type: "string", description: "create only: the file's whole content" },
      old_str: { type: "string", description: "str_replace only: the text to replace, exactly as it is" },
      new_str: { type: "string", description: "str_replace only: what replaces it" },
      insert_line: { type: "integer", description: "insert only: the line to insert after; 0 for the top" },
      insert_text: { type: "string", description: "insert only: the text to insert" },
      old_path: { type: "string", description: "rename only: the path to move" },
      new_path: { type: "string", description: "rename only: where it goes" },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

/** What the run does with one request: the server's sends it to xAI, the tests' answer from a script. */
export type ResponsesCall = (body: ResponseCreateParamsNonStreaming) => Promise<Response>;

const toXai: ResponsesCall = (body) => grokClient().responses.create(body);

/** One request of a run, as it goes to xAI. */
export function memoryRequestFor(
  request: MemoryRunRequest,
  input: ResponseInputItem[],
): ResponseCreateParamsNonStreaming {
  return {
    model: request.settings.memoryModel,
    input,
    tools: [MEMORY_FUNCTION],
    reasoning: { effort: "medium" },
    include: ["reasoning.encrypted_content"],
    max_output_tokens: 16_000,
    store: false,
    ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
  };
}

/** Carries out one call of the memory function. Says what the model is told, done or refused. */
async function carryOut(request: MemoryRunRequest, args: string): Promise<string> {
  let command: unknown;
  try {
    command = JSON.parse(args);
  } catch {
    return "Error: the arguments were not valid JSON.";
  }
  const name = (command as { command?: unknown } | null)?.command;
  if (typeof name !== "string" || !["view", "create", "str_replace", "insert", "delete", "rename"].includes(name)) {
    return `Error: unknown command ${JSON.stringify(name)}. Use view, create, str_replace, insert, delete or rename.`;
  }
  try {
    const answer = await request.tool.run(command as never);
    return typeof answer === "string" ? answer : answer.map((block) => ("text" in block ? block.text : "")).join("");
  } catch (err) {
    if (err instanceof ToolError) {
      const content = err.content;
      return typeof content === "string"
        ? content
        : content.map((block) => ("text" in block ? block.text : "")).join("");
    }
    // A missing argument shows up as a TypeError inside a handler: the model is told, not the run ended.
    if (err instanceof TypeError) return `Error: ${err.message}. Check the command's arguments.`;
    throw err;
  }
}

/**
 * Runs the memory model on Grok until it stops calling the memory function (or has used up its
 * steps). Same shape as Claude's run, so ../memory/run.ts treats both alike.
 */
export async function runGrokMemoryModel(
  request: MemoryRunRequest,
  call: ResponsesCall = toXai,
): Promise<MemoryRunResult> {
  const model = request.settings.memoryModel;
  const input: ResponseInputItem[] = [
    { role: "system", content: request.system },
    { role: "user", content: request.prompt },
  ];
  const attempts: Attempt[] = [];
  for (let step = 0; step < request.maxIterations; step++) {
    let response: Response;
    try {
      response = await call(memoryRequestFor(request, input));
    } catch (err) {
      throw grokError(err) ?? err;
    }
    const { details, content } = replyOf(response, model);
    if (details.usage) attempts.push({ ...details.usage, model: details.model });
    const text = content.map(blockText).join("").trim();
    if (details.stopReason !== "end_turn") {
      return { stopReason: details.stopReason, stopDetails: details.stopDetails, attempts, text };
    }
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return { stopReason: "end_turn", stopDetails: null, attempts, text };
    // Everything it said goes back, its reasoning included, then what each call came to.
    input.push(...(response.output as ResponseInputItem[]));
    for (const item of calls) {
      input.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: await carryOut(request, item.arguments),
      });
    }
  }
  // Out of steps with calls still unanswered, as Claude's runner ends: on tool use.
  return { stopReason: "tool_use", stopDetails: null, attempts, text: "" };
}
