// What Claude is given to write a picture's prompt: the companion's profile and, for a chat
// picture, the end of the selected path up to the chosen message. Only the words: no thinking, no
// hidden instructions, and nothing from the companion's memory.
import { blockText, type Companion, type Message } from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";

export interface SceneRequest {
  system: string;
  prompt: string;
}

export type Scene =
  /** A portrait of the companion, from the profile alone. */
  | { kind: "profile" }
  /** The moment at the end of `path`: the path up to the chosen message, oldest first. */
  | { kind: "chat"; path: readonly Message[] };

const textOf = (message: Message): string => message.content.map(blockText).join("").trim();

/** The request for one picture's prompt. `recent`: how many messages of the chat go with it. */
export function sceneRequest(companion: Companion, scene: Scene, hint: string, recent: number): SceneRequest {
  const parts = [`<profile name="${companion.name.replaceAll('"', "'")}">\n${companion.profile.trim()}\n</profile>`];

  if (scene.kind === "profile") {
    parts.push(
      `Write the prompt for a profile picture of ${companion.name}: a portrait of them alone, showing their ` +
        "appearance clearly, in a setting and mood that fit who they are.",
    );
  } else {
    const said = scene.path
      .map((message) => ({ message, text: textOf(message) }))
      .filter(({ text }) => text !== "")
      .slice(-recent);
    const last = said.length - 1;
    const lines = said.map(({ message, text }, at) => {
      const who = message.role === "user" ? "The user" : companion.name;
      return at === last
        ? `<moment speaker="${who}">\n${text}\n</moment>`
        : `<message speaker="${who}">\n${text}\n</message>`;
    });
    parts.push(`<chat>\n${lines.join("\n")}\n</chat>`);
    parts.push(
      "Write the prompt for a picture of the moment marked <moment>, at the end of this chat between the user " +
        `and ${companion.name}. Use the messages before it for the place, the clothes and the mood.`,
    );
  }

  if (hint.trim()) parts.push(`The user's note for this picture: ${hint.trim()}`);
  return { system: promptOf(companion, "picture"), prompt: parts.join("\n\n") };
}
