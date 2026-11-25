import { describe, expect, it } from "vitest";
import { segmentsOf, type Segment } from "./emphasis.ts";

const acted = (text: string): Segment => ({ text, action: true });
const said = (text: string): Segment => ({ text, action: false });

describe("telling action and ambience from what is spoken", () => {
  it("sets an action apart from the dialogue after it", () => {
    expect(segmentsOf("*She smiles.* Long time, Master?")).toEqual([
      acted("*She smiles.*"),
      said(" Long time, Master?"),
    ]);
  });

  it("keeps the asterisks, so the text on screen is the text that was written", () => {
    const spoken = "*Luvia rises from a low curtsy.*";
    expect(
      segmentsOf(spoken)
        .map((segment) => segment.text)
        .join(""),
    ).toEqual(spoken);
  });

  it("follows several actions through a reply", () => {
    expect(segmentsOf("*She steps closer.*\n\nYou skipped your tea.\n\n*Her horns catch the light.*")).toEqual([
      acted("*She steps closer.*"),
      said("\n\nYou skipped your tea.\n\n"),
      acted("*Her horns catch the light.*"),
    ]);
  });

  it("marks two actions in one paragraph without joining them", () => {
    expect(segmentsOf("*She stands.* Master. *She waits.*")).toEqual([
      acted("*She stands.*"),
      said(" Master. "),
      acted("*She waits.*"),
    ]);
  });

  it("opens an action that has not been closed yet, as a reply still arriving has", () => {
    expect(segmentsOf("*She steps clos")).toEqual([acted("*She steps clos")]);
  });

  it("reads the same part-written as it will once the closing asterisk lands", () => {
    const whole = "*She steps closer.*";
    for (let at = 1; at < whole.length; at += 1) {
      expect(segmentsOf(whole.slice(0, at))).toEqual([acted(whole.slice(0, at))]);
    }
  });

  it("lets a stray asterisk cost one paragraph and no more", () => {
    expect(segmentsOf("A *stray mark\n\nAnd speech again.")).toEqual([
      said("A "),
      acted("*stray mark"),
      said("\n\nAnd speech again."),
    ]);
  });

  it("takes a doubled asterisk as one delimiter", () => {
    expect(segmentsOf("**Only me.**")).toEqual([acted("**Only me.**")]);
  });

  it("gives back plain speech in one piece", () => {
    expect(segmentsOf("Do sit down, and please do not tell me\nyou have one more chapter.")).toEqual([
      said("Do sit down, and please do not tell me\nyou have one more chapter."),
    ]);
  });

  it("handles a paragraph that is nothing but an action", () => {
    expect(segmentsOf("*She counts the hours.*")).toEqual([acted("*She counts the hours.*")]);
  });

  it("keeps the line breaks inside an action", () => {
    expect(segmentsOf("*She looks up,\nthen away.*")).toEqual([acted("*She looks up,\nthen away.*")]);
  });

  it("has nothing to say about nothing", () => {
    expect(segmentsOf("")).toEqual([]);
  });
});
