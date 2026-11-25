// How long or how many: every cap the server enforces and the page shows.

export const LIMITS = {
  /** A companion's name, shown in the list. Never sent to the model. */
  name: 80,
  /** A companion's profile: the one text box the model reads about who it is, and who you are. */
  profile: 60_000,
  /** One of a companion's own prompt texts (the greeting instruction, the rejection note…). */
  prompt: 8_000,
  /** One message you send, or an edit of one. */
  message: 50_000,
  /** Why you keep rejecting a reply. */
  reason: 2_000,
  /** A chat's title. */
  title: 120,
  stopSequences: 4,
  stopSequence: 80,
  /** How many of each Valhalla 2 keeps track of. */
  companions: 500,
  chats: 5_000,
  /** The reply length you can ask for. Replies stream, so a long ceiling costs nothing. */
  minTokens: 256,
  maxTokens: 64_000,
  /** A picture's prompt, and its negative prompt. */
  picturePrompt: 4_000,
  /** What you add when asking for a picture: "at sunset", "from behind". */
  pictureHint: 1_000,
  /** The one line under a picture in the gallery. */
  pictureCaption: 300,
  /** How many pictures one companion keeps. */
  pictures: 5_000,
  /** How many pictures one person can have being made at once. */
  picturesAtOnce: 3,
  /** A pinned moment: the words kept, and who said them. */
  pinText: 500,
  pinSpeaker: 80,
  /** How many moments one companion keeps pinned. Every one is sent in every chat. */
  pins: 30,
  /** What you say you liked about a reply. */
  likeComment: 1_000,
} as const;
