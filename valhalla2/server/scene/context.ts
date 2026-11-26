// What Claude reads to understand one moment of a chat: who the companion is, what it remembers,
// and the chat up to that moment. It is read for a picture's prompt, and to work out the scene and
// how a reply is said (sheet.ts); it is never sent in the chat itself. Only the words: no thinking
// and no hidden instructions.
import { blockText, type Companion, type Message, type Pin, type SceneSheet } from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";
import { tokensOf } from "../memory/history.ts";
import { renderPins } from "../memory/inject.ts";
import { renderFiles } from "../memory/render.ts";
import type { MemoryFile } from "../memory/store.ts";

export interface SceneRequest {
  system: string;
  prompt: string;
}

export type Scene =
  /** A portrait of the companion, from the profile and memory. */
  | { kind: "profile" }
  /** The moment at the end of `path`: the path up to the chosen message, oldest first. */
  | { kind: "chat"; path: readonly Message[] };

/** What the companion remembers: its memory files and pinned moments. */
export interface Remembered {
  files: MemoryFile[];
  pins: Pin[];
}

const textOf = (message: Message): string => message.content.map(blockText).join("").trim();

const quote = (name: string): string => name.replaceAll('"', "'");

/** The profile, then what the companion remembers. The same for every moment with it. */
export function backgroundOf(companion: Companion, remembered: Remembered): string {
  const parts = [`<profile name="${quote(companion.name)}">\n${companion.profile.trim()}\n</profile>`];
  if (remembered.files.length > 0) parts.push(`<memory>\n${renderFiles(remembered.files)}\n</memory>`);
  if (remembered.pins.length > 0) parts.push(renderPins(companion, remembered.pins));
  return parts.join("\n\n");
}

/**
 * The chat up to its last message, which is marked <moment>. The messages before it are taken
 * newest first for as long as they fit in about `budget` tokens; the moment always goes.
 */
export function chatUpTo(companion: Companion, path: readonly Message[], budget: number): string {
  const said = path.map((message) => ({ message, text: textOf(message) })).filter(({ text }) => text !== "");
  let from = said.length;
  let used = 0;
  for (let at = said.length - 1; at >= 0; at--) {
    used += tokensOf(said[at]!.message);
    if (at < said.length - 1 && used > budget) break;
    from = at;
  }
  const last = said.length - 1;
  const lines = said.slice(from).map(({ message, text }, at) => {
    const who = message.role === "user" ? "The user" : quote(companion.name);
    return from + at === last
      ? `<moment speaker="${who}">\n${text}\n</moment>`
      : `<message speaker="${who}">\n${text}\n</message>`;
  });
  return `<chat>\n${lines.join("\n")}\n</chat>`;
}

/** A worked-out moment (sheet.ts) as a picture's prompt reads it. */
export function renderSheet(sheet: SceneSheet): string {
  const lines = [
    `Place: ${sheet.place}`,
    `Time: ${sheet.time}`,
    `Weather: ${sheet.weather}`,
    `Light: ${sheet.light}`,
    ...sheet.people.map(
      (person) =>
        `${person.name}: looks ${person.appearance}; wears ${person.clothes}; ${person.action}; ${person.mood}`,
    ),
  ];
  return `<scene>\n${lines.join("\n")}\n</scene>`;
}

/**
 * The request for a picture's prompt for a companion without memory: its profile, and for a chat
 * picture the one message it is drawn from. No memory, no scene, no other messages.
 */
export function plainPictureRequest(companion: Companion, scene: Scene, hint: string): SceneRequest {
  const parts = [`<profile name="${quote(companion.name)}">\n${companion.profile.trim()}\n</profile>`];
  if (scene.kind === "profile") {
    parts.push(
      `Write the prompt for a profile picture of ${companion.name}: a portrait of them alone, showing their ` +
        "appearance clearly, in a setting and mood that fit who they are.",
    );
  } else {
    parts.push(chatUpTo(companion, scene.path, 0));
    parts.push(
      `Write the prompt for a picture of the moment marked <moment>, a message from a chat between the user and ${companion.name}. ` +
        "Draw what it says; where it says nothing, choose what fits the profile.",
    );
  }
  if (hint.trim()) parts.push(`The user's note for this picture: ${hint.trim()}`);
  return { system: promptOf(companion, "picture"), prompt: parts.join("\n\n") };
}

/**
 * The request for one picture's prompt. `background` is backgroundOf(); `budget` how many tokens
 * of the chat go with a chat picture. With the moment worked out (`sheet`), that stands in for the
 * chat, and only the moment itself goes with it.
 */
export function sceneRequest(
  companion: Companion,
  scene: Scene,
  hint: string,
  background: string,
  budget: number,
  sheet?: SceneSheet,
): SceneRequest {
  const parts = [background];

  if (scene.kind === "profile") {
    parts.push(
      `Write the prompt for a profile picture of ${companion.name}: a portrait of them alone, showing their ` +
        "appearance clearly, in a setting and mood that fit who they are.",
    );
  } else if (sheet) {
    parts.push(renderSheet(sheet), chatUpTo(companion, scene.path, 0));
    parts.push(
      "Write the prompt for a picture of the moment marked <moment>. The scene above was worked out from the " +
        "whole chat and the memory: draw the place, the people and their state as it says.",
    );
  } else {
    parts.push(chatUpTo(companion, scene.path, budget));
    parts.push(
      "Write the prompt for a picture of the moment marked <moment>, at the end of this chat between the user " +
        `and ${companion.name}. Use the messages before it, and the memory, for the place, the clothes and the mood.`,
    );
  }

  if (hint.trim()) parts.push(`The user's note for this picture: ${hint.trim()}`);
  return { system: promptOf(companion, "picture"), prompt: parts.join("\n\n") };
}
