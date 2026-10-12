import type { Journal } from "../../shared/protocol.ts";

interface JournalFilterProps {
  journals: Journal[];
  /** null: all journals */
  value: string | null;
  onChange: (journalId: string | null) => void;
}

/** "All journals" or one of them, for the calendar, the year and search. */
export function JournalFilter({ journals, value, onChange }: JournalFilterProps) {
  if (journals.length < 2) return null;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Journal"
      className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-700 focus:ring-2 focus:ring-amber-400 focus:outline-none"
    >
      <option value="">All journals</option>
      {journals.map((j) => (
        <option key={j.id} value={j.id}>
          {j.name}
        </option>
      ))}
    </select>
  );
}
