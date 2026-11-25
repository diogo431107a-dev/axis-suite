// What the chat reads from a message.
import { blockText, type Message } from "../../../shared/protocol.ts";

export const textOf = (message: Message): string => message.content.map(blockText).join("");
