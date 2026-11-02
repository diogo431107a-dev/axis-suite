import { useEffect, useRef, useState } from "react";
import { WORTH_PARTS, type WorthPoint } from "../../shared/protocol.ts";
import { PART_NAMES, money, showMonth } from "../format.ts";

const HEIGHT = 260;
const MARGIN = { top: 14, right: 16, bottom: 28, left: 58 };
const GAP = 2;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole dollars, compact from a thousand up, for the axis. */
function axisMoney(cents: number): string {
  const dollars = cents / 100;
  const size = Math.abs(dollars);
  const sign = dollars < 0 ? "−" : "";
  if (size >= 1_000_000) return `${sign}$${+(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${sign}$${+(size / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(size)}`;
}

/** Four or five round steps covering the range, always including zero. */
function ticks(low: number, high: number): number[] {
  const span = Math.max(high - low, 100);
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  const result: number[] = [];
  for (let v = Math.floor(low / step) * step; v <= high + step / 2; v += step) result.push(v);
  return result;
}

/** A rectangle with its far end rounded: up for a positive bar, down for a negative one. */
function bar(x: number, y0: number, y1: number, width: number, roundEnd: boolean): string {
  const top = Math.min(y0, y1);
  const height = Math.abs(y1 - y0);
  const r = roundEnd ? Math.min(4, height, width / 2) : 0;
  if (r === 0) return `M${x},${top}h${width}v${height}h${-width}Z`;
  if (y1 < y0) {
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${y0}Z`;
  }
  const bottom = top + height;
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + width - r}Q${x + width},${bottom} ${x + width},${bottom - r}V${y0}Z`;
}

/**
 * What the user was worth at each month's end: the parts as stacked columns (debts below zero) and the
 * total as a line over them. Pointing at, or focusing, a month shows its figures.
 */
export function WorthChart({ points }: { points: WorthPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const known = points.filter((p) => p.parts);
  const tops = known.map((p) => WORTH_PARTS.filter((k) => k !== "debts").reduce((s, k) => s + p.parts![k], 0));
  const bottoms = known.map((p) => p.parts!.debts);
  const totals = known.map((p) => p.total!);
  const scale = ticks(Math.min(0, ...bottoms, ...totals), Math.max(0, ...tops, ...totals));
  const low = scale[0]!;
  const high = scale.at(-1)!;

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = plotWidth / points.length;
  const barWidth = Math.max(2, Math.min(24, band * 0.6));
  const y = (v: number) => MARGIN.top + ((high - v) / (high - low)) * plotHeight;
  const centre = (i: number) => MARGIN.left + band * i + band / 2;
  // A label every few months, so they never run into each other.
  const every = Math.max(1, Math.ceil(44 / band));

  const line: string[] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p.total === null) {
      open = false;
      return;
    }
    line.push(`${open ? "L" : "M"}${centre(i)},${y(p.total)}`);
    open = true;
  });
  const lastKnown = points.findLastIndex((p) => p.total !== null);
  const shown = active !== null ? points[active] : undefined;

  return (
    <div className="worth-chart" ref={wrap}>
      <ul className="legend" aria-label="What the chart shows">
        <li>
          <span className="key-line" aria-hidden /> What I'm worth
        </li>
        {WORTH_PARTS.map((part) => (
          <li key={part}>
            <span className={`key-box part-${part}`} aria-hidden /> {PART_NAMES[part]}
          </li>
        ))}
      </ul>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="What I'm worth at the end of each month"
        onPointerLeave={() => setActive(null)}
      >
        {scale.map((v) => (
          <g key={v}>
            <line
              className={v === 0 ? "axis" : "grid"}
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text className="tick" x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
              {axisMoney(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = centre(i) - barWidth / 2;
          const bars: React.ReactNode[] = [];
          if (p.parts) {
            const positive = WORTH_PARTS.filter((k) => k !== "debts" && p.parts![k] > 0);
            let base = 0;
            positive.forEach((part, n) => {
              const value = p.parts![part];
              const y0 = y(base) - (n > 0 ? GAP : 0);
              const y1 = y(base + value);
              if (y0 - y1 > 0.5) {
                bars.push(
                  <path
                    key={part}
                    className={`part-${part}`}
                    d={bar(x, y0, y1, barWidth, n === positive.length - 1)}
                  />,
                );
              }
              base += value;
            });
            if (p.parts.debts < 0) {
              bars.push(<path key="debts" className="part-debts" d={bar(x, y(0), y(p.parts.debts), barWidth, true)} />);
            }
          }
          return (
            <g key={p.month} className={active === i ? "column on" : "column"}>
              {bars}
              {(i % every === 0 || i === points.length - 1) && (
                <text className="tick" x={centre(i)} y={HEIGHT - 8} textAnchor="middle">
                  {MONTHS[Number(p.month.slice(5)) - 1]}
                  {p.month.endsWith("-01") || i === 0 ? ` ${p.month.slice(2, 4)}` : ""}
                </text>
              )}
            </g>
          );
        })}
        {active !== null && (
          <line
            className="crosshair"
            x1={centre(active)}
            x2={centre(active)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
          />
        )}
        <path className="total-line" d={line.join("")} />
        {lastKnown >= 0 && (
          <circle className="total-dot" cx={centre(lastKnown)} cy={y(points[lastKnown]!.total!)} r={4} />
        )}
        {points.map((p, i) => (
          <rect
            key={p.month}
            className="hit"
            x={MARGIN.left + band * i}
            y={MARGIN.top}
            width={band}
            height={plotHeight}
            tabIndex={0}
            aria-label={`${showMonth(p.month)}: ${p.total === null ? "no rate yet" : money(p.total)}`}
            onPointerEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      {shown && active !== null && (
        <div
          className="chart-tip"
          role="status"
          style={{
            left: Math.min(Math.max(centre(active) - 100, 0), width - 200),
          }}
        >
          <p className="tip-value">{shown.total === null ? "No rate yet" : money(shown.total)}</p>
          <p className="tip-label">{showMonth(shown.month)}</p>
          {shown.parts && (
            <ul>
              {WORTH_PARTS.filter((k) => shown.parts![k] !== 0).map((k) => (
                <li key={k}>
                  <span className={`key-line part-${k}`} aria-hidden />
                  <strong>{money(shown.parts![k])}</strong> {PART_NAMES[k]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
