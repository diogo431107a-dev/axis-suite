// Choosing a moment: type a date or pick it from the calendar, then slide to the hour. ISO and 24h.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BANDS, PRECISIONS, type Band, type Precision } from "../../shared/protocol.ts";
import type { DateTimeValue } from "./moment.ts";
import { usePage } from "../page.ts";
import { fromMinutes, isoDate, parseDateText, PRECISION_LABEL, showParsed, toMinutes, withPrecision } from "../time.ts";

const BAND_LABEL: Record<Band, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};
const CAL_WIDTH = 252;

function Calendar({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const { today } = usePage();
  const parsed = parseDateText(value, today);
  const start = parsed ? parsed.d : today;
  const [month, setMonth] = useState(start.length === 4 ? `${start}-01` : start.slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.max(12, Math.min(anchor.right - CAL_WIDTH, window.innerWidth - CAL_WIDTH - 12));
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - 12) top = Math.max(12, anchor.top - height - 6);
    setStyle({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    // Before the sheet's own Esc, which would close the form too.
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const [y = 2026, m = 1] = month.split("-").map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(y, m, 0).getDate();
  const selected = parsed?.p === "date" ? parsed.d : null;
  const go = (by: number) => {
    const d = new Date(y, m - 1 + by, 1);
    setMonth(isoDate(d).slice(0, 7));
  };

  return createPortal(
    <div id="cal" ref={ref} style={style}>
      <div className="cal-h">
        <button type="button" onClick={() => go(-1)} aria-label="Previous month">
          ‹
        </button>
        <b>{month}</b>
        <button type="button" onClick={() => go(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="cal-g">
        {["M", "T", "W", "T", "F", "S", "S"].map((name, i) => (
          <span key={i}>{name}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
          const classes = [iso === today && "today", iso === selected && "sel", iso > today && "future"];
          return (
            <button key={iso} type="button" className={classes.filter(Boolean).join(" ")} onClick={() => onPick(iso)}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="cal-f">
        <span>ISO · Mon first</span>
        <button type="button" className="btn ghost sm" onClick={() => onPick(today)}>
          Today
        </button>
      </div>
    </div>,
    document.body,
  );
}

function CalendarButton({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn ghost sm"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((open) => (open ? null : rect));
        }}
      >
        Calendar
      </button>
      {anchor && (
        <Calendar
          anchor={anchor}
          value={value}
          onPick={(date) => {
            onPick(date);
            setAnchor(null);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/** A full date on its own, with no hour: when to ask about something. */
export function DateField({ id, value, onChange }: { id: string; value: string; onChange: (text: string) => void }) {
  const { today } = usePage();
  return (
    <div className="dt-row date-row">
      <input
        id={id}
        className="mono"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const parsed = parseDateText(value, today);
          if (parsed?.p === "date") onChange(parsed.d);
        }}
      />
      <CalendarButton value={value} onPick={onChange} />
    </div>
  );
}

export function DateTime({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: DateTimeValue;
  onChange: (value: DateTimeValue) => void;
}) {
  const { today } = usePage();
  const [badDate, setBadDate] = useState(false);
  const minutes = Math.min(1435, Math.round(toMinutes(value.time) / 5) * 5);

  const normalize = (text: string) => {
    const parsed = parseDateText(text, today);
    setBadDate(!parsed);
    if (parsed) onChange({ ...value, text: showParsed(parsed), prec: parsed.p });
  };

  return (
    <div className="dt">
      <div className="field">
        <label htmlFor={`${id}-d`}>{label}</label>
        <div className="dt-row">
          <input
            id={`${id}-d`}
            className="mono"
            value={value.text}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-err`}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            onBlur={() => normalize(value.text)}
          />
          <CalendarButton
            value={value.text}
            onPick={(date) => {
              setBadDate(false);
              onChange({ ...value, text: date, prec: "date" });
            }}
          />
          <select
            className="dt-p"
            aria-label="Precision"
            value={value.prec}
            onChange={(e) => {
              const prec = e.target.value as Precision;
              setBadDate(false);
              onChange({ ...value, prec, text: withPrecision(value.text, prec, today) });
            }}
          >
            {PRECISIONS.map((p) => (
              <option key={p} value={p}>
                {PRECISION_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <span className="help">
          Type <span className="mono">today</span>, <span className="mono">yesterday</span>,{" "}
          <span className="mono">-3</span>, <span className="mono">2026-10</span> or <span className="mono">~2009</span>
          . Vague is fine; false precision isn’t.
        </span>
        <span className="err" id={`${id}-err`} hidden={!badDate}>
          Use YYYY-MM-DD, today, yesterday or -3. Month (2026-10), year (2009) and ~2009 also work.
        </span>
      </div>
      {value.prec === "date" && (
        <div className={`dt-time ${value.mode === "exact" ? "" : "off"}`}>
          <input
            type="range"
            min="0"
            max="1435"
            step="5"
            value={minutes}
            aria-label="Hour of the day"
            onChange={(e) => onChange({ ...value, mode: "exact", time: fromMinutes(Number(e.target.value)) })}
          />
          <TimeInput value={value.time} onChange={(time) => onChange({ ...value, mode: "exact", time })} />
          <div className="ticks">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
          <div className="bands">
            {BANDS.map((band) => (
              <button
                key={band}
                type="button"
                className="chip"
                aria-pressed={value.mode === band}
                onClick={() => onChange({ ...value, mode: value.mode === band ? "exact" : band })}
              >
                {BAND_LABEL[band]}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={value.mode === "unknown"}
              onClick={() => onChange({ ...value, mode: value.mode === "unknown" ? "exact" : "unknown" })}
            >
              Time unknown
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The hour as typed, read when leaving the field: 1840 and 18:40 are the same, nonsense goes back. */
function TimeInput({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="mono dt-t"
      value={draft ?? value}
      maxLength={5}
      aria-label="Time, 24h"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const m = /^(\d{1,2}):?(\d{2})$/.exec((draft ?? "").trim());
        if (m && Number(m[1]) < 24 && Number(m[2]) < 60) onChange(`${m[1]!.padStart(2, "0")}:${m[2]}`);
        setDraft(null);
      }}
    />
  );
}
