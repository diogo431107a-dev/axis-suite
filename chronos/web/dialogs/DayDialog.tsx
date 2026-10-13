import { Plus } from "lucide-react";
import { addDays } from "../../shared/dates.ts";
import type { CalEvent, Calendar } from "../../shared/protocol.ts";
import { agendaDays } from "../agenda/agenda.ts";
import { CAL_COLORS } from "../colors.ts";
import { dayHeading, timeOf } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { primaryButton } from "../ui/buttons.ts";

interface DayDialogProps {
  date: string;
  zone: string;
  /** hidden calendars left out */
  events: CalEvent[];
  calendars: ReadonlyMap<string, Calendar>;
  onOpen: (event: CalEvent) => void;
  onNew: () => void;
  onClose: () => void;
}

/** Every event of one day, for when the month view has no room for them all. */
export function DayDialog({ date, zone, events, calendars, onOpen, onNew, onClose }: DayDialogProps) {
  const items = agendaDays(events, date, addDays(date, 1), zone)[0]?.[1] ?? [];
  return (
    <Dialog title={dayHeading(date)} onClose={onClose}>
      {items.length === 0 && <p className="mb-4 text-sm text-stone-400">Nothing on this day.</p>}
      <ul className="mb-4 space-y-1">
        {items.map(({ event, day, days }) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-stone-100"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${
                  CAL_COLORS[calendars.get(event.calendarId)?.color ?? "stone"].dot
                }`}
                aria-hidden
              />
              <span className="w-12 shrink-0 text-stone-500 tabular-nums">
                {event.allDay || day > 1 ? "all day" : timeOf(event.start, zone)}
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-800">{event.title}</span>
              {days > 1 && (
                <span className="text-xs text-stone-400">
                  {day}/{days}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={primaryButton} onClick={onNew} data-autofocus>
        <Plus className="h-4 w-4" aria-hidden /> New event on {date}
      </button>
    </Dialog>
  );
}
