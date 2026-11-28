// Choosing the checkpoint a companion's CivitAI pictures are made on: a link to its page on CivitAI
// (or its AIR) is looked up on CivitAI's public API, the only place Valhalla 2 talks to it, for its
// name and base model. Only SDXL checkpoints are taken, since everything else about a CivitAI
// picture (its sizes, samplers, clip skip) is SDXL's. Whether CivitAI will really make pictures on it,
// and what one costs, is asked separately, with a submission that makes nothing (civitai.ts).
import { SDXL_BASE_MODELS, styleFor, type Checkpoint } from "../../shared/protocol.ts";
import { StoreError, invalid } from "../errors.ts";

const API = "https://civitai.com/api/v1";

/** A checkpoint as a link names it: its model, and the version when the link has one. */
export interface CheckpointRef {
  modelId: number;
  versionId: number | null;
}

const AIR = /^urn:air:[a-z0-9]+:([a-z]+):civitai:(\d+)@(\d+)$/i;

/**
 * The model and version a pasted link or AIR names. Takes the AIR as CivitAI shows it, and the page
 * of a model, with or without ?modelVersionId=, on any of CivitAI's sites.
 */
export function parseCheckpointLink(pasted: string): CheckpointRef {
  const text = pasted.trim();
  const air = AIR.exec(text);
  if (air) {
    if (air[1]!.toLowerCase() !== "checkpoint") invalid("That AIR is not a checkpoint's");
    return { modelId: Number(air[2]), versionId: Number(air[3]) };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return invalid("Paste the link to a checkpoint's page on CivitAI, or its AIR");
  }
  const page = /^\/models\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (!/(^|\.)civitai\.[a-z]+$/i.test(url.hostname) || !page) {
    invalid("Paste the link to a checkpoint's page on CivitAI, or its AIR");
  }
  const version = url.searchParams.get("modelVersionId");
  return {
    modelId: Number(page[1]),
    versionId: version && /^\d+$/.test(version) ? Number(version) : null,
  };
}

interface VersionAnswer {
  id?: number;
  modelId?: number;
  name?: string;
  baseModel?: string;
  air?: string;
  model?: { name?: string; type?: string };
}

interface ModelAnswer {
  modelVersions?: { id?: number }[];
}

export interface CheckpointLookupOptions {
  fetch?: typeof fetch;
  /** How long one request may take. */
  requestMs?: number;
}

export function createCheckpointLookup({
  fetch: get = globalThis.fetch,
  requestMs = 20_000,
}: CheckpointLookupOptions = {}) {
  async function ask<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await get(`${API}${path}`, { signal: AbortSignal.timeout(requestMs) });
    } catch (err) {
      throw new StoreError(502, `CivitAI can't be reached: ${(err as Error).message}`, "api");
    }
    if (res.status === 404) invalid("CivitAI has no such model");
    if (!res.ok) throw new StoreError(502, `CivitAI answered ${res.status}`, "api");
    try {
      return (await res.json()) as T;
    } catch {
      throw new StoreError(502, "CivitAI sent back something that isn't JSON", "api");
    }
  }

  /** The checkpoint a link names, refused unless it is an SDXL checkpoint. */
  return async function lookUp(pasted: string): Promise<Checkpoint> {
    const ref = parseCheckpointLink(pasted);
    // A link to the model's page without a version is its newest, which CivitAI lists first.
    const versionId =
      ref.versionId ??
      (await ask<ModelAnswer>(`/models/${ref.modelId}`)).modelVersions?.[0]?.id ??
      invalid("CivitAI lists no version of that model");
    const version = await ask<VersionAnswer>(`/model-versions/${versionId}`);
    if (version.modelId !== undefined && version.modelId !== ref.modelId) {
      invalid("That version belongs to another model");
    }
    const type = version.model?.type ?? "";
    if (type !== "Checkpoint") invalid(`That is a ${type || "model"} on CivitAI, not a checkpoint`);
    const baseModel = version.baseModel ?? "";
    if (!SDXL_BASE_MODELS.includes(baseModel)) {
      invalid(`Valhalla 2 makes pictures on SDXL checkpoints only: this one is ${baseModel || "of an unknown kind"}`);
    }
    const air = version.air ?? `urn:air:sdxl:checkpoint:civitai:${ref.modelId}@${versionId}`;
    const name = [version.model?.name, version.name].filter(Boolean).join(" ") || air;
    return { air, name, baseModel, style: styleFor(baseModel) };
  };
}

export type CheckpointLookUp = ReturnType<typeof createCheckpointLookup>;
