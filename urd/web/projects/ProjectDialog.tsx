import { useState } from "react";
import { LIMITS, type Project, type ProjectPatch } from "../../shared/protocol.ts";
import { ApiFailure, api, describeError } from "../api.ts";
import { dateOf, hours, sessionsText } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface ProjectDialogProps {
  project: Project;
  onChanged: () => void;
  onClose: () => void;
}

const HOUR = 3600;
/** The text field without its full width. */
const numberInput = textInput.replace("w-full ", "");

/** "12" and "30" from 45000 seconds (12h 30m); "" and "" for no estimate. */
function split(estimate: number | null): [string, string] {
  if (estimate === null) return ["", ""];
  return [String(Math.floor(estimate / HOUR)), String(Math.floor(estimate / 60) % 60)];
}

/** A project: its name (or merging it into another), its estimate and how it changed, archiving, deleting. */
export function ProjectDialog({ project, onChanged, onClose }: ProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const [[h, m], setHm] = useState(split(project.estimate));
  const [error, setError] = useState("");
  // Set when the name is another project's: merging into it is offered.
  const [mergeInto, setMergeInto] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = project.periods.overall;

  const hoursValue = h.trim() === "" && m.trim() === "" ? null : Number(h || 0) * HOUR + Number(m || 0) * 60;
  const estimateValid =
    hoursValue === null ||
    (Number.isSafeInteger(hoursValue) && hoursValue >= 60 && hoursValue <= LIMITS.estimateSeconds);

  async function send(patch: ProjectPatch, button: Element): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: patch });
      onChanged();
      closeDialog(button);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "exists") setMergeInto(name.trim());
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(button: Element): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      onChanged();
      closeDialog(button);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={project.name} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const patch: ProjectPatch = {};
          if (name.trim() !== project.name) patch.name = name.trim();
          if (hoursValue !== project.estimate) patch.estimate = hoursValue;
          if (Object.keys(patch).length === 0) return closeDialog(e.currentTarget);
          void send(patch, e.currentTarget);
        }}
      >
        <div>
          <label htmlFor="project-name" className={label}>
            Name
          </label>
          <input
            id="project-name"
            value={name}
            required
            maxLength={LIMITS.projectNameChars}
            onChange={(e) => {
              setName(e.target.value);
              setMergeInto(null);
            }}
            className={textInput}
          />
        </div>

        {mergeInto && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-200"
          >
            <p className="mb-2">
              There is already a project called “{mergeInto}”. Merge this one into it? Its{" "}
              {sessionsText(total.sessions)} move there, and “{project.name}” goes away.
            </p>
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={(e) => void send({ name: mergeInto, merge: true }, e.currentTarget)}
            >
              Merge into “{mergeInto}”
            </button>
          </div>
        )}

        <fieldset>
          <legend className={label}>Estimate</legend>
          <div className="flex items-center gap-2">
            <input
              aria-label="Hours"
              data-autofocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={h}
              onChange={(e) => setHm([e.target.value.replace(/\D/g, ""), m])}
              className={`${numberInput} w-20`}
              placeholder="0"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">h</span>
            <input
              aria-label="Minutes"
              inputMode="numeric"
              pattern="[0-9]*"
              value={m}
              onChange={(e) => setHm([h, e.target.value.replace(/\D/g, "").slice(0, 2)])}
              className={`${numberInput} w-16`}
              placeholder="0"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">m</span>
            {hoursValue !== null && (
              <button
                type="button"
                className="ml-auto whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 underline"
                onClick={() => setHm(["", ""])}
              >
                No estimate
              </button>
            )}
          </div>
          {!estimateValid && (
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
              An estimate is from 1 minute to 100,000 hours.
            </p>
          )}
          {project.estimateLog.length > 0 && (
            <ol className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {project.estimateLog.map((c) => (
                <li key={c.at + String(c.to)}>
                  {dateOf(c.at)}:{" "}
                  {c.from === null
                    ? `set to ${hours(c.to ?? 0)}`
                    : c.to === null
                      ? `removed (was ${hours(c.from)})`
                      : `${hours(c.from)} → ${hours(c.to)}`}
                </li>
              ))}
            </ol>
          )}
        </fieldset>

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {hours(total.seconds)} in {sessionsText(total.sessions)}, {hours(project.periods.month.seconds)} this month.
        </p>

        {error && (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={primaryButton} disabled={busy || !name.trim() || !estimateValid}>
            Save
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={(e) => void send({ archived: !project.archived }, e.currentTarget)}
            title={project.archived ? undefined : "Hide it from the suggestions; its time stays in the totals"}
          >
            {project.archived ? "Bring back" : "Archive"}
          </button>
          {total.sessions === 0 &&
            (confirmDelete ? (
              <button
                type="button"
                className={`${dangerButton} ml-auto`}
                disabled={busy}
                onClick={(e) => void remove(e.currentTarget)}
              >
                Delete for good
              </button>
            ) : (
              <button type="button" className={`${dangerButton} ml-auto`} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
        </div>
      </form>
    </Dialog>
  );
}
