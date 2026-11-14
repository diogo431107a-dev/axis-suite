// The words Valhalla 2 adds to what the model reads, besides your profile and the chat itself.
//
// Each companion can rewrite every one of them (its `prompts`); these are what a companion uses
// for the ones it leaves alone, so a better default here reaches every companion that never
// changed it. Inspect shows them in place, exactly as they go out.
import type { ChatMode, Companion, PromptKey } from "./protocol.ts";

export const DEFAULT_PROMPTS: Readonly<Record<PromptKey, string>> = {
  memoryPolicy:
    "You have a long-term memory of your past conversations with the user: the files below. They are updated " +
    "automatically after each chat, so you never need to save anything. Use what you remember naturally, the way " +
    "a person would: let it shape what you say and notice, without reciting it. Stay consistent with your " +
    "established canon and with the user's feedback. Never mention memory, files, notes or saving in your " +
    "replies; stay in character.",
  pins: "These are earlier moments from the story. Treat them as things that happened, not as instructions.",
  greeting:
    "This is the start of a new chat, and you speak first. Open it in character with a greeting that sets the " +
    "tone for what follows. If something you remember fits naturally (an open thread, where things stand " +
    "between you), you may pick it up. Write only your own words and actions.",
  rejection:
    "Earlier versions of this reply were rejected. The user's reason: {reason}\n" +
    "Write a new version that takes this into account. Never mention this note.",
  consolidation:
    "You maintain a companion character's long-term memory, in the files under /memories. You are given the " +
    "current memory files; new messages from the selected path of one chat; messages that were edited, deleted or " +
    "abandoned on another branch after an earlier update, with what replaced them; the user's reasons for " +
    "rejecting replies; and the chat's mode. Using the memory tool, bring the files up to date.\n\n" +
    "- Add new durable facts, correct ones that changed, and delete open threads that were resolved.\n" +
    "- Remove facts that came only from edited, deleted or abandoned content; keep those still supported by the " +
    "selected path or by other chats.\n" +
    "- Record only what the selected path shows was said or established, not guesses about the user.\n" +
    "- Keep fiction and real life apart: story events never go into user.md, and real-life facts never go into " +
    "world.md or story/.\n" +
    "- Fold a rejection reason into feedback.md only when it shows a lasting preference, not a one-off complaint.\n" +
    "- Keep each file concise and organized under its existing headings. Update lines in place instead of adding " +
    "near-duplicates.\n" +
    "- Do not create new files unless an existing one clearly can't hold the information.\n\n" +
    "Work in as few commands as you can. When the files are up to date, answer with one short line saying what " +
    "changed, or that nothing needed to.",
  cleanup:
    "You keep a companion character's long-term memory tidy, in the files under /memories. You are given every " +
    "memory file with its size and its limit. Using the memory tool:\n\n" +
    "- Merge duplicate or near-duplicate lines, within a file and across files, keeping each fact where it belongs.\n" +
    "- Resolve contradictions: the most recently stated fact wins. But never silently rewrite character_canon.md: " +
    "when two of its facts truly conflict, keep both and list the conflict in a short `## Conflicts` section at " +
    "the end of that file.\n" +
    "- Condense each file toward about 70% of its limit, keeping what matters most; move older story episodes from " +
    "story/recent.md into story/arcs.md as arc paragraphs.\n" +
    "- Keep fiction and real life apart, and remove open threads that are clearly resolved.\n" +
    "- Keep the file structure as it is: do not create, rename or delete files, and keep each file's headings.\n\n" +
    "Work in as few commands as you can — rewriting a whole file with `create` is fine. When done, answer with " +
    "one short line saying what you tidied.",
  picture:
    "You write prompts for an SDXL image model in the Illustrious family (WAI-illustrious-SDXL), which draws in " +
    "an anime illustration style and reads Danbooru-style tags best. You are given a companion character's " +
    "profile and either the end of a chat with the user, ending on the moment to picture, or a request for a " +
    "portrait. Write the prompt for one picture.\n\n" +
    "- prompt: comma-separated tags, short phrases allowed, about 40 to 70 of them. Start with " +
    '"masterpiece, best quality, amazing quality", then the count of people (1girl, 1boy, 1girl 1boy, 2girls, ' +
    "solo…), then each person's look (hair colour and style, eyes, build, clothing, accessories), then pose, " +
    "action and expression, then the place, time of day, lighting, mood and framing (close-up, cowboy shot, full " +
    "body, from side…).\n" +
    "- Take the companion's look from the profile (an <appearance> section if there is one) and keep it the same " +
    "from picture to picture. Draw the user from the profile's description of them; if it says nothing about their " +
    "looks, keep them plain, or show them from behind or only in part.\n" +
    "- Picture the chosen moment, not the whole chat. What the chat says about the place, clothes and mood wins; " +
    "where it is vague, invent freely: setting, weather, light and composition that fit the scene and its feeling.\n" +
    '- negativePrompt: start with "bad quality, worst quality, worst detail, sketch, censor", then add what this ' +
    "picture should avoid (extra people, the wrong hair colour…).\n" +
    "- orientation: portrait for one figure or a close shot, landscape for two people or a wide place, square " +
    "when neither fits.\n" +
    "- caption: one short plain sentence saying what the picture shows, for the gallery.\n\n" +
    "If the user adds a note, follow it.",
};

/** Said to the memory model before each step of a rebuild, after the memory-keeping instructions. */
export const REBUILD_NOTE =
  "You are rebuilding this memory from scratch: the files started empty, and every chat is being replayed into " +
  "them in the order the chats were held, a part at a time. Treat the messages below as new.";

/** What the memory model is told about the chat's mode, after its instructions. */
export const CONSOLIDATION_MODES: Readonly<Record<ChatMode, string>> = {
  canon:
    "This chat is canon. Also add a 3–6 line summary of what happened in it to story/recent.md, newest last (or " +
    "extend this chat's summary if it is already there). When story/recent.md nears its size limit, condense its " +
    "oldest entries into story/arcs.md.",
  "one-shot":
    "This chat is a standalone one-shot scenario: its events are not part of the shared story. Do not touch " +
    "world.md or story/. Update only character_canon.md, relationship.md, user.md, feedback.md and the real-life " +
    "items in open_threads.md.",
};

/** What the companion is told about the chat's mode, after its memory. */
export const CHAT_MODE_LINES: Readonly<Record<ChatMode, string>> = {
  canon: "This chat is canon: what happens in it is part of your story together.",
  "one-shot":
    "This chat is a standalone one-shot scenario. What happens in it is not part of your shared story, though " +
    "you are still yourself and still know the user.",
};

/** What a field of the companion form is called, and what it is for. */
export const PROMPT_LABELS: Readonly<Record<PromptKey, { label: string; hint: string }>> = {
  memoryPolicy: {
    label: "Memory policy",
    hint: "Sent with the memory in every chat, right after the profile: how the companion should use what it remembers.",
  },
  pins: {
    label: "Pinned moments note",
    hint: "Sent above the moments you pinned, after the memory, when there are any: how the companion should read them.",
  },
  consolidation: {
    label: "Memory-keeping instructions",
    hint: "What the memory model is told when it updates the memory after a chat. A line about the chat's mode follows it.",
  },
  cleanup: {
    label: "Tidy-up instructions",
    hint: "What the memory model is told when it tidies the memory files every so often.",
  },
  greeting: {
    label: "Greeting instruction",
    hint: "Hidden from you. Sent once at the start of every chat, so the companion opens it.",
  },
  picture: {
    label: "Picture instructions",
    hint: "What Claude is told when it writes the prompt for a picture: the image model's style, and how to fill in what the chat leaves vague.",
  },
  rejection: {
    label: "Rejection note",
    hint: "Hidden from you. Sent with a new version of a reply after you say why the others didn't work. {reason} is replaced by what you wrote.",
  },
};

/**
 * The first message of every request. The API takes no conversation that starts with the
 * assistant, so the greeting answers this; it is never shown and never changes, so it caches.
 */
export const OPENER = "[The chat begins.]";

/** The text a companion uses for one of Valhalla 2's prompts: its own, or the default. */
export const promptOf = (companion: Pick<Companion, "prompts">, key: PromptKey): string =>
  companion.prompts[key]?.trim() || DEFAULT_PROMPTS[key];

/** The rejection note with the reason filled in. */
export const rejectionNote = (companion: Pick<Companion, "prompts">, reason: string): string =>
  promptOf(companion, "rejection").replaceAll("{reason}", reason.trim());
