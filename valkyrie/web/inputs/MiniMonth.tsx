import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthOf, monthWeeks, weekLabel } from "../../shared/dates.ts";
import { iconButton } from "../ui/buttons.ts";

interface MiniMonthProps {
  /** YYYY-MM shown */
  month: string;
  onMonth: (month: string) => void;
  today: string;
  /** the picked day, if any */
  selected?: string | null;
  /** days to mark with a dot (they have events) */
  marked?: ReadonlySet<string>;
  onPick: (date: string) => void;
}

const HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A small month, Monday first, with ISO week numbers: for jumping to a day and picking dates. */
export function MiniMonth({ month, onMonth, today, selected, marked, onPick }: MiniMonthProps) {
  return (
    <div className="w-full text-xs select-none">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className={iconButton}
          aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-semibold text-stone-700 tabular-nums">{month}</span>
        <button
          type="button"
          className={iconButton}
          aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-center tabular-nums">
        <thead>
          <tr className="text-stone-400">
            <th className="w-7 font-normal" title="ISO week">
              Wk
            </th>
            {HEAD.map((d) => (
              <th key={d} className="font-normal">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month).map((week) => (
            <tr key={week[0]}>
              <td className="text-[10px] text-stone-400">{weekLabel(week[0]!).slice(6)}</td>
              {week.map((date) => {
                const outside = monthOf(date) !== month;
                const isToday = date === today;
                const isSelected = date === selected;
                return (
                  <td key={date} className="p-0">
                    <button
                      type="button"
                      onClick={() => onPick(date)}
                      title={date}
                      className={`relative mx-auto flex h-6 w-6 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-violet-600 font-semibold text-white"
                          : isToday
                            ? "font-semibold text-violet-700 ring-1 ring-violet-400"
                            : outside
                              ? "text-stone-300 hover:bg-stone-200"
                              : "text-stone-700 hover:bg-stone-200"
                      }`}
                    >
                      {Number(date.slice(8))}
                      {marked?.has(date) && !isSelected && (
                        <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-violet-400" aria-hidden />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
