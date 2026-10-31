import { useState } from "react";
import { describeError } from "../api.ts";

/** For a form: runs one save at a time, and keeps what went wrong to show beside what was typed. */
export function useSave() {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const run = async (work: () => Promise<void>): Promise<void> => {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await work();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return { error, setError, saving, run };
}
