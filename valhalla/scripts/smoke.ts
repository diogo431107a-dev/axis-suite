// One real conversation against the API, by hand, to prove the pipeline end to end.
//
//   pnpm smoke
//
// It spends money — a fraction of a cent on Haiku — which is why it is not part of `pnpm test`.
// It sends two turns, because the second is the interesting one: `cached` should be most of the
// prompt. The character below is deliberately wordy, since the prompt cache ignores any prefix
// under 512 tokens and a two-line character would never cache at all.
import { DEFAULT_SETTINGS, type Character, type Persona, type Turn } from "../shared/protocol.ts";
import { countTokens, streamReply } from "../server/claude.ts";
import { buildSystem } from "../server/prompt.ts";

const settings = { ...DEFAULT_SETTINGS, model: "claude-haiku-5-5", maxTokens: 512, effort: "low" as const };

const filler = (what: string) =>
  Array.from(
    { length: 14 },
    (_, n) => `${what} ${n + 1}: he has said this before, and will again, and means it less each time.`,
  ).join(" ");

const character: Character = {
  id: "smoke-character",
  name: "Hrothgar",
  personality: `Proud, and tired of being proud. ${filler("Habit")}`,
  appearance: `Grey-bearded, in a mail shirt he no longer needs. ${filler("Detail")}`,
  behavior: "Stay in character. Write only his words and actions, never mine. Two sentences at most.",
  settings,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const persona: Persona = {
  id: "smoke-persona",
  name: "Eadric",
  description: "A cup-bearer who hears everything in the hall and repeats none of it.",
  appearance: "Thin, in borrowed clothes.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const system = buildSystem(character, persona, settings);
const turns: Turn[] = [];

const say = (text: string): Turn => ({
  id: `smoke-${turns.length}`,
  at: new Date().toISOString(),
  role: "user",
  content: [{ type: "text", text }],
});

console.log(`model: ${settings.model}`);
console.log(`system prompt: ${await countTokens(system, [], settings)} tokens\n`);

for (const message of ["My lord, the hall is asking for you.", "And if they ask again?"]) {
  turns.push(say(message));
  process.stdout.write(`Eadric: ${message}\nHrothgar: `);
  const reply = await streamReply(system, turns, settings, (event) => {
    if (event.type === "delta") process.stdout.write(event.text);
  });
  turns.push(reply);
  const usage = reply.usage;
  console.log(
    `\n  [${reply.stopReason}] new ${usage?.input_tokens} · cached ${usage?.cache_read_input_tokens ?? 0} · written ${usage?.cache_creation_input_tokens ?? 0} · out ${usage?.output_tokens}\n`,
  );
}

console.log("If `cached` is 0 on the second turn, the prompt cache is not working — look at");
console.log("server/prompt.ts for anything that differs between two requests.");
