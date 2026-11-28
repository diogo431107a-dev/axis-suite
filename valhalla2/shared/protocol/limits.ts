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
  /** How much of the chat before a reply the tone model may read, in tokens. */
  minToneTokens: 500,
  maxToneTokens: 20_000,
  /** A picture's prompt, and its negative prompt. */
  picturePrompt: 4_000,
  /** What you add when asking for a picture: "at sunset", "from behind". */
  pictureHint: 1_000,
  /** The one line under a picture in the gallery. */
  pictureCaption: 300,
  /** A picture's steps, CFG (in halves) and clip skip, as CivitAI takes them for SDXL. */
  pictureStepsMin: 10,
  pictureStepsMax: 60,
  pictureCfgMin: 1,
  pictureCfgMax: 15,
  pictureClipSkipMin: 1,
  pictureClipSkipMax: 3,
  /** The largest seed you can type: ten digits. One Valhalla 2 rolls stays within 32 bits. */
  pictureSeedMax: 9_999_999_999,
  /** How many pictures one companion keeps. */
  pictures: 5_000,
  /** How many pictures one person can have being made at once. */
  picturesAtOnce: 3,
  /** A pinned moment: the words kept, and who said them. */
  pinText: 500,
  pinSpeaker: 80,
  /** How many moments one companion keeps pinned. Every one is sent in every chat. */
  pins: 30,
  /** A topic for the companion to leave alone, and how many it keeps. Every one is sent in every chat. */
  quietText: 200,
  quiet: 30,
  /** What you say you liked about a reply. */
  likeComment: 1_000,
  /** One field of a scene you correct (the place, someone's clothes…), and how many people it has. */
  sceneField: 1_000,
  scenePeople: 8,
  /** An Azure voice name, such as en-US-AvaMultilingualNeural. */
  voice: 100,
  /** What a voice reads when you try it. */
  voiceSample: 300,
  /** How much faster or slower a companion's voice reads, in percent: Azure takes half to double speed. */
  voiceRateMin: -50,
  voiceRateMax: 100,
  /** How much higher or lower it reads, in percent: Azure takes half to one and a half times the pitch. */
  voicePitchMin: -50,
  voicePitchMax: 50,
} as const;
