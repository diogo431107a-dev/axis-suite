// One real chat against the API, by hand, to prove the pipeline end to end.
//
//   pnpm smoke
//
// It spends money — a fraction of a cent on Haiku — which is why it is not part of `pnpm test`.
// CHAT_MODEL picks the model that answers. A grok- one makes a Grok companion, a gpt- one a GPT
// companion: the chat runs on that API, and so does its memory model, with the memory tool as a
// function (server/responses/memory.ts).
// It runs on a throwaway database in memory and goes through the same code the server uses: a
// greeting after the hidden opener, two turns, another version of the last reply, and an edit
// of the greeting before one more turn. The edit changes what the earlier thinking was bound to,
// so that last turn shows the API dropping that thinking instead of refusing the request. Then
// the memory model folds the chat into memory, and the memory files are printed.
//
// The profile is deliberately wordy, since the prompt cache ignores any prefix under 512 tokens
// and a two-line profile would never cache at all.
import { DEFAULT_SETTINGS, blockText, providerOf, type Message } from "../shared/protocol.ts";
import { createChats } from "../server/chat/chats.ts";
import { generate, send, type TurnContext } from "../server/chat/turn.ts";
import { chatWindow, runMemoryFor, writeReply } from "../server/chat/write.ts";
import { config } from "../server/config.ts";
import { consolidate } from "../server/memory/consolidate.ts";
import { createMemory } from "../server/memory/store.ts";
import { createCompanions } from "../server/companions.ts";
import { openDatabase } from "../server/db.ts";

const model = process.env.CHAT_MODEL || "claude-haiku-5-5";
// A Grok or GPT companion's memory model is its own chat model.
const ownMemory = providerOf(model) !== "anthropic";
const settings = {
  ...DEFAULT_SETTINGS,
  model,
  memoryModel: ownMemory ? model : DEFAULT_SETTINGS.memoryModel,
  maxTokens: 512,
  effort: "high" as const,
};

const filler = (what: string) =>
  Array.from(
    { length: 14 },
    (_, n) => `${what} ${n + 1}: he has said this before, and will again, and means it less each time.`,
  ).join(" ");

const profile = `<personality>
Hrothgar, an old king. Proud, and tired of being proud. ${filler("Habit")}
</personality>

<appearance>
Grey-bearded, in a mail shirt he no longer needs. ${filler("Detail")}
</appearance>

<behavior>
Stay in character. Write only his words and actions, never mine. Two sentences at most.
</behavior>

<user_persona>
Eadric, a cup-bearer who hears everything in the hall and repeats none of it.
</user_persona>`;

const db = openDatabase(":memory:");
const companions = createCompanions(db, "smoke", settings);
const companion = companions.save("smoke-companion", { name: "Hrothgar", profile, settings });
const chats = createChats(db, "smoke", companions, 5);
chats.create({ id: "smoke-chat-0001", companionId: companion.id });
const tree = chats.tree("smoke-chat-0001");

const memory = createMemory(db, config.memory);
const context: TurnContext = {
  db,
  tree,
  chatId: "smoke-chat-0001",
  companion,
  memory,
  window: await chatWindow(companion),
  write: writeReply,
  onEvent: (event) => {
    if (event.type === "delta") process.stdout.write(event.text);
  },
};

const report = (message: Message) => {
  const usage = message.reply?.usage;
  console.log(
    `\n  [${message.reply?.stopReason}] new ${usage?.input_tokens} · cached ${usage?.cache_read_input_tokens ?? 0} · written ${usage?.cache_creation_input_tokens ?? 0} · out ${usage?.output_tokens}\n`,
  );
};

console.log(`model: ${model}\n`);

process.stdout.write("Hrothgar (greeting): ");
const greeting = await generate(context, null);
report(greeting);

let last = greeting;
for (const said of ["My lord, the hall is asking for you.", "And if they ask again?"]) {
  process.stdout.write(`Eadric: ${said}\nHrothgar: `);
  last = await send(context, said);
  report(last);
}

process.stdout.write("Hrothgar (another version): ");
report(await generate(context, last.parentId));

tree.edit(greeting.id, `${greeting.content.map(blockText).join("")} *He does not look up.*`);
process.stdout.write("(greeting edited)\nEadric: Shall I bring the cup?\nHrothgar: ");
report(await send(context, "Shall I bring the cup?"));

console.log("If `cached` stays 0 after the first turns, the prompt cache is not working — look at");
console.log("server/prompt.ts for anything that differs between two requests. After the edit, a");
console.log("smaller `cached` is expected: everything after the greeting is new to the cache.\n");

console.log(`Folding the chat into memory with ${settings.memoryModel}…`);
const outcome = await consolidate(
  { db, memory, limits: config.memory, run: runMemoryFor, maxIterations: config.memoryIterations },
  "smoke-chat-0001",
  companion,
);
console.log(outcome);
const run = db.prepare("SELECT model, attempts FROM memory_runs ORDER BY id DESC LIMIT 1").get() as
  { model: string; attempts: string | null } | undefined;
console.log(`its requests on ${run?.model}:`, run?.attempts ? JSON.parse(run.attempts) : "none recorded", "\n");
for (const file of memory.files(companion.id)) console.log(`── /memories/${file.path}\n${file.content}`);
