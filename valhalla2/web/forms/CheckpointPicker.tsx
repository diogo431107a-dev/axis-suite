// The SDXL checkpoint a companion's CivitAI pictures are made on: shown by name, and changed by
// pasting a link to another one's page on CivitAI. The server looks it up and asks CivitAI whether it
// will make pictures on it, and what one costs; choosing it also sets the prompt style its base model
// suggests, which you can change.
import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import type { CheckpointLookup, Settings } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Button, inputStyle, Notice } from "../ui/bits.tsx";

type CheckpointSettings = Pick<
  Settings,
  "pictureModel" | "pictureModelName" | "pictureBaseModel" | "picturePromptStyle"
>;

/** The checkpoint's page on CivitAI, from its AIR. */
function checkpointPage(air: string): string | null {
  const ids = /:civitai:(\d+)@(\d+)$/.exec(air);
  return ids ? `https://civitai.com/models/${ids[1]}?modelVersionId=${ids[2]}` : null;
}

export function CheckpointPicker({
  settings,
  defaults,
  onPick,
}: {
  settings: Settings;
  /** What a new companion starts with, for going back to it. */
  defaults: Settings;
  onPick: (checkpoint: CheckpointSettings) => void;
}) {
  const [link, setLink] = useState("");
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const page = checkpointPage(settings.pictureModel);
  const isDefault = settings.pictureModel === defaults.pictureModel;

  const lookUp = async () => {
    setLooking(true);
    setError("");
    setSaid("");
    try {
      const found = await api<CheckpointLookup>("/api/pictures/checkpoint", {
        method: "POST",
        body: { link, settings },
      });
      onPick({
        pictureModel: found.air,
        pictureModelName: found.name,
        pictureBaseModel: found.baseModel,
        picturePromptStyle: found.style,
      });
      setLink("");
      setSaid(
        `CivitAI makes pictures on it${found.buzz === null ? "" : `, for about ${found.buzz} Buzz each at these settings`}. ` +
          `Its prompts will be written in ${found.style === "tags" ? "Danbooru tags" : "plain sentences"}, from its base model; change that below if it suits it better. Save the companion to keep it.`,
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLooking(false);
    }
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <span className="block text-sm font-medium">Checkpoint</span>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{settings.pictureModelName || settings.pictureModel}</span>
        {settings.pictureBaseModel ? (
          <span className="rounded border border-rule px-1.5 text-xs text-faint">{settings.pictureBaseModel}</span>
        ) : null}
        {page ? (
          <a
            className="inline-flex items-center gap-1 text-xs text-faint hover:text-accent"
            href={page}
            target="_blank"
            rel="noreferrer"
          >
            On CivitAI <ExternalLink size={12} />
          </a>
        ) : null}
        {!isDefault ? (
          <Button
            kind="quiet"
            onClick={() => {
              setSaid("");
              onPick({
                pictureModel: defaults.pictureModel,
                pictureModelName: defaults.pictureModelName,
                pictureBaseModel: defaults.pictureBaseModel,
                picturePromptStyle: defaults.picturePromptStyle,
              });
            }}
          >
            Back to the server&apos;s default
          </Button>
        ) : null}
      </p>
      <span className="block text-xs text-faint">
        Another SDXL checkpoint (Illustrious, Pony, NoobAI, SDXL 1.0 or a merge of them): paste the link to its page on
        CivitAI, or its AIR. Whether the prompt suits it is yours to judge.
      </span>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void lookUp();
        }}
      >
        <input
          className={inputStyle}
          value={link}
          placeholder="https://civitai.com/models/827184?modelVersionId=2883731"
          disabled={looking}
          onChange={(e) => setLink(e.target.value)}
        />
        <span className="shrink-0 whitespace-nowrap">
          <Button type="submit" disabled={looking || !link.trim()}>
            <Search size={14} /> {looking ? "Looking…" : "Look up"}
          </Button>
        </span>
      </form>
      <Notice>{error}</Notice>
      <Notice kind="quiet">{said}</Notice>
    </div>
  );
}
