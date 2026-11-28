// A picture as the chat and the gallery show it: small, or full size with how it was made.
import { useState } from "react";
import { Copy, ImagePlus, Maximize2, Trash2 } from "lucide-react";
import {
  isGrokParams,
  PICTURE_ENGINE_LABELS,
  samplerLabel,
  type Picture,
  type PictureParams,
} from "../../shared/protocol.ts";
import { Button, Dialog } from "./bits.tsx";
import { fileOf } from "./watch.ts";

/** A picture's shape, as CSS takes it: 832 / 1216 for CivitAI, 2 / 3 for Grok Imagine. */
const shapeOf = (params: PictureParams): string =>
  isGrokParams(params) ? params.aspectRatio.replace(":", " / ") : `${params.width} / ${params.height}`;

/** What a picture cost, as the page shows it: 4.0¢. */
const cents = (dollars: number): string => `${(dollars * 100).toFixed(1)}¢`;

/** How a picture was made, in one line after its date. */
function madeWith(picture: Picture): string {
  const { params } = picture;
  if (isGrokParams(params)) {
    const cost = picture.cost === null ? "" : ` · ${cents(picture.cost)}`;
    return ` · ${PICTURE_ENGINE_LABELS.grok} · ${params.aspectRatio} · ${params.resolution} · ${params.quality} quality${cost}`;
  }
  return [
    ` · ${params.width}×${params.height} · ${params.steps} steps · CFG ${params.cfgScale}`,
    params.sampler ? ` · ${samplerLabel(params.sampler)}` : "",
    params.clipSkip ? ` · clip skip ${params.clipSkip}` : "",
    ` · seed ${params.seed}`,
  ].join("");
}

/** A picture, small: its image, or how far along it is. */
export function Thumb({
  picture,
  onOpen,
  className = "",
}: {
  picture: Picture;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={picture.caption || "A picture"}
      style={{ aspectRatio: shapeOf(picture.params) }}
      className={`block overflow-hidden rounded-md border border-rule bg-sheet hover:border-accent ${className}`}
    >
      {picture.status === "done" ? (
        <img src={fileOf(picture)} alt={picture.caption} loading="lazy" className="h-full w-full object-cover" />
      ) : picture.status === "working" ? (
        <span className="flex h-full w-full animate-pulse items-center justify-center p-2 text-xs text-faint">
          Painting…
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-warn">
          Not made
        </span>
      )}
    </button>
  );
}

/** A picture full size, with its prompt and what can be done with it. */
export function PictureView({
  picture,
  onClose,
  onAgain,
  onDelete,
  extra,
}: {
  picture: Picture;
  onClose: () => void;
  /** Opens the prompt again, to make another picture from it. */
  onAgain?: () => void;
  onDelete: () => Promise<void>;
  extra?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(picture.prompt).then(() => setCopied(true));
  };

  return (
    <Dialog open onClose={onClose} title={picture.kind === "profile" ? "Profile picture" : "Chat picture"}>
      <div className="space-y-3">
        {picture.status === "done" ? (
          <img src={fileOf(picture)} alt={picture.caption} className="mx-auto max-h-[60vh] rounded-md" />
        ) : picture.status === "working" ? (
          <p className="animate-pulse text-sm text-faint">
            {PICTURE_ENGINE_LABELS[picture.engine]} is painting this picture…
          </p>
        ) : (
          <p className="text-sm text-warn">This picture wasn't made: {picture.error ?? "no reason given"}</p>
        )}
        {picture.caption ? <p className="font-display">{picture.caption}</p> : null}
        <p className="text-xs text-faint">
          {new Date(picture.createdAt).toLocaleString()}
          {picture.chatTitle ? ` · from "${picture.chatTitle}"` : picture.kind === "chat" ? " · its chat is gone" : ""}
          {madeWith(picture)}
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-faint hover:text-ink">The prompt</summary>
          <p className="mt-2 whitespace-pre-wrap rounded border border-rule bg-sheet p-2 font-mono text-xs">
            {picture.prompt}
          </p>
          {picture.negativePrompt ? (
            <p className="mt-2 whitespace-pre-wrap rounded border border-rule bg-sheet p-2 font-mono text-xs text-faint">
              Not: {picture.negativePrompt}
            </p>
          ) : null}
        </details>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {onAgain ? (
            <Button kind="plain" onClick={onAgain} title="Another picture from this prompt">
              <ImagePlus size={14} /> Make again
            </Button>
          ) : null}
          <Button kind="plain" onClick={copy}>
            <Copy size={14} /> {copied ? "Copied" : "Copy prompt"}
          </Button>
          {picture.status === "done" ? (
            <a
              href={fileOf(picture)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded border border-rule bg-sheet px-3 py-1.5 text-sm hover:border-accent"
            >
              <Maximize2 size={14} /> Full size
            </a>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm text-warn">Delete this picture for good?</span>
                <Button
                  kind="danger"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    void onDelete().finally(() => setDeleting(false));
                  }}
                >
                  Delete
                </Button>
                <Button kind="quiet" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button kind="danger" onClick={() => setConfirming(true)}>
                <Trash2 size={14} /> Delete…
              </Button>
            )}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
