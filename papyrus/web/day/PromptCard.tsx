import { useState } from "react";
import { FileText, Lightbulb, RefreshCw } from "lucide-react";
import type { Template } from "../../shared/protocol.ts";
import { promptFor } from "../prompts/prompts.ts";

interface PromptCardProps {
  date: string;
  prompts: readonly string[];
  /** the journal's own template first */
  templates: Template[];
  /** caret: where writing starts in it (default: its end) */
  onInsert: (text: string, caret?: number) => void;
}

/** What an empty page offers: the day's writing prompt and the templates. Nothing is filled in by itself. */
export function PromptCard({ date, prompts, templates, onInsert }: PromptCardProps) {
  const [skip, setSkip] = useState(0);
  const prompt = promptFor(date, prompts, skip);

  return (
    <div className="mb-4 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-sm">
      {prompt && (
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base text-stone-800">{prompt}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <button
                type="button"
                onClick={() => onInsert(`${prompt}\n\n`)}
                className="font-medium text-amber-800 hover:underline"
              >
                Write about this
              </button>
              {prompts.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSkip((s) => s + 1)}
                  className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-800"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden /> Another
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {templates.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 ${prompt ? "mt-3 border-t border-amber-200/70 pt-3" : ""}`}>
          <span className="text-xs text-stone-500">Start from a template:</span>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onInsert(t.text, firstLineEnd(t.text))}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs
                text-stone-700 hover:border-stone-300 hover:bg-stone-50"
            >
              <FileText className="h-3 w-3 text-stone-400" aria-hidden />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A template is written into from its second line, under its first heading. */
function firstLineEnd(text: string): number | undefined {
  const end = text.indexOf("\n");
  return end === -1 ? undefined : end + 1;
}
