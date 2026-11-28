// Replies read aloud: one player for the chat, so starting one reply stops the other, and the
// switch that says whether new replies are read as they arrive.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechReply } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";

/** What the player is doing, and for which message. */
export type Playing = { messageId: number; phase: "loading" | "playing" } | null;

/** Whether a reply has anything to read once its asterisks are gone. */
export const hasSpeech = (text: string): boolean => text.replace(/\*+/g, "").trim() !== "";

/** `onRead` hears of each reply read, once its audio is ready: its tags may be new. */
export function useSpeaker(chatId: string, onError: (message: string) => void, onRead?: (messageId: number) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  // Each play gets a number; whatever an older one finishes after a newer one started is ignored.
  const turn = useRef(0);
  const [playing, setPlaying] = useState<Playing>(null);
  const [monthChars, setMonthChars] = useState<number | null>(null);
  const report = useRef(onError);
  report.current = onError;
  const read = useRef(onRead);
  read.current = onRead;

  const stop = useCallback(() => {
    turn.current++;
    audio.current?.pause();
    setPlaying(null);
  }, []);

  /**
   * Reads a reply aloud. `quiet` is for replies read as they arrive: a browser that won't play
   * sound the page didn't get a click for just stays silent, and the play button still works.
   */
  const play = useCallback(
    async (messageId: number, quiet = false) => {
      const mine = ++turn.current;
      audio.current?.pause();
      setPlaying({ messageId, phase: "loading" });
      try {
        const reply = await api<SpeechReply>(`/api/chats/${chatId}/messages/${messageId}/speech`, {
          method: "POST",
        });
        setMonthChars(reply.monthChars);
        read.current?.(messageId);
        if (mine !== turn.current) return;
        const player = (audio.current ??= new Audio());
        player.onended = () => {
          if (mine === turn.current) setPlaying(null);
        };
        player.src = reply.url;
        await player.play();
        if (mine === turn.current) setPlaying({ messageId, phase: "playing" });
      } catch (err) {
        if (mine !== turn.current) return;
        setPlaying(null);
        const name = err instanceof DOMException ? err.name : "";
        // Stopped before it began, or a reply read on arrival that the browser wouldn't play.
        if (name === "AbortError" || (quiet && name === "NotAllowedError")) return;
        if (name) report.current("This browser couldn't play the audio.");
        else report.current(describeError(err));
      }
    },
    [chatId],
  );

  // Leaving the chat stops whatever it was reading.
  useEffect(
    () => () => {
      turn.current++;
      audio.current?.pause();
    },
    [],
  );

  return { playing, play, stop, monthChars };
}

const READ_ALOUD = "valhalla2.readAloud";

/** Whether new replies are read as they arrive, remembered by this browser. On unless switched off. */
export function useReadAloud(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(READ_ALOUD) !== "off";
    } catch {
      return true;
    }
  });
  const change = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(READ_ALOUD, next ? "on" : "off");
    } catch {
      // Without storage it holds for this visit only.
    }
  }, []);
  return [on, change];
}
