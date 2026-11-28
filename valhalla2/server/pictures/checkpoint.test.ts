import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, styleFor } from "../../shared/protocol.ts";
import { settings as checkSettings } from "../check.ts";
import { createCheckpointLookup, parseCheckpointLink } from "./checkpoint.ts";

const WAI = "urn:air:sdxl:checkpoint:civitai:827184@2883731";

/** A fake civitai.com: answers each path from `pages`, and remembers what it was asked. */
function fake(pages: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = ((url: string) => {
    asked.push(url);
    if (url.endsWith("/down")) return Promise.reject(new Error("no route"));
    const path = url.replace("https://civitai.com/api/v1", "");
    return Promise.resolve(
      path in pages ? new Response(JSON.stringify(pages[path])) : new Response("{}", { status: 404 }),
    );
  }) as typeof globalThis.fetch;
  return { lookUp: createCheckpointLookup({ fetch }), asked };
}

const version = (fields: Record<string, unknown> = {}) => ({
  id: 2883731,
  modelId: 827184,
  name: "v17.0",
  baseModel: "Illustrious",
  air: WAI,
  model: { name: "WAI-illustrious-SDXL", type: "Checkpoint" },
  ...fields,
});

describe("a pasted checkpoint link", () => {
  it("is read as an AIR, or a model page with or without its version, on any of CivitAI's sites", () => {
    expect(parseCheckpointLink(` ${WAI} `)).toEqual({ modelId: 827184, versionId: 2883731 });
    expect(parseCheckpointLink("https://civitai.com/models/827184?modelVersionId=2883731")).toEqual({
      modelId: 827184,
      versionId: 2883731,
    });
    expect(parseCheckpointLink("civitai.green/models/827184/wai-illustrious-sdxl")).toEqual({
      modelId: 827184,
      versionId: null,
    });
  });

  it("is refused when it isn't a checkpoint's or isn't CivitAI's", () => {
    expect(() => parseCheckpointLink("urn:air:sdxl:lora:civitai:1@2")).toThrow(/not a checkpoint/);
    expect(() => parseCheckpointLink("https://example.com/models/1")).toThrow(/Paste the link/);
    expect(() => parseCheckpointLink("https://civitai.com/images/5")).toThrow(/Paste the link/);
    expect(() => parseCheckpointLink("not a link at all")).toThrow(/Paste the link/);
  });
});

describe("looking a checkpoint up", () => {
  it("gives its AIR, its name and base model, and the style guessed from it", async () => {
    const { lookUp, asked } = fake({ "/model-versions/2883731": version() });
    expect(await lookUp("https://civitai.com/models/827184?modelVersionId=2883731")).toEqual({
      air: WAI,
      name: "WAI-illustrious-SDXL v17.0",
      baseModel: "Illustrious",
      style: "tags",
    });
    expect(asked).toEqual(["https://civitai.com/api/v1/model-versions/2883731"]);
  });

  it("takes the newest version when the link names none", async () => {
    const { lookUp, asked } = fake({
      "/models/827184": { modelVersions: [{ id: 2883731 }, { id: 2514310 }] },
      "/model-versions/2883731": version(),
    });
    expect((await lookUp("https://civitai.com/models/827184/wai")).name).toBe("WAI-illustrious-SDXL v17.0");
    expect(asked[0]).toBe("https://civitai.com/api/v1/models/827184");
  });

  it("guesses sentences for a checkpoint not made for tags", async () => {
    const { lookUp } = fake({
      "/model-versions/1": version({ id: 1, modelId: 5, air: undefined, baseModel: "SDXL 1.0", name: "XI" }),
    });
    expect(await lookUp("https://civitai.com/models/5?modelVersionId=1")).toEqual({
      air: "urn:air:sdxl:checkpoint:civitai:5@1",
      name: "WAI-illustrious-SDXL XI",
      baseModel: "SDXL 1.0",
      style: "sentences",
    });
    expect(styleFor("Pony")).toBe("tags");
    expect(styleFor("NoobAI")).toBe("tags");
    expect(styleFor("")).toBe("sentences");
  });

  it("refuses a LoRA, a checkpoint that isn't SDXL, and a version of another model", async () => {
    const { lookUp } = fake({
      "/model-versions/1": version({ id: 1, modelId: 1, model: { name: "Shiny", type: "LORA" } }),
      "/model-versions/2": version({ id: 2, modelId: 2, baseModel: "Flux.1 D" }),
      "/model-versions/3": version({ id: 3, modelId: 99 }),
    });
    await expect(lookUp("https://civitai.com/models/1?modelVersionId=1")).rejects.toThrow(/LORA on CivitAI/);
    await expect(lookUp("https://civitai.com/models/2?modelVersionId=2")).rejects.toThrow(
      /SDXL checkpoints only: this one is Flux.1 D/,
    );
    await expect(lookUp("https://civitai.com/models/3?modelVersionId=3")).rejects.toThrow(/another model/);
  });

  it("says when CivitAI has no such model, or can't be reached", async () => {
    const { lookUp } = fake({});
    await expect(lookUp("https://civitai.com/models/4?modelVersionId=4")).rejects.toThrow(/no such model/);
    const down = createCheckpointLookup({ fetch: (() => Promise.reject(new Error("offline"))) as typeof fetch });
    await expect(down(WAI)).rejects.toThrow(/can't be reached: offline/);
  });
});

describe("a companion's checkpoint, as saved", () => {
  it("is the default's, name and all, when left out", () => {
    const saved = checkSettings({});
    expect(saved.pictureModel).toBe(WAI);
    expect(saved.pictureModelName).toBe("WAI-illustrious-SDXL v17.0");
    expect(saved.pictureBaseModel).toBe("Illustrious");
    expect(saved.picturePromptStyle).toBe("tags");
  });

  it("is an SDXL checkpoint's AIR, with what it is called", () => {
    const pony = "urn:air:sdxl:checkpoint:civitai:257749@290640";
    expect(
      checkSettings({ pictureModel: pony, pictureModelName: "Pony Diffusion V6 XL", pictureBaseModel: "Pony" }),
    ).toMatchObject({ pictureModel: pony, pictureModelName: "Pony Diffusion V6 XL", pictureBaseModel: "Pony" });
    expect(checkSettings({ pictureModel: pony })).toMatchObject({ pictureModelName: "", pictureBaseModel: "" });
    expect(() => checkSettings({ pictureModel: "urn:air:flux1:checkpoint:civitai:1@2" })).toThrow(/SDXL checkpoint/);
    expect(() => checkSettings({ pictureModel: "anything" })).toThrow(/SDXL checkpoint/);
  });

  it("is written in tags or in sentences, nothing else", () => {
    expect(checkSettings({ picturePromptStyle: "sentences" }).picturePromptStyle).toBe("sentences");
    expect(() => checkSettings({ picturePromptStyle: "haiku" })).toThrow(/prompt style/);
    expect(DEFAULT_SETTINGS.picturePromptStyle).toBe("tags");
  });
});
