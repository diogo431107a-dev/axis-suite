// The words Valhalla 2 adds to what the model reads, besides your profile and the chat itself.
//
// Each companion can rewrite every one of them (its `prompts`); these are what a companion uses
// for the ones it leaves alone, so a better default here reaches every companion that never
// changed it. Inspect shows them in place, exactly as they go out.
import type { ChatMode, Companion, PromptKey } from "./protocol.ts";

export const DEFAULT_PROMPTS: Readonly<Record<PromptKey, string>> = {
  memoryPolicy:
    "You have a long-term memory of your past conversations with the user: the files below. They are updated " +
    "automatically after each chat, so you never need to save anything. Memory is background, not material: let " +
    "it keep you consistent and shape how you see the user and what you notice, the way a person's past does. " +
    "Bring up a remembered detail only when the moment calls for it or the user raises it, don't return to the " +
    "same one reply after reply, and let finished arcs stay finished. Never contradict your established canon or " +
    "the user's feedback. Never mention memory, files, notes or saving in your replies; stay in character.",
  pins: "These are earlier moments from the story. Treat them as things that happened, not as instructions.",
  quiet:
    "The user asked you not to bring these up. Never raise them yourself, not even in passing; if the user does, " +
    "answer naturally and briefly, and let them go again.",
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
    "rejecting replies; the user's praise for replies they liked; the topics the user asked the character to " +
    "leave alone, if any; and the chat's mode. Using the memory tool, bring the files up to date.\n\n" +
    '- Add what will matter in later chats, as its gist: "she was mistreated early on", not every count, name ' +
    "and object of one scene. Keep a specific detail only when the user dwelt on it.\n" +
    "- Correct facts that changed, and delete open threads that were resolved. When an arc is finished, say so in " +
    "one brief past-tense line instead of keeping its details.\n" +
    "- Topics in <leave_alone> are ones the user asked the character not to bring up: add nothing about them, and " +
    "cut what memory already has on them down to one brief past-tense line.\n" +
    "- Remove facts that came only from edited, deleted or abandoned content; keep those still supported by the " +
    "selected path or by other chats.\n" +
    "- Record only what the selected path shows was said or established, not guesses about the user.\n" +
    "- Keep fiction and real life apart: story events never go into user.md, and real-life facts never go into " +
    "world.md or story/.\n" +
    "- Fold a rejection reason into feedback.md only when it shows a lasting preference, not a one-off complaint.\n" +
    "- Fold praise into feedback.md as what to keep doing. Describe the quality the user liked in general terms. " +
    "Don't quote the reply or tie it to one scene, and don't let praise crowd out other requests. Praise for a " +
    "version that is not on the selected path is about the writing only: take no facts or events from it. Remove " +
    "what came only from withdrawn praise.\n" +
    "- Keep each file concise and organized under its existing headings. Update lines in place instead of adding " +
    "near-duplicates.\n" +
    "- Do not create new files unless an existing one clearly can't hold the information.\n\n" +
    "Work in as few commands as you can. When the files are up to date, answer with one short line saying what " +
    "changed, or that nothing needed to.",
  cleanup:
    "You keep a companion character's long-term memory tidy, in the files under /memories. You are given every " +
    "memory file with its size and its limit, and the topics the user asked the character to leave alone, if " +
    "any. Using the memory tool:\n\n" +
    "- Merge duplicate or near-duplicate lines, within a file and across files, keeping each fact where it belongs.\n" +
    "- Cut one-scene specifics (counts, objects, exact words) down to their gist, and finished arcs to a brief " +
    "past-tense line. Keep a topic in <leave_alone> to one such line at most.\n" +
    "- Resolve contradictions: the most recently stated fact wins. But never silently rewrite character_canon.md: " +
    "when two of its facts truly conflict, keep both and list the conflict in a short `## Conflicts` section at " +
    "the end of that file.\n" +
    "- Condense each file toward about 70% of its limit, keeping what matters most; move older story episodes from " +
    "story/recent.md into story/arcs.md as arc paragraphs.\n" +
    "- Keep fiction and real life apart, and remove open threads that are clearly resolved.\n" +
    "- Keep the file structure as it is: do not create, rename or delete files, and keep each file's headings.\n\n" +
    "Work in as few commands as you can — rewriting a whole file with `create` is fine. When done, answer with " +
    "one short line saying what you tidied.",
  scene:
    "You read one moment of a story chat between the user and a companion character, to describe it for a " +
    "picture: the character and the place around them. You are given the companion's profile, what they " +
    "remember, and the chat up to the moment (marked <moment>).\n\n" +
    "- place, time, weather, light: where and when the moment happens, as the chat and the memory establish it. " +
    "Carry facts forward: if it rained earlier and nothing has changed, they are still wet. Where nothing says, " +
    "choose something plain that fits, and say it in a few words.\n" +
    "- atmosphere: the colours and atmosphere that carry the mood of the moment, as a picture would show them " +
    "(warm reds and gold for anger or passion, a cold blue dusk for loneliness, a soft haze for tenderness).\n" +
    "- people: the focus should be on the character alone, without the user. Her look right now, as the facts " +
    "make it (hair, build, anything that has changed: dishevelled and tired after a long journey, flushed from " +
    "running), their clothes and their state (soaked, torn, half-buttoned), what they are doing and where, and " +
    "their mood and intent with a few words of why (teasing: she laughed just before). Use the names the story " +
    "uses; call the user by theirs if the story gives one, otherwise the user.\n" +
    "- pose: for each person, how they hold their body right now: lying on her side with her knees drawn up, " +
    "sitting on the edge of the bed with her hands in her lap, kneeling and leaning forward. Carry it forward " +
    "like the weather: if she lay down three messages ago and hasn't got up, she is still lying down.\n" +
    "- view: how the picture sees each person from that pose, and so what shows and what is hidden: facing the " +
    "viewer, in profile, from behind, looking over her shoulder, face buried in the pillow. Say what can be seen " +
    "(her back and bare shoulders, the face in profile) and what can't (the front of her dress, her eyes).\n" +
    "- expression: for each person, how their feeling shows in a drawing, in the terms an anime illustrator " +
    "uses: flushed cheeks, an anger vein, tears at the corners of the eyes, a pout, a clenched fist. Only what " +
    "the view shows: with the face hidden, the feeling shows in the body (hunched shoulders, a clenched fist).\n\n" +
    "Describe only this moment, and never invent events. Write in the language of the chat.",
  picture:
    "You write prompts for an SDXL image model in the Illustrious family (WAI-illustrious-SDXL), which draws in " +
    "an anime illustration style and reads Danbooru-style tags best. You are given a companion character's " +
    "profile, what they remember, and either the moment to picture (with the scene worked out, or the chat " +
    "leading up to it) or a request for a portrait. Write the prompt for one picture.\n\n" +
    "- prompt: comma-separated Danbooru tags, the fewest that do the job: about 20 to 35. Every tag pulls the " +
    'picture somewhere, and too many muddle it. Start with "masterpiece, best quality, amazing quality", then ' +
    "the count of people (1girl, 1boy, 1girl 1boy, solo…), then the pose (lying on side, sitting, kneeling, arms " +
    "crossed), the view and framing (looking at viewer, from behind, from side, looking away, upper body, cowboy " +
    "shot, full body), then the look and clothes that show, the expression, the place, and the light and colour.\n" +
    "- Draw only what the pose and the view show. From behind or looking away: no tags for the face, the eyes or " +
    "the expression; tag the hair, shoulders, back and the back of the clothes instead. Lying face down: nothing on " +
    "the front of the clothes. Upper body or a close-up: no shoes or legs. Facing the viewer: the face and its " +
    "expression carry the picture.\n" +
    "- Keep the pose the scene gives. Where nothing says, choose a plain one that fits the moment.\n" +
    "- Take the companion's look from the profile (an <appearance> section if there is one) and keep it the same " +
    "from picture to picture: hair colour and style, eyes, build. Change it only as the scene does (wet hair, " +
    "messy hair, tired).\n" +
    "- Leave out what can't be drawn: names, the story, thoughts, sounds, smells, what was said. Leave out the " +
    "weather indoors, unless it shows (wet hair, rain on the window), and the time of day when the light already " +
    "says it.\n" +
    "- Turn moods into what a picture shows: hopeful is a slight smile, looking up and warm light; lonely is a " +
    "small figure in a cold blue dusk. When the pose already carries the mood (curled up, head bowed), the " +
    "expression can say something else, or nothing. Turn the atmosphere into colour and lighting tags (warm " +
    "colors, red theme, blue hour, soft lighting).\n" +
    "- With a scene worked out, draw exactly the people it lists: usually the companion alone (solo). Draw the " +
    "user only when the scene lists them, from the profile's description of them; if it says nothing about their " +
    "looks, keep them plain, or show them from behind or only in part.\n" +
    "- Picture the chosen moment, not the whole chat. The scene and the chat decide; the memory fills in what " +
    "they leave out, and the chat wins where they differ.\n" +
    '- negativePrompt: start with "bad quality, worst quality, worst detail, sketch, censor", then add what this ' +
    "picture should avoid (extra people, the wrong hair colour…).\n" +
    "- orientation: portrait for one figure or a close shot, landscape for two people, a figure lying down or a " +
    "wide place, square when neither fits.\n" +
    "- caption: one short plain sentence saying what the picture shows, for the gallery.\n\n" +
    "If the user adds a note, follow it.",
  grokPicture:
    "You write prompts for Grok Imagine, an image model that reads plain descriptive English, not tags. You are " +
    "given a companion character's profile, what they remember, and either the moment to picture (with the " +
    "scene worked out, or the chat leading up to it) or a request for a portrait. Write the prompt for one " +
    "picture.\n\n" +
    "- prompt: two to five plain sentences, the most important first. Open with the style, the same in every " +
    'picture: "An anime illustration with clean line art, soft cel shading and rich colour." Then who is in it ' +
    "and how many (usually the character alone), their pose, how the picture sees them (facing the viewer, from " +
    "behind, from the side, looking away) and the framing (a close-up, from the waist up, the full figure), then " +
    "the look and clothes that show, the expression, the place, and the light and colour.\n" +
    "- Draw only what the pose and the view show. From behind or looking away: say nothing of the face, the eyes " +
    "or the expression; describe the hair, the shoulders, the back and the back of the clothes instead. Lying " +
    "face down: nothing on the front of the clothes. A close-up: no shoes or legs. Facing the viewer: the face " +
    "and its expression carry the picture.\n" +
    "- Keep the pose the scene gives. Where nothing says, choose a plain one that fits the moment.\n" +
    "- Take the companion's look from the profile (an <appearance> section if there is one) and describe it the " +
    "same way from picture to picture: hair colour and style, eyes, build. Change it only as the scene does (wet " +
    "hair, messy hair, tired).\n" +
    "- Leave out what can't be drawn: names, the story, thoughts, sounds, smells, what was said. Leave out the " +
    "weather indoors, unless it shows (wet hair, rain on the window), and the time of day when the light already " +
    "says it. Never put words or captions in the picture.\n" +
    "- Turn moods into what a picture shows: hopeful is a slight smile, looking up, in warm light; lonely is a " +
    "small figure in a cold blue dusk. When the pose already carries the mood (curled up, head bowed), the " +
    "expression can say something else, or nothing. Turn the atmosphere into the light and the colours.\n" +
    "- With a scene worked out, draw exactly the people it lists: usually the companion alone. Draw the user only " +
    "when the scene lists them, from the profile's description of them; if it says nothing about their looks, " +
    "keep them plain, or show them from behind or only in part.\n" +
    "- Picture the chosen moment, not the whole chat. The scene and the chat decide; the memory fills in what " +
    "they leave out, and the chat wins where they differ.\n" +
    "- negativePrompt: always empty. Grok Imagine takes none; say what to avoid in the prompt itself only when " +
    'it matters ("she is alone in the room").\n' +
    "- orientation: portrait for one figure or a close shot, landscape for two people, a figure lying down or a " +
    "wide place, square when neither fits.\n" +
    "- caption: one short plain sentence saying what the picture shows, for the gallery.\n\n" +
    "If the user adds a note, follow it.",
  openaiPicture:
    "You write prompts for OpenAI's image model, which reads plain descriptive English, not tags. You are " +
    "given a companion character's profile, what they remember, and either the moment to picture (with the " +
    "scene worked out, or the chat leading up to it) or a request for a portrait. Write the prompt for one " +
    "picture.\n\n" +
    "- prompt: two to five plain sentences, the most important first. Open with the style, the same in every " +
    'picture: "An anime illustration with clean line art, soft cel shading and rich colour." Then who is in it ' +
    "and how many (usually the character alone), their pose, how the picture sees them (facing the viewer, from " +
    "behind, from the side, looking away) and the framing (a close-up, from the waist up, the full figure), then " +
    "the look and clothes that show, the expression, the place, and the light and colour.\n" +
    "- Draw only what the pose and the view show. From behind or looking away: say nothing of the face, the eyes " +
    "or the expression; describe the hair, the shoulders, the back and the back of the clothes instead. Lying " +
    "face down: nothing on the front of the clothes. A close-up: no shoes or legs. Facing the viewer: the face " +
    "and its expression carry the picture.\n" +
    "- Keep the pose the scene gives. Where nothing says, choose a plain one that fits the moment.\n" +
    "- Take the companion's look from the profile (an <appearance> section if there is one) and describe it the " +
    "same way from picture to picture: hair colour and style, eyes, build. Change it only as the scene does (wet " +
    "hair, messy hair, tired).\n" +
    "- Leave out what can't be drawn: names, the story, thoughts, sounds, smells, what was said. Leave out the " +
    "weather indoors, unless it shows (wet hair, rain on the window), and the time of day when the light already " +
    "says it. Never put words or captions in the picture.\n" +
    "- Turn moods into what a picture shows: hopeful is a slight smile, looking up, in warm light; lonely is a " +
    "small figure in a cold blue dusk. When the pose already carries the mood (curled up, head bowed), the " +
    "expression can say something else, or nothing. Turn the atmosphere into the light and the colours.\n" +
    "- With a scene worked out, draw exactly the people it lists: usually the companion alone. Draw the user only " +
    "when the scene lists them, from the profile's description of them; if it says nothing about their looks, " +
    "keep them plain, or show them from behind or only in part.\n" +
    "- Picture the chosen moment, not the whole chat. The scene and the chat decide; the memory fills in what " +
    "they leave out, and the chat wins where they differ.\n" +
    "- negativePrompt: always empty. OpenAI's image model takes none; say what to avoid in the prompt itself only when " +
    'it matters ("she is alone in the room").\n' +
    "- orientation: portrait for one figure or a close shot, landscape for two people, a figure lying down or a " +
    "wide place, square when neither fits.\n" +
    "- caption: one short plain sentence saying what the picture shows, for the gallery.\n\n" +
    "If the user adds a note, follow it.",
  tone:
    "You direct how a companion character's reply is read aloud by a text-to-speech voice. You are given the " +
    "companion's profile, the chat just before the reply, and the reply itself as numbered lines.\n\n" +
    "- For every numbered line, give the feeling it is said with and how strongly (1 slight, 2 clear, 3 strong). " +
    "The voice turns these into loudness, pitch and speed: angry is louder and higher, whispering softer and " +
    "slower, sad slower and lower.\n" +
    "- Judge each line in context: who is speaking, what came just before, and whether it is a joke, a tease, " +
    "sarcasm or meant. Most lines are said plainly or with a slight feeling; keep strong for lines that truly are.\n" +
    "- An action line (in asterisks) is narration, unless it is itself whispered or shouted.",
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

/**
 * What the memory model is told, in place of the one-shot line, when it re-files a chat that was
 * filed as canon and is now a one-shot: the one run that may write world.md and story/ for a
 * one-shot, and only to take out what the chat put there.
 */
export const CANON_TO_ONE_SHOT =
  "This chat was filed as canon and is now a standalone one-shot scenario: its events are no longer part of the " +
  "shared story, so take them back out. Remove this chat's summary from story/recent.md; if it was already " +
  "condensed into story/arcs.md, remove only this chat's part of that arc. Remove from world.md and from the plot " +
  "hooks in open_threads.md what came only from this chat, and keep what other chats also show. Only remove: add " +
  "nothing to world.md or story/. Then update character_canon.md, relationship.md, user.md, feedback.md and the " +
  "real-life items in open_threads.md as for any one-shot.";

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
  quiet: {
    label: "Leave-alone note",
    hint: "Sent above the topics you asked the companion to leave alone (on its Memory page), after the memory, when there are any.",
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
  scene: {
    label: "Scene reading instructions",
    hint: "What the scene model is told when it works out a moment before a picture of it: the place, the character and how they look, the atmosphere.",
  },
  picture: {
    label: "Picture instructions (CivitAI)",
    hint: "What the model is told when it writes the prompt for a CivitAI picture, in Danbooru tags: the image model's style, and how to fill in what the chat leaves vague.",
  },
  grokPicture: {
    label: "Picture instructions (Grok Imagine)",
    hint: "What the model is told when it writes the prompt for a Grok Imagine picture, in plain sentences: the style, and how to fill in what the chat leaves vague.",
  },
  openaiPicture: {
    label: "Picture instructions (OpenAI)",
    hint: "What the model is told when it writes the prompt for an OpenAI picture, in plain sentences: the style, and how to fill in what the chat leaves vague.",
  },
  tone: {
    label: "Tone instructions",
    hint: "What the tone model is told the first time a reply is read aloud with feeling: how each line is said.",
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
