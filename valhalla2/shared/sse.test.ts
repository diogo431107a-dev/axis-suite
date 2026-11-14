import { describe, expect, it } from "vitest";
import { createFrameReader, frame } from "./sse.ts";
import type { StreamEvent } from "./protocol.ts";

const delta = (text: string): StreamEvent => ({ type: "delta", text });

describe("reading a reply as it is written", () => {
  it("reads back what was written", () => {
    const read = createFrameReader();
    expect(read(frame(delta("Sit")) + frame(delta(" down")))).toEqual([delta("Sit"), delta(" down")]);
  });

  it("waits for the rest of a frame that arrived in two pieces", () => {
    const read = createFrameReader();
    const whole = frame(delta("Sit down, Eadric."));
    const cut = Math.floor(whole.length / 2);
    expect(read(whole.slice(0, cut))).toEqual([]);
    expect(read(whole.slice(cut))).toEqual([delta("Sit down, Eadric.")]);
  });

  it("reads several frames out of one chunk and keeps a trailing part", () => {
    const read = createFrameReader();
    const chunk = frame(delta("a")) + frame(delta("b")) + 'data: {"type":"de';
    expect(read(chunk)).toEqual([delta("a"), delta("b")]);
    expect(read('lta","text":"c"}\n\n')).toEqual([delta("c")]);
  });

  it("survives text with newlines and blank lines in it", () => {
    const read = createFrameReader();
    const spoken = delta("He stood.\n\nThen he sat.");
    expect(read(frame(spoken))).toEqual([spoken]);
  });

  it("carries the other events too", () => {
    const read = createFrameReader();
    const events: StreamEvent[] = [{ type: "thinking" }, { type: "error", error: "No.", code: "api" }];
    expect(read(events.map(frame).join(""))).toEqual(events);
  });

  it("ignores anything that isn't a data frame", () => {
    const read = createFrameReader();
    expect(read(`: keep-alive\n\n${frame(delta("a"))}`)).toEqual([delta("a")]);
  });
});
