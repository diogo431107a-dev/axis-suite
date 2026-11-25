// Pictures of a companion: their kinds, sizes, prompts and parameters.

/** Profile pictures are made from the companion page; chat pictures from a message. */
export const PICTURE_KINDS = ["profile", "chat"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** The sizes SDXL was trained on, one per orientation. */
export const PICTURE_SIZES: Readonly<Record<Orientation, { width: number; height: number }>> = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};

/** A picture's prompt, written by Claude and yours to change before the picture is made. */
export interface PictureDraft {
  prompt: string;
  negativePrompt: string;
  orientation: Orientation;
  /** One plain line saying what the picture shows, for the gallery. */
  caption: string;
}

/** What writing a prompt answers: the draft, and what asking Claude for it cost. */
export interface PictureDraftReply extends PictureDraft {
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
}

/** What a picture is made from, besides its prompt. */
export interface PictureParams {
  model: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  seed: number;
}

/** A picture of a companion, made or being made. Its file is GET /api/pictures/:id/file. */
export interface Picture extends PictureDraft {
  id: string;
  companionId: string;
  kind: PictureKind;
  /** The chat and message a chat picture was made from; null once that chat is deleted. */
  chatId: string | null;
  chatTitle: string | null;
  messageId: number | null;
  params: PictureParams;
  status: "working" | "done" | "failed";
  error: string | null;
  createdAt: string;
}
