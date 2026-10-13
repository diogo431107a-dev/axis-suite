// The map itself, drawn as SVG from its layout: branches, nodes, fold badges, arrows, and while
// dragging, a copy of the node under the pointer and where it will land. Nodes are memoised on
// their box (which the layout keeps when it didn't change), so an edit redraws only what moved.
// The parts the pointer acts on are marked: [data-node], [data-badge], [data-arrow], [data-href].
import { memo, useMemo, type Ref } from "react";
import {
  arrowShape,
  badgeRect,
  branchPaths,
  labelWidth,
  nodesIn,
  textLines,
  type Area,
  type ShownArrow,
} from "../layout/geometry.ts";
import type { Box, Layout } from "../layout/layout.ts";
import { COLORS, FONT_STACK, SKETCH_ZOOM, STROKE, badgeText, styleOf } from "../layout/theme.ts";
import { findUrls, linkPieces } from "../text/links.ts";
import type { Drop } from "./drop.ts";

export interface Ghost {
  box: Box;
  /** where the pointer is, in map coordinates, and where it holds the box */
  x: number;
  y: number;
  grabX: number;
  grabY: number;
}

interface CanvasProps {
  layout: Layout;
  arrows: ShownArrow[];
  textOf: (id: string) => string;
  selectedNode: string | null;
  selectedArrow: string | null;
  /** the node being edited: its text is hidden under the editor */
  editing: string | null;
  /** making an arrow: from this node to that one */
  pickFrom: string | null;
  pickTarget: string | null;
  /** dragging: these nodes fade, and this is where the dragged one lands */
  dragging: ReadonlySet<string> | null;
  drop: Drop | null;
  ghost: Ghost | null;
  /** What to draw: the part of the map around the window, and the zoom it was taken at. */
  area: (Area & { k: number }) | null;
  worldRef: Ref<SVGGElement>;
}

const SELECT_GAP = 3;

interface NodeProps {
  box: Box;
  text: string;
  selected: boolean;
  editing: boolean;
  /** an arrow being made points here */
  target: boolean;
  /** a dragged node lands inside this one */
  dropInto: boolean;
  faded: boolean;
  /** zoomed far out: a bar instead of the text */
  sketch: boolean;
}

const NodeView = memo(function NodeView({ box, text, selected, editing, target, dropInto, faded, sketch }: NodeProps) {
  const style = styleOf(box.level);
  if (sketch && box.level >= 2 && !selected && !target && !dropInto) {
    return (
      <g data-node={box.id} opacity={faded ? 0.3 : undefined}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />
        <rect
          x={box.x + style.padX}
          y={box.y + box.h / 2 - 3}
          width={Math.max(4, box.w - 2 * style.padX)}
          height={6}
          rx={3}
          fill={COLORS.mainBorder}
        />
      </g>
    );
  }
  const colour = box.level === 0 ? COLORS.rootText : COLORS.text;
  const lines = textLines(box);
  const pieces = linkPieces(
    lines.map((l) => l.text),
    findUrls(text),
  );
  const badge = badgeRect(box);
  const empty = text.trim() === "";
  return (
    <g data-node={box.id} opacity={faded ? 0.3 : undefined} className="cursor-default">
      {(selected || target || dropInto) && (
        <rect
          x={box.x - SELECT_GAP}
          y={box.y - SELECT_GAP}
          width={box.w + 2 * SELECT_GAP}
          height={box.h + 2 * SELECT_GAP}
          rx={style.radius + SELECT_GAP}
          fill={dropInto ? COLORS.selectSoft : box.level === 0 ? "none" : COLORS.selectSoft}
          stroke={COLORS.select}
          strokeWidth={2}
          strokeDasharray={target ? "5 3" : undefined}
        />
      )}
      {box.level === 0 ? (
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={style.radius} fill={COLORS.rootFill} />
      ) : box.level === 1 ? (
        <rect
          x={box.x + 0.5}
          y={box.y + 0.5}
          width={box.w - 1}
          height={box.h - 1}
          rx={style.radius}
          fill={COLORS.mainFill}
          stroke={COLORS.mainBorder}
        />
      ) : (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={style.radius}
          fill="transparent"
          stroke={empty ? COLORS.mainBorder : "none"}
          strokeDasharray={empty ? "3 3" : undefined}
        />
      )}
      {!editing &&
        lines.map((line, i) => (
          <text
            key={i}
            x={line.x}
            y={line.y}
            fontFamily={FONT_STACK}
            fontSize={style.size}
            fontWeight={style.weight}
            fill={colour}
            dominantBaseline="central"
            textAnchor={box.level === 0 ? "middle" : undefined}
            className="select-none"
          >
            {pieces[i]!.map((p, j) =>
              p.href ? (
                <tspan key={j} data-href={p.href} textDecoration="underline" className="cursor-pointer">
                  {p.text}
                </tspan>
              ) : (
                <tspan key={j}>{p.text}</tspan>
              ),
            )}
          </text>
        ))}
      {badge && (
        <g data-badge={box.id} className="cursor-pointer">
          <rect
            x={badge.x}
            y={badge.y}
            width={badge.w}
            height={badge.h}
            rx={badge.h / 2}
            fill={COLORS.badgeFill}
            stroke={COLORS.mainBorder}
          />
          <text
            x={badge.x + badge.w / 2}
            y={badge.y + badge.h / 2}
            fontFamily={FONT_STACK}
            fontSize={11}
            fill={COLORS.badgeText}
            dominantBaseline="central"
            textAnchor="middle"
            className="select-none"
          >
            {badgeText(box.hidden)}
          </text>
        </g>
      )}
      {selected && box.kids > 0 && box.side !== null && <FoldDot box={box} />}
    </g>
  );
});

/** The "−" beside a selected node with children: a click folds it. */
function FoldDot({ box }: { box: Box }) {
  const cx = box.side === "right" ? box.x + box.w + 10 : box.x - 10;
  const cy = box.y + box.h / 2;
  return (
    <g data-badge={box.id} className="cursor-pointer">
      <circle cx={cx} cy={cy} r={7} fill="#ffffff" stroke={COLORS.mainBorder} />
      <path d={`M${cx - 3.5} ${cy}H${cx + 3.5}`} stroke={COLORS.badgeText} strokeWidth={1.5} />
    </g>
  );
}

const ArrowView = memo(function ArrowView({ shown, selected }: { shown: ShownArrow; selected: boolean }) {
  const shape = arrowShape(shown.from, shown.to);
  const colour = selected ? COLORS.select : COLORS.arrow;
  const label = shown.arrow.label;
  const width = labelWidth(label);
  return (
    <g data-arrow={shown.arrow.id} opacity={shown.dimmed && !selected ? 0.45 : undefined} className="cursor-pointer">
      <path d={shape.d} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        d={shape.d}
        fill="none"
        stroke={colour}
        strokeWidth={selected ? 2.5 : STROKE.arrow}
        strokeDasharray="6 4"
        markerEnd={selected ? "url(#mimir-head-selected)" : "url(#mimir-head)"}
      />
      {label && (
        <g>
          <rect
            x={shape.label.x - width / 2}
            y={shape.label.y - 9}
            width={width}
            height={18}
            rx={9}
            fill="#ffffff"
            stroke={selected ? COLORS.select : COLORS.mainBorder}
          />
          <text
            x={shape.label.x}
            y={shape.label.y}
            fontFamily={FONT_STACK}
            fontSize={12}
            fill={colour}
            dominantBaseline="central"
            textAnchor="middle"
            className="select-none"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
});

export function MapCanvas(props: CanvasProps) {
  const { layout, arrows, textOf, selectedNode, selectedArrow, editing, pickFrom, pickTarget, dragging, drop } = props;
  const area = props.area;
  const shown = useMemo(() => (area ? nodesIn(layout, area) : layout.order), [layout, area]);
  const paths = useMemo(() => branchPaths(layout, shown), [layout, shown]);
  const sketch = (area?.k ?? 1) < SKETCH_ZOOM;
  const pickLine = useMemo(() => {
    const from = pickFrom ? layout.boxes.get(pickFrom) : undefined;
    const to = pickTarget ? layout.boxes.get(pickTarget) : undefined;
    return from && to && from !== to ? arrowShape(from, to).d : null;
  }, [layout, pickFrom, pickTarget]);

  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <marker
          id="mimir-head"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={COLORS.arrow} />
        </marker>
        <marker
          id="mimir-head-selected"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={COLORS.select} />
        </marker>
      </defs>
      <g ref={props.worldRef}>
        <path d={paths.root} fill="none" stroke={COLORS.line} strokeWidth={STROKE.root} />
        <path d={paths.deep} fill="none" stroke={COLORS.line} strokeWidth={STROKE.deep} />
        {shown.map((id) => {
          const box = layout.boxes.get(id)!;
          return (
            <NodeView
              key={id}
              box={box}
              text={textOf(id)}
              selected={selectedNode === id}
              editing={editing === id}
              target={pickTarget === id && pickFrom !== id}
              dropInto={drop?.into === id}
              faded={dragging?.has(id) ?? false}
              sketch={sketch}
            />
          );
        })}
        {arrows.map((a) => (
          <ArrowView key={a.arrow.id} shown={a} selected={selectedArrow === a.arrow.id} />
        ))}
        {pickLine && (
          <path
            d={pickLine}
            fill="none"
            stroke={COLORS.select}
            strokeWidth={2}
            strokeDasharray="6 4"
            markerEnd="url(#mimir-head-selected)"
            pointerEvents="none"
          />
        )}
        {drop?.line && (
          <rect
            x={drop.line.x}
            y={drop.line.y - 1.5}
            width={drop.line.w}
            height={3}
            rx={1.5}
            fill={COLORS.drop}
            pointerEvents="none"
          />
        )}
        {props.ghost && <GhostView ghost={props.ghost} />}
      </g>
    </svg>
  );
}

/** The dragged node, following the pointer. */
function GhostView({ ghost }: { ghost: Ghost }) {
  const { box } = ghost;
  const style = styleOf(Math.max(1, box.level));
  const x = ghost.x - ghost.grabX;
  const y = ghost.y - ghost.grabY;
  return (
    <g transform={`translate(${x} ${y})`} opacity={0.9} pointerEvents="none">
      <rect
        width={box.w}
        height={box.h}
        rx={style.radius}
        fill="#ffffff"
        stroke={COLORS.select}
        strokeWidth={1.5}
        style={{ filter: "drop-shadow(0 6px 10px rgb(0 0 0 / 0.18))" }}
      />
      {box.lines.slice(0, 3).map((line, i) => (
        <text
          key={i}
          x={style.padX}
          y={style.padY + (i + 0.5) * style.lineHeight}
          fontFamily={FONT_STACK}
          fontSize={style.size}
          fontWeight={style.weight}
          fill={COLORS.text}
          dominantBaseline="central"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
