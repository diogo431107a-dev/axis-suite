import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Companion, type Message } from "../shared/protocol.ts";
import { OPENER } from "../shared/prompts.ts";
import { buildSystem, outgoing, promptView } from "./prompt.ts";

const companion: Companion = {
  id: "comp-0001",
  name: "Hrothgar",
  profile: "<personality>Proud.</personality>\n<user_persona>Eadric, a cup-bearer.</user_persona>",
  settings: { ...DEFAULT_SETTINGS, cacheTtl: "5m" },
  prompts: {},
  voice: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let next = 1;
const message = (role: "user" | "assistant", text: string, over: Partial<Message> = {}): Message => ({
  id: next++,
  parentId: null,
  role,
  content: [{ type: "text", text }],
  instruction: null,
  isGreeting: false,
  at: "2026-01-01T00:00:00.000Z",
  editedAt: null,
  reply: null,
  ...over,
});

const refused = {
  model: "m",
  stopReason: "refusal",
  stopDetails: null,
  usage: null,
  servedBy: null,
  declinedBy: null,
  attempts: null,
};

const roles = (path: Message[]) => outgoing(path).map((sent) => `${sent.role}${sent.hidden ? " (hidden)" : ""}`);

describe("the system prompt", () => {
  it("is the profile exactly as written, with the cache breakpoint after it", () => {
    expect(buildSystem(companion)).toEqual([
      { type: "text", text: companion.profile, cache_control: { type: "ephemeral", ttl: "5m" } },
    ]);
  });

  it("is nothing at all for an empty profile", () => {
    expect(buildSystem({ ...companion, profile: "" })).toEqual([]);
  });

  it("is the same text every time, so the cache hits", () => {
    expect(JSON.stringify(buildSystem(companion))).toBe(JSON.stringify(buildSystem({ ...companion })));
  });
});

describe("the messages", () => {
  it("open with a hidden user message, since the API takes no conversation that starts with a reply", () => {
    const greeting = message("assistant", "Hail.", { isGreeting: true, instruction: "Open the chat." });
    expect(roles([greeting])).toEqual(["user (hidden)", "system (hidden)", "assistant"]);
    expect(outgoing([greeting])[0]!.content).toBe(OPENER);
  });

  it("put a reply's instruction right before it, every time", () => {
    const path = [
      message("assistant", "Hail."),
      message("user", "My lord."),
      message("assistant", "Sit.", { instruction: "Be blunt." }),
      message("user", "Why?"),
    ];
    expect(roles(path)).toEqual(["user (hidden)", "assistant", "user", "system (hidden)", "assistant", "user"]);
  });

  it("end with the instruction of the reply being asked for", () => {
    const path = [message("assistant", "Hail."), message("user", "My lord.")];
    expect(outgoing(path, { instruction: "Be blunt." }).at(-1)).toEqual({
      role: "system",
      content: "Be blunt.",
      hidden: true,
    });
  });

  // An empty reply in the middle of a conversation is refused by the API, so a declined exchange
  // would break every turn after it.
  it("leave out a declined exchange: your message and the refusal", () => {
    const path = [
      message("assistant", "Hail."),
      message("user", "Tell me of the plague."),
      message("assistant", "", { reply: refused }),
      message("user", "Then, of the harvest."),
    ];
    expect(outgoing(path).map((sent) => (sent.hidden ? "-" : JSON.stringify(sent.content)))).toEqual([
      "-",
      JSON.stringify(path[0]!.content),
      JSON.stringify(path[3]!.content),
    ]);
  });

  it("leave out a declined greeting with its opener", () => {
    const path = [message("assistant", "", { reply: refused, instruction: "Open." }), message("user", "Hello?")];
    expect(roles(path)).toEqual(["user"]);
  });
});

describe("what Inspect shows", () => {
  it("is the system prompt and every message, the hidden ones marked", () => {
    const view = promptView(
      companion,
      buildSystem(companion),
      outgoing([message("assistant", "Hail.", { instruction: "Open." })]),
    );
    expect(view.system).toEqual(buildSystem(companion));
    expect(view.messages).toEqual([
      { role: "user", text: OPENER, hidden: true },
      { role: "system", text: "Open.", hidden: true },
      { role: "assistant", text: "Hail.", hidden: false },
    ]);
  });
});
