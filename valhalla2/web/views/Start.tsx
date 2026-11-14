// What you see with nothing open: how to begin, and the one form that starts a chat.
import { useState } from "react";
import { CHAT_MODES, type ChatMode } from "../../shared/protocol.ts";
import { MODE_LABELS } from "../ui/modes.ts";
import { usePage } from "../page.ts";
import { api } from "../api.ts";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";
import { useSave } from "../ui/useSave.ts";

export function Start() {
  const { companions, health, reload, open } = usePage();
  const { error, saving, run } = useSave();
  const [companionId, setCompanionId] = useState(companions[0]?.id ?? "");
  const [mode, setMode] = useState<ChatMode>("canon");

  const start = () =>
    run(async () => {
      const id = crypto.randomUUID();
      await api("/api/chats", { method: "POST", body: { id, companionId, mode } });
      await reload();
      open({ kind: "chat", id, greet: true });
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-3xl">Valhalla 2</h1>
        <p className="mt-2 text-faint">
          Write a companion — who they are, and who you are with them — then talk. Every chat opens with their greeting,
          and any reply can be written again, edited, or branched from.
        </p>
      </div>

      {!health.apiKey ? (
        <Notice kind="quiet">
          No Claude API key is set up on the server, so a message may not get an answer. Whoever runs this Valhalla 2
          can add one.
        </Notice>
      ) : null}

      {companions.length > 0 ? (
        <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
          <h2 className="font-display text-lg">Start a chat</h2>
          <Field label="With">
            <select className={inputStyle} value={companionId} onChange={(e) => setCompanionId(e.target.value)}>
              {companions.map((companion) => (
                <option key={companion.id} value={companion.id}>
                  {companion.name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">This chat is</legend>
            {CHAT_MODES.map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1"
                  name="mode"
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                <span>
                  {MODE_LABELS[option].label}
                  <span className="block text-xs text-faint">{MODE_LABELS[option].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Notice>{error}</Notice>
          <Button kind="strong" onClick={start} disabled={saving || !companionId}>
            {saving ? "Opening…" : "Open"}
          </Button>
        </section>
      ) : (
        <section className="space-y-3 rounded border border-rule bg-sheet/50 p-4">
          <h2 className="font-display text-lg">First, a companion</h2>
          <p className="text-sm text-faint">
            One profile: their personality, appearance and behavior, and who you are when you talk to them.
          </p>
          <Button kind="strong" onClick={() => open({ kind: "companion", id: null })}>
            New companion
          </Button>
        </section>
      )}
    </div>
  );
}
