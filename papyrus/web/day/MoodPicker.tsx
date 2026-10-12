import { MOOD_NAMES, type Mood } from "../../shared/protocol.ts";
import { MOOD_COLORS } from "../colors.ts";

const MOODS: Mood[] = [1, 2, 3, 4, 5];

interface MoodPickerProps {
  mood: Mood | null;
  disabled: boolean;
  /** null: the chosen mood was clicked again, to clear it */
  onChange: (mood: Mood | null) => void;
}

/** The day's mood, from Awful to Great. Clicking the chosen one again clears it. */
export function MoodPicker({ mood, disabled, onChange }: MoodPickerProps) {
  return (
    <div role="group" aria-label="Mood" className="flex flex-wrap gap-1.5">
      {MOODS.map((m) => {
        const chosen = m === mood;
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            aria-pressed={chosen}
            title={chosen ? `${MOOD_NAMES[m]} (click to clear)` : MOOD_NAMES[m]}
            onClick={() => onChange(chosen ? null : m)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors
              disabled:opacity-50 ${
                chosen
                  ? `${MOOD_COLORS[m].soft} ${MOOD_COLORS[m].text} border-current font-medium`
                  : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700"
              }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${MOOD_COLORS[m].bg}`} aria-hidden />
            {MOOD_NAMES[m]}
          </button>
        );
      })}
    </div>
  );
}
