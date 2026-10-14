// One open map: its header, the drawing, and everything the keyboard, the mouse and a finger can
// do to it. The map is laid out again after every change (layout.ts); panning and zooming only
// move it (view.ts). Every change goes through the model's commit(), so it can be undone.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowRight,
  Copy,
  FileDown,
  FileUp,
  Image as ImageIcon,
  Maximize,
  Menu as MenuIcon,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Spline,
  Trash2,
  Undo2,
  ExternalLink,
  ChevronsDownUp,
} from "lucide-react";
import { LIMITS, compareSiblings, mapName, type Arrow, type MapNode } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { ConfirmDialog } from "../dialogs/ConfirmDialog.tsx";
import { download, fileName } from "../download.ts";
import { count } from "../format.ts";
import { leftOut } from "../io/importer.ts";
import { OpmlError, looksLikeOpml, parseOpml, toOpml } from "../io/opml.ts";
import { mapToPng } from "../io/png.ts";
import { parsePlainText, toPlainText } from "../io/plaintext.ts";
import { arrowShape, drawnBounds, shownArrows, type Area, type ShownArrow } from "../layout/geometry.ts";
import { SKETCH_ZOOM } from "../layout/theme.ts";
import { layoutMap, type Layout, type LayoutTree } from "../layout/layout.ts";
import { canvasWidthOf, createMeasurer } from "../layout/measure.ts";
import {
  addArrow,
  branchSize,
  childPlacement,
  countDrafts,
  create,
  crossSide,
  demote,
  insertDrafts,
  liveChildren,
  moveAmongSiblings,
  moveTo,
  moveToEnd,
  promote,
  remove,
  setCollapsed,
  setText,
  siblingPlacement,
  type Draft,
  type Placement,
  type Result,
} from "../model/commands.ts";
import { MapModel } from "../model/mapModel.ts";
import type { MapStore } from "../model/store.ts";
import { MapGoneError, type Sync, type SyncState } from "../model/sync.ts";
import type { Focus } from "../model/undo.ts";
import { findUrls } from "../text/links.ts";
import { iconButton } from "../ui/buttons.ts";
import { Menu } from "../ui/Menu.tsx";
import { DRAG_THRESHOLD, LONG_PRESS_MS, LONG_PRESS_SLOP } from "../ui/sort.ts";
import { dropTarget, type Drop } from "./drop.ts";
import { Editor, LabelEditor, type EditEnd } from "./Editor.tsx";
import { intentOf, type Intent, type Mode } from "./keys.ts";
import { MapCanvas, type Ghost } from "./MapCanvas.tsx";
import { navigate, isOutward, type Dir } from "./navigate.ts";
import { NodeMenu, type NodeMenuItem } from "./NodeMenu.tsx";
import { View, forgetView, loadView, saveView } from "./view.ts";

/** Widths from the browser's canvas, measured once per text and level for the whole page. */
let sharedMeasure: ReturnType<typeof createMeasurer> | null = null;
const measure = (text: string, level: number) => (sharedMeasure ??= createMeasurer(canvasWidthOf()))(text, level);

interface EditState {
  id: string;
  text: string;
  original: string;
  /** a new node: where it goes once saved (it exists only on the page until then) */
  draft: Placement | null;
  /** what was selected when editing began, for undo */
  before: Focus;
}

interface DragState {
  id: string;
  ids: ReadonlySet<string>;
  ghost: Ghost;
  drop: Drop | null;
}

/** A press of the pointer, until it is a click, a pan or a drag. */
interface Press {
  pointerId: number;
  touch: boolean;
  node: string | null;
  arrow: string | null;
  badge: string | null;
  href: string | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  mode: "pending" | "pan" | "drag";
  timer: number;
}

interface MapViewProps {
  mapId: string;
  /** ?node=: select and show this node */
  nodeId: string | null;
  username: string;
  sync: Sync;
  /** a map just made: start writing its centre */
  fresh: boolean;
  onRenamed: (mapId: string, name: string) => void;
  onDeleted: (mapId: string) => void;
  /** the map isn't there (deleted, or a wrong address) */
  onMissing: (mapId: string) => void;
  onNotice: (text: string, tone?: "info" | "error") => void;
  onError: (err: unknown) => void;
  onHelp: () => void;
  onMenu: () => void;
  /** the sync reloaded the map: tells MapView to forget its undo history */
  onReloadedRef: { current: (() => void) | null };
}

const short = (text: string, n = 40) => {
  const first = text.split("\n", 1)[0]!.trim() || "an empty node";
  return first.length > n ? `${first.slice(0, n - 1)}…` : first;
};

/** A node's text as saved: no trailing spaces or blank lines. */
const tidy = (text: string) => text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");

/** The node and every node shown under it. */
function shownBranch(layout: Layout, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.add(cur);
    stack.push(...(layout.children.get(cur) ?? []));
  }
  return out;
}

/** The map as the layout sees it, with the node being edited as it is being written. */
function layoutTreeOf(store: MapStore, edit: EditState | null): LayoutTree {
  return {
    rootId: store.rootId,
    get: (id) => {
      if (edit && id === edit.id) {
        return { text: edit.text, side: edit.draft?.side ?? store.get(id)?.side ?? null, collapsed: false };
      }
      const node = store.get(id);
      // A new node's parent shows its children while it is written.
      if (node && edit?.draft?.parentId === id && node.collapsed) return { ...node, collapsed: false };
      return node;
    },
    children: (id) => {
      const kids = store.liveChildren(id);
      const draft = edit?.draft;
      if (!edit || !draft || draft.parentId !== id) return kids;
      const me = { id: edit.id, rank: draft.rank };
      const at = kids.findIndex((k) => compareSiblings(me, store.get(k)!) < 0);
      return at < 0 ? [...kids, edit.id] : [...kids.slice(0, at), edit.id, ...kids.slice(at)];
    },
  };
}

// The store changes in place: its version, passed to these, is what makes React call them again.
const layoutFor = (store: MapStore, _version: number, edit: EditState | null, prev: Layout | undefined) =>
  layoutMap(layoutTreeOf(store, edit), measure, prev);

const arrowsFor = (layout: Layout, store: MapStore, _version: number) =>
  shownArrows(
    layout,
    store.arrows(),
    (id) => store.get(id)?.parentId,
    (id) => store.isLive(id),
  );

export function MapView(props: MapViewProps) {
  const { mapId, username, sync } = props;
  const model = useMemo(() => new MapModel(mapId, sync), [mapId, sync]);
  const store = model.store;
  const version = useSyncExternalStore(
    useCallback((l) => store.subscribe(l), [store]),
    () => store.version,
  );
  const syncState = useSyncExternalStore(
    useCallback((l) => sync.subscribe(l), [sync]),
    () => sync.state,
  );

  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [sel, setSel] = useState<Focus>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pick, setPick] = useState<{ from: string; target: string | null } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ arrowId: string; text: string; x: number; y: number } | null>(null);
  const [undoToast, setUndoToast] = useState<{ text: string; id: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoomText, setZoomText] = useState("100%");
  // The part of the map drawn: what the window shows and as much again around it. Panning
  // within it redraws nothing; leaving it (or zooming a lot) draws a new one.
  const [area, setArea] = useState<(Area & { k: number }) | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useMemo(() => new View(() => containerRef.current), []);
  const lastChild = useRef(new Map<string, string>());
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;
  const press = useRef<Press | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const clipboardPending = useRef<number>(0);
  // Effects that run once read the props through this, so they see the newest.
  const latest = useRef(props);
  latest.current = props;

  // ---- Loading ------------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const reloaded = latest.current.onReloadedRef;
    sync
      .open(mapId, store)
      .then(() => !cancelled && setStatus("ready"))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof MapGoneError) {
          setStatus("missing");
          latest.current.onMissing(mapId);
        } else latest.current.onError(err);
      });
    reloaded.current = () => model.history.clear();
    return () => {
      cancelled = true;
      sync.close(store);
      reloaded.current = null;
    };
  }, [model, sync, store, mapId]);

  useEffect(() => () => view.dispose(), [view]);

  // ---- Layout -------------------------------------------------------------------------------

  const prevLayout = useRef<Layout | undefined>(undefined);
  const layout = useMemo(() => {
    if (status !== "ready" || !store.rootId) return null;
    const next = layoutFor(store, version, edit, prevLayout.current);
    prevLayout.current = next;
    return next;
  }, [status, version, edit, store]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const arrows = useMemo(() => (layout ? arrowsFor(layout, store, version) : []), [layout, version, store]);
  const arrowsRef = useRef<ShownArrow[]>(arrows);
  arrowsRef.current = arrows;

  // The view follows the map's size; the first layout places it.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!layout || !worldRef.current) return;
    const off = view.attach(worldRef.current, (s) =>
      worldRef.current?.setAttribute("transform", `translate(${s.tx} ${s.ty}) scale(${s.k})`),
    );
    if (!placed.current) {
      placed.current = true;
      const { nodeId, fresh } = latest.current;
      const saved = loadView(username, mapId);
      view.setBounds(layout.bounds, !saved);
      const wanted = nodeId && layout.boxes.has(nodeId) ? nodeId : null;
      if (wanted) {
        const b = layout.boxes.get(wanted)!;
        view.centreOn(b.x + b.w / 2, b.y + b.h / 2, Math.max(view.k, 1));
        setSel({ kind: "node", id: wanted });
      } else if (saved) {
        view.centreOn(saved.x, saved.y, saved.k);
        setSel({
          kind: "node",
          id: saved.selected && layout.boxes.has(saved.selected) ? saved.selected : store.rootId,
        });
      } else {
        setSel({ kind: "node", id: store.rootId });
      }
      const root = store.get(store.rootId);
      if (fresh && root) {
        setSel({ kind: "node", id: root.id });
        setEdit({
          id: root.id,
          text: root.text,
          original: root.text,
          draft: null,
          before: { kind: "node", id: root.id },
        });
      } else containerRef.current?.focus({ preventScroll: true });
    } else {
      view.setBounds(layout.bounds);
    }
    return off;
  }, [layout, view, store, username, mapId]);

  // Remember where the map was left, and show the zoom.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    let timer = 0;
    const save = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const c = view.centre();
        const s = selRef.current;
        saveView(username, mapId, { x: c.x, y: c.y, k: view.k, selected: s?.kind === "node" ? s.id : null });
      }, 400);
    };
    const updateArea = () => {
      const { w, h } = view.size();
      const k = view.k;
      const seen = { x: -view.tx / k, y: -view.ty / k, w: w / k, h: h / k };
      setArea((prev) =>
        prev &&
        Math.max(prev.k / k, k / prev.k) < 1.5 &&
        prev.k < SKETCH_ZOOM === k < SKETCH_ZOOM &&
        seen.x >= prev.x &&
        seen.y >= prev.y &&
        seen.x + seen.w <= prev.x + prev.w &&
        seen.y + seen.h <= prev.y + prev.h
          ? prev
          : { x: seen.x - seen.w / 2, y: seen.y - seen.h / 2, w: seen.w * 2, h: seen.h * 2, k },
      );
    };
    // Only a change of zoom, or leaving the drawn area, re-renders the page: panning just moves the map.
    const off = view.subscribe(() => {
      setZoomText(`${Math.round(view.k * 100)}%`);
      updateArea();
      save();
    });
    const resized = new ResizeObserver(updateArea);
    if (containerRef.current) resized.observe(containerRef.current);
    updateArea();
    save();
    return () => {
      off();
      resized.disconnect();
      clearTimeout(timer);
    };
  }, [view, username, mapId, sel]);

  // The sidebar shows the root's first line.
  const rootText = store.get(store.rootId)?.text;
  const lastName = useRef<string | null>(null);
  useEffect(() => {
    if (rootText === undefined) return;
    const name = mapName(rootText);
    if (lastName.current !== null && lastName.current !== name) latest.current.onRenamed(mapId, name);
    lastName.current = name;
  }, [rootText, mapId]);

  // A deleted node can't stay selected (undo, or a change from elsewhere).
  useEffect(() => {
    if (!layout) return;
    if (sel?.kind === "node" && !layout.boxes.has(sel.id)) setSel({ kind: "node", id: store.rootId });
    if (sel?.kind === "arrow" && !arrows.some((a) => a.arrow.id === sel.id)) setSel(null);
  }, [layout, arrows, sel, store]);

  // The node being written stays in view.
  useEffect(() => {
    if (!edit || !layout) return;
    const box = layout.boxes.get(edit.id);
    if (box) view.reveal(box, 24);
  }, [edit, layout, view]);

  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), 8000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  // ---- Helpers ------------------------------------------------------------------------------

  const say = useCallback((text: string) => {
    // The same words twice in a row are still read out.
    setAnnouncement((prev) => (prev === text ? `${text} ` : text));
  }, []);

  const focusMap = () => containerRef.current?.focus({ preventScroll: true });

  /** How a node is read out: "Work, level 1, 2 of 3 on the right, folded, 4 inside". */
  function describe(id: string): string {
    const node = store.get(id);
    const box = layoutRef.current?.boxes.get(id);
    if (!node || !box) return "";
    const ctx = model.ctx();
    const parts = [short(node.text, 80)];
    if (node.parentId === null) parts.push("the centre");
    else {
      parts.push(`level ${box.level}`);
      const siblings = liveChildren(ctx, node.parentId, node.side);
      parts.push(`${siblings.indexOf(id) + 1} of ${siblings.length}${box.level === 1 ? ` on the ${node.side}` : ""}`);
    }
    const kids = store.liveChildren(id).length;
    if (node.collapsed && kids > 0) parts.push(`folded, ${box.hidden} inside`);
    else if (kids > 0) parts.push(count(kids, "branch", "branches"));
    if (findUrls(node.text).length > 0) parts.push("has a link");
    return parts.join(", ");
  }

  function select(id: string, reveal = true) {
    setSel({ kind: "node", id });
    const box = layoutRef.current?.boxes.get(id);
    if (box && reveal) view.reveal(box);
    say(describe(id));
  }

  function selectArrow(id: string) {
    setSel({ kind: "arrow", id });
    const a = store.arrow(id);
    if (a) {
      say(
        `Arrow from ${short(store.get(a.fromId)?.text ?? "")} to ${short(store.get(a.toId)?.text ?? "")}${
          a.label ? `, labelled ${a.label}` : ""
        }`,
      );
    }
  }

  /** Commits a command as one undo step, then selects what it says. */
  function run(result: Result | null, after?: Focus): boolean {
    const ok = model.commit(result, sel, after);
    if (ok) {
      const next = after ?? (result?.select ? { kind: "node" as const, id: result.select } : null);
      if (next?.kind === "node") requestAnimationFrame(() => select(next.id));
      else if (next?.kind === "arrow") setSel(next);
    }
    return ok;
  }

  /** The side a new main branch goes to: the shorter one. */
  const shorterSide = () => {
    const h = layoutRef.current?.sideHeight ?? { left: 0, right: 0 };
    return h.left < h.right ? "left" : "right";
  };

  const isRoot = (id: string) => id === store.rootId;
  const selectedNode = sel?.kind === "node" && store.get(sel.id) ? sel.id : null;

  // ---- Editing ------------------------------------------------------------------------------

  function startEdit(id: string) {
    const node = store.get(id);
    if (!node) return;
    setMenu(null);
    setPick(null);
    setSel({ kind: "node", id });
    setEdit({ id, text: node.text, original: node.text, draft: null, before: { kind: "node", id } });
  }

  function startDraft(place: Placement, before: Focus) {
    setMenu(null);
    setPick(null);
    setEdit({ id: crypto.randomUUID(), text: "", original: "", draft: place, before });
  }

  function addChild(id: string) {
    startDraft(childPlacement(model.ctx(), id, shorterSide()), { kind: "node", id });
  }

  function addSibling(id: string, before: boolean) {
    if (isRoot(id)) return addChild(id);
    startDraft(siblingPlacement(model.ctx(), id, before), { kind: "node", id });
  }

  function endEdit(how: EditEnd) {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    setEdit(null);
    const ctx = model.ctx();
    const text = tidy(e.text);
    if (how === "cancel") {
      if (e.before?.kind === "node") select(e.before.id, false);
      focusMap();
      return;
    }
    let saved = true;
    if (e.draft) {
      if (text === "") saved = false;
      else model.commit(create(ctx, e.id, e.draft, text), e.before, { kind: "node", id: e.id });
    } else if (text !== e.original) {
      model.commit(setText(ctx, e.id, text), e.before);
    }
    if (saved) setSel({ kind: "node", id: e.id });
    else if (e.before?.kind === "node") setSel(e.before);
    const from = saved ? e.id : e.before?.kind === "node" ? e.before.id : null;
    if (how === "blur") return;
    if (from && saved && how === "child") addChild(from);
    else if (from && saved && how === "sibling") addSibling(from, false);
    else {
      focusMap();
      if (from) say(saved ? `Saved. ${describe(from)}` : describe(from));
    }
  }

  // ---- Changing the map ---------------------------------------------------------------------

  function deleteNode(id: string) {
    if (isRoot(id)) return say("The centre of a map can't be deleted.");
    const ctx = model.ctx();
    const node = store.get(id)!;
    const siblings = liveChildren(ctx, node.parentId!, node.side);
    const at = siblings.indexOf(id);
    const next = siblings[at + 1] ?? siblings[at - 1] ?? node.parentId!;
    const under = branchSize(ctx, id) - 1;
    if (run(remove(ctx, id), { kind: "node", id: next })) {
      const text = `Deleted “${short(node.text)}”${under > 0 ? ` and ${count(under, "node", "nodes")} under it` : ""}.`;
      setUndoToast({ text, id });
      say(`${text} Ctrl+Z brings it back.`);
    }
  }

  function toggleFold(id: string) {
    const node = store.get(id);
    if (!node || isRoot(id) || store.liveChildren(id).length === 0) return;
    if (run(setCollapsed(model.ctx(), id, !node.collapsed))) say(node.collapsed ? "Unfolded" : "Folded");
  }

  function moveSelected(dir: Dir) {
    const id = selectedNode;
    const box = id ? layoutRef.current?.boxes.get(id) : null;
    if (!id || !box || box.side === null) return;
    const ctx = model.ctx();
    let result: Result | null;
    if (dir === "up" || dir === "down") result = moveAmongSiblings(ctx, id, dir === "up" ? -1 : 1);
    else if (isOutward(box.side, dir)) result = demote(ctx, id);
    else if (box.level === 1) {
      // Across the centre: next to the main branch on the other side at about the same height.
      const other = box.side === "left" ? "right" : "left";
      const mains = liveChildren(ctx, store.rootId, other);
      const layoutNow = layoutRef.current!;
      const y = box.y + box.h / 2;
      const above = mains.filter((k) => {
        const b = layoutNow.boxes.get(k);
        return b && b.y + b.h / 2 < y;
      });
      result = crossSide(ctx, id, above.at(-1) ?? null);
    } else result = promote(ctx, id);
    if (run(result)) say(`Moved. ${describe(id)}`);
    else say("It can't move that way.");
  }

  async function copySelected(cut: boolean): Promise<string | null> {
    const id = selectedNode;
    if (!id) return null;
    const text = toPlainText(model.textSource(), id);
    if (cut && !isRoot(id)) deleteNode(id);
    else say(`Copied ${count(branchSize(model.ctx(), id), "node", "nodes")}.`);
    return text;
  }

  /** Copy or cut from the menu: straight to the clipboard. */
  async function copyBranch(cut: boolean) {
    const text = await copySelected(cut);
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      props.onNotice("The browser didn't allow the clipboard here.", "error");
    }
  }

  function pasteText(text: string) {
    let drafts: Draft[];
    let note = "";
    try {
      if (looksLikeOpml(text)) {
        const file = parseOpml(text);
        drafts = file.drafts;
        note = leftOut(file);
      } else drafts = parsePlainText(text);
    } catch (err) {
      props.onNotice(err instanceof OpmlError ? err.message : "That couldn't be pasted.", "error");
      return;
    }
    insert(drafts, note);
  }

  /** Puts drafts under the selected node (or the centre). */
  function insert(drafts: Draft[], note = "") {
    const n = countDrafts(drafts);
    if (n === 0) return;
    const room = LIMITS.mapNodes - [...store.nodes()].length;
    if (n > room) {
      props.onNotice(`That is ${count(n, "node", "nodes")}; this map has room for ${room} more.`, "error");
      return;
    }
    const parent = selectedNode ?? store.rootId;
    if (run(insertDrafts(model.ctx(), parent, drafts))) {
      say(`Added ${count(n, "node", "nodes")}.${note}`);
      if (note) props.onNotice(`Added ${count(n, "node", "nodes")}.${note}`);
    }
  }

  function startArrow(from: string) {
    setMenu(null);
    setPick({ from, target: null });
    say("Pick the node the arrow points to: use the arrow keys or click it, then press Enter. Esc cancels.");
  }

  function finishArrow(target: string | null) {
    const p = pick;
    setPick(null);
    if (!p || !target || target === p.from) {
      say("No arrow made.");
      setSel({ kind: "node", id: p?.from ?? store.rootId });
      return;
    }
    const existing = [...store.arrows()].find((a) => a.deletedAt === null && a.fromId === p.from && a.toId === target);
    if (existing) {
      selectArrow(existing.id);
      return;
    }
    const result = addArrow(model.ctx(), p.from, target);
    const op = result?.ops[0];
    if (op && model.commit(result, { kind: "node", id: p.from }, { kind: "arrow", id: op.id })) {
      selectArrow(op.id);
      say(
        `Arrow made from ${short(store.get(p.from)!.text)} to ${short(store.get(target)!.text)}. Enter adds a label.`,
      );
    }
  }

  /** The arrows that touch a node, in drawing order. */
  const arrowsOf = (id: string) => arrowsRef.current.filter((a) => a.arrow.fromId === id || a.arrow.toId === id);

  function nextArrow() {
    const home = sel?.kind === "node" ? sel.id : sel?.kind === "arrow" ? (store.arrow(sel.id)?.fromId ?? null) : null;
    if (!home) return;
    const list = arrowsOf(home);
    if (list.length === 0) return say("This node has no arrows.");
    const at = sel?.kind === "arrow" ? list.findIndex((a) => a.arrow.id === sel.id) : -1;
    selectArrow(list[(at + 1) % list.length]!.arrow.id);
  }

  function editLabel(arrowId: string) {
    const shown = arrowsRef.current.find((a) => a.arrow.id === arrowId);
    if (!shown) return;
    const { label } = arrowShape(shown.from, shown.to);
    setLabelEdit({ arrowId, text: shown.arrow.label, x: label.x, y: label.y });
  }

  function deleteArrow(arrowId: string) {
    const a = store.arrow(arrowId);
    if (!a) return;
    if (run({ ops: [{ op: "deleteArrow", id: arrowId }] }, { kind: "node", id: a.fromId })) {
      select(a.fromId, false);
      say("Arrow deleted. Ctrl+Z brings it back.");
    }
  }

  function openLink(id: string) {
    const urls = findUrls(store.get(id)?.text ?? "");
    if (urls.length === 0) return say("This node has no link.");
    if (urls.length > 1) return openMenu(id);
    window.open(urls[0], "_blank", "noopener,noreferrer");
  }

  function undo() {
    setUndoToast(null);
    const focus = model.undo();
    if (focus === undefined) return say("Nothing to undo.");
    restoreFocus(focus);
    say("Undone.");
  }

  function redo() {
    setUndoToast(null);
    const focus = model.redo();
    if (focus === undefined) return say("Nothing to redo.");
    restoreFocus(focus);
    say("Redone.");
  }

  function restoreFocus(focus: Focus) {
    requestAnimationFrame(() => {
      if (focus?.kind === "node" && store.isLive(focus.id)) select(focus.id);
      else if (focus?.kind === "arrow") setSel(focus);
    });
  }

  function openMenu(id: string, at?: { x: number; y: number }) {
    const box = layoutRef.current?.boxes.get(id);
    if (!box) return;
    const p = at ?? view.toScreen(box.x + box.w / 2, box.y + box.h);
    setSel({ kind: "node", id });
    setMenu({ id, x: p.x, y: p.y + 4 });
  }

  // ---- Export and import --------------------------------------------------------------------

  const name = mapName(rootText ?? "");

  /** A branch laid out on its own, with it at the centre: for exporting just that. */
  function branchLayout(id: string): Layout {
    const tree: LayoutTree = {
      rootId: id,
      get: (k) => store.get(k),
      children: (k) => store.liveChildren(k),
    };
    return layoutMap(tree, measure);
  }

  async function exportPng(id: string | null) {
    const l = id && !isRoot(id) ? branchLayout(id) : layoutRef.current;
    if (!l) return;
    // Arrows with an end outside the branch never reach it walking up, so they are left out.
    const list = shownArrows(
      l,
      store.arrows(),
      (k) => store.get(k)?.parentId,
      (k) => store.isLive(k),
    );
    try {
      const { blob, scale } = await mapToPng(l, list);
      const title = id && !isRoot(id) ? mapName(store.get(id)!.text) : name;
      download(fileName(title, "png"), "image/png", blob);
      if (scale < 1) {
        props.onNotice(`The map is big, so the picture is ${Math.round(scale * 100)}% of its size on screen.`);
      }
    } catch (err) {
      console.error(err);
      props.onNotice("The picture could not be made. Fold some branches, or export one branch.", "error");
    }
  }

  function exportOpml(id: string | null) {
    const top = id ?? store.rootId;
    const title = mapName(store.get(top)?.text ?? "");
    download(fileName(title, "opml"), "text/x-opml", toOpml(model.textSource(), top, title));
    if ([...store.arrows()].some((a) => a.deletedAt === null)) {
      props.onNotice("OPML has no place for arrows, so they were left out. The backup keeps them.");
    }
  }

  async function importInto(file: File) {
    try {
      const parsed = parseOpml(await file.text());
      insert(parsed.drafts, leftOut(parsed));
    } catch (err) {
      props.onNotice(
        err instanceof OpmlError ? `${file.name}: ${err.message}` : `Could not read ${file.name}.`,
        "error",
      );
    }
  }

  async function deleteMap(): Promise<boolean> {
    try {
      sync.forget(mapId);
      await api(`/api/maps/${mapId}`, { method: "DELETE" });
      forgetView(username, mapId);
      props.onDeleted(mapId);
      return true;
    } catch (err) {
      props.onError(err);
      return false;
    }
  }

  // ---- Keys ---------------------------------------------------------------------------------

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.target !== containerRef.current) return;
    if (dragRef.current) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDrag();
      }
      return;
    }
    const mode: Mode = pick ? "pick" : selectedNode ? "node" : sel?.kind === "arrow" ? "arrow" : "none";
    const intent = intentOf(e.nativeEvent, mode);
    if (!intent) return;
    if (intent.kind !== "copy" && intent.kind !== "cut" && intent.kind !== "paste") e.preventDefault();
    act(intent);
  }

  function act(intent: Intent) {
    const l = layoutRef.current;
    if (!l) return;
    const id = selectedNode;
    switch (intent.kind) {
      case "nav": {
        const from = pick ? (pick.target ?? pick.from) : id;
        if (!from) return;
        const to = navigate(l, from, intent.dir, lastChild.current);
        if (!to) return say(pick ? "No node that way." : `${describe(from)}. Nothing further that way.`);
        const fromBox = l.boxes.get(from)!;
        if (fromBox.parentId === to) lastChild.current.set(to, from);
        if (pick) {
          setPick({ ...pick, target: to });
          view.reveal(l.boxes.get(to)!);
          say(to === pick.from ? "Back at the start." : `To ${describe(to)}`);
        } else select(to);
        return;
      }
      case "home": {
        const root = l.boxes.get(store.rootId)!;
        view.centreOn(root.x + root.w / 2, root.y + root.h / 2);
        return select(store.rootId, false);
      }
      case "escape":
        if (pick) return finishArrow(null);
        if (sel?.kind === "arrow") {
          const a = store.arrow(sel.id);
          return a ? select(a.fromId) : setSel(null);
        }
        setSel(null);
        return say("Nothing selected. Tab leaves the map; an arrow key comes back.");
      case "edit":
        if (sel?.kind === "arrow") return editLabel(sel.id);
        if (id) startEdit(id);
        return;
      case "add-child":
        if (id) addChild(id);
        return;
      case "add-sibling":
        if (id) addSibling(id, intent.before);
        return;
      case "move":
        return moveSelected(intent.dir);
      case "move-end":
        if (id && run(moveToEnd(model.ctx(), id, intent.end))) say(`Moved. ${describe(id)}`);
        return;
      case "fold":
        if (id) toggleFold(id);
        return;
      case "delete":
        if (sel?.kind === "arrow") return deleteArrow(sel.id);
        if (id) deleteNode(id);
        return;
      case "arrow-start":
        if (id) startArrow(id);
        return;
      case "arrow-next":
        return nextArrow();
      case "confirm":
        return finishArrow(pick?.target ?? null);
      case "open-link":
        if (id) openLink(id);
        return;
      case "undo":
        return undo();
      case "redo":
        return redo();
      case "copy":
      case "cut":
        return clipboardFallback(intent.kind);
      case "paste":
        return clipboardFallback("paste");
      case "zoom":
        if (intent.by === "fit") view.setBounds(drawnBounds(l, arrowsRef.current), true);
        else view.zoomBy(intent.by === "in" ? 1.25 : 0.8);
        return;
      case "menu":
        if (id) openMenu(id);
        return;
      case "help":
        return props.onHelp();
    }
  }

  // Copy, cut and paste: the browser's own events where it fires them (they need no permission);
  // otherwise (Safari, with nothing selected on the page) the Clipboard API.
  function clipboardFallback(kind: "copy" | "cut" | "paste") {
    window.clearTimeout(clipboardPending.current);
    clipboardPending.current = window.setTimeout(async () => {
      clipboardPending.current = 0;
      try {
        if (kind === "paste") pasteText(await navigator.clipboard.readText());
        else {
          const text = await copySelected(kind === "cut");
          if (text !== null) await navigator.clipboard.writeText(text);
        }
      } catch {
        props.onNotice("The browser didn't allow the clipboard here.", "error");
      }
    }, 50);
  }

  function onClipboard(kind: "copy" | "cut" | "paste", e: ReactClipboardEvent) {
    if (e.target !== containerRef.current || editRef.current) return;
    window.clearTimeout(clipboardPending.current);
    clipboardPending.current = 0;
    e.preventDefault();
    if (kind === "paste") return pasteText(e.clipboardData.getData("text/plain"));
    void copySelected(kind === "cut").then((text) => {
      if (text !== null) e.clipboardData.setData("text/plain", text);
    });
  }

  // ---- Pointer ------------------------------------------------------------------------------

  function beginDrag(p: Press) {
    const l = layoutRef.current;
    const box = p.node ? l?.boxes.get(p.node) : undefined;
    if (!l || !box || box.level === 0) {
      p.mode = "pan";
      return;
    }
    p.mode = "drag";
    window.clearTimeout(p.timer);
    if (p.touch) navigator.vibrate?.(10);
    const pt = view.toMap(p.lastX, p.lastY);
    setMenu(null);
    setDrag({
      id: box.id,
      ids: shownBranch(l, box.id),
      ghost: { box, x: pt.x, y: pt.y, grabX: pt.x - box.x, grabY: pt.y - box.y },
      drop: null,
    });
    autoPan();
  }

  function updateDrag(clientX: number, clientY: number) {
    const d = dragRef.current;
    const l = layoutRef.current;
    if (!d || !l) return;
    const pt = view.toMap(clientX, clientY);
    const drop = dropTarget(l, d.id, pt.x, pt.y, view.k);
    setDrag({ ...d, ghost: { ...d.ghost, x: pt.x, y: pt.y }, drop });
  }

  // Near the map's edges while dragging, the map moves along.
  const panFrame = useRef(0);
  function autoPan() {
    cancelAnimationFrame(panFrame.current);
    const tick = () => {
      const p = press.current;
      const el = containerRef.current;
      if (!p || p.mode !== "drag" || !el) return;
      const rect = el.getBoundingClientRect();
      const edge = 40;
      const step = (d: number) => (d < edge ? ((edge - d) / edge) * 14 : 0);
      const dx = step(p.lastX - rect.left) - step(rect.right - p.lastX);
      const dy = step(p.lastY - rect.top) - step(rect.bottom - p.lastY);
      if (dx || dy) {
        view.panBy(dx, dy);
        updateDrag(p.lastX, p.lastY);
      }
      panFrame.current = requestAnimationFrame(tick);
    };
    panFrame.current = requestAnimationFrame(tick);
  }

  function dropDrag() {
    cancelAnimationFrame(panFrame.current);
    const d = dragRef.current;
    setDrag(null);
    if (!d?.drop) return say("Not moved.");
    const ctx = model.ctx();
    const { parentId, side } = d.drop;
    const afterId =
      d.drop.afterId === undefined
        ? (liveChildren(ctx, parentId, parentId === store.rootId ? side : null)
            .filter((k) => k !== d.id)
            .at(-1) ?? null)
        : d.drop.afterId;
    if (run(moveTo(ctx, d.id, parentId, afterId, side))) say(`Moved. ${describe(d.id)}`);
  }

  function cancelDrag() {
    cancelAnimationFrame(panFrame.current);
    if (press.current?.mode === "drag") press.current = null;
    setDrag(null);
    say("Not moved.");
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const t = e.target as Element;
    if (t.closest("[data-ui]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (released before this ran): nothing to follow.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom, and move them to pan.
      if (press.current?.mode === "drag") cancelDrag();
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.current.size > 2) return;
    if (editRef.current) endEdit("blur");
    if (e.pointerType !== "touch") e.preventDefault();
    focusMap();
    const p: Press = {
      pointerId: e.pointerId,
      touch: e.pointerType === "touch",
      node: t.closest("[data-node]")?.getAttribute("data-node") ?? null,
      arrow: t.closest("[data-arrow]")?.getAttribute("data-arrow") ?? null,
      badge: t.closest("[data-badge]")?.getAttribute("data-badge") ?? null,
      href: t.closest("[data-href]")?.getAttribute("data-href") ?? null,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      mode: "pending",
      timer: 0,
    };
    press.current = p;
    if (p.touch && p.node && !pick && !p.badge) p.timer = window.setTimeout(() => beginDrag(p), LONG_PRESS_MS);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      const rect = containerRef.current!.getBoundingClientRect();
      view.panBy(x - pz.x, y - pz.y);
      if (pz.dist > 0) view.zoomAt(dist / pz.dist, x - rect.left, y - rect.top);
      pinch.current = { dist, x, y };
      return;
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (p.mode === "pending") {
      const distance = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (!p.touch && p.node && !p.badge && !pick && distance >= DRAG_THRESHOLD) beginDrag(p);
      else if (distance >= (p.touch ? LONG_PRESS_SLOP : DRAG_THRESHOLD)) {
        window.clearTimeout(p.timer);
        p.mode = "pan";
      }
    }
    if (p.mode === "pan") view.panBy(dx, dy);
    else if (p.mode === "drag") updateDrag(e.clientX, e.clientY);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      press.current = null;
      return;
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    window.clearTimeout(p.timer);
    press.current = null;
    if (p.mode === "drag") dropDrag();
    else if (p.mode === "pending") click(p);
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    const p = press.current;
    if (p?.pointerId !== e.pointerId) return;
    window.clearTimeout(p.timer);
    if (p.mode === "drag") cancelDrag();
    press.current = null;
  }

  function click(p: Press) {
    setMenu(null);
    if (pick) {
      if (p.node) finishArrow(p.node);
      return;
    }
    if (p.badge) {
      select(p.badge, false);
      return toggleFold(p.badge);
    }
    if (p.node) {
      if (p.href) window.open(p.href, "_blank", "noopener,noreferrer");
      const now = Date.now();
      // A double tap edits, as a double-click does.
      if (p.touch && lastTap.current?.id === p.node && now - lastTap.current.at < 350) {
        lastTap.current = null;
        return startEdit(p.node);
      }
      lastTap.current = { id: p.node, at: now };
      return select(p.node, false);
    }
    if (p.arrow) return selectArrow(p.arrow);
    setSel(null);
  }

  // Wheel: pan, or with Ctrl (and a trackpad's pinch) zoom. Safari's own pinch events zoom too.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest("[data-ui]")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.max(-100, Math.min(100, e.deltaY * unit));
        view.zoomAt(2 ** (-delta * 0.006), e.clientX - rect.left, e.clientY - rect.top);
      } else if (e.shiftKey && !e.deltaX) view.panBy(-e.deltaY * unit, 0);
      else view.panBy(-e.deltaX * unit, -e.deltaY * unit);
    };
    let gestureK = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureK = view.k;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const rect = el.getBoundingClientRect();
      view.zoomAt((gestureK * g.scale) / view.k, g.clientX - rect.left, g.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [view, status]);

  // ---- Drawing ------------------------------------------------------------------------------

  const textOf = useCallback((id: string) => store.get(id)?.text ?? "", [store]);

  /** What a node's menu offers. */
  function nodeMenuItems(node: MapNode): (NodeMenuItem | "-")[] {
    const id = node.id;
    const root = isRoot(id);
    const kids = store.liveChildren(id).length;
    const items: (NodeMenuItem | "-")[] = [
      { label: "Edit text", icon: <Pencil className="h-4 w-4" />, keys: "Enter", onSelect: () => startEdit(id) },
      { label: "Add a child", icon: <Plus className="h-4 w-4" />, keys: "Tab", onSelect: () => addChild(id) },
    ];
    if (!root) {
      items.push(
        { label: "Add a node below", keys: "N", onSelect: () => addSibling(id, false) },
        { label: "Add a node above", keys: "Shift+N", onSelect: () => addSibling(id, true) },
      );
    }
    if (!root && kids > 0) {
      items.push({
        label: node.collapsed ? "Unfold" : "Fold",
        icon: <ChevronsDownUp className="h-4 w-4" />,
        keys: "Space",
        onSelect: () => toggleFold(id),
      });
    }
    items.push("-", {
      label: "Draw an arrow from here",
      icon: <Spline className="h-4 w-4" />,
      keys: "A",
      onSelect: () => startArrow(id),
    });
    for (const shown of arrowsOf(id)) {
      const a: Arrow = shown.arrow;
      const out = a.fromId === id;
      const other = store.get(out ? a.toId : a.fromId)?.text ?? "";
      items.push({
        label: `${out ? "To" : "From"} ${short(other, 28)}${a.label ? ` (${a.label})` : ""}`,
        icon: <ArrowRight className={`h-4 w-4 ${out ? "" : "rotate-180"}`} />,
        onSelect: () => selectArrow(a.id),
      });
    }
    for (const url of findUrls(node.text)) {
      items.push({
        label: `Open ${url.replace(/^https?:\/\//, "")}`,
        icon: <ExternalLink className="h-4 w-4" />,
        onSelect: () => window.open(url, "_blank", "noopener,noreferrer"),
      });
    }
    items.push("-", {
      label: "Copy the branch",
      icon: <Copy className="h-4 w-4" />,
      keys: "Ctrl+C",
      onSelect: () => void copyBranch(false),
    });
    if (!root) {
      items.push({
        label: "Cut the branch",
        icon: <Scissors className="h-4 w-4" />,
        keys: "Ctrl+X",
        onSelect: () => void copyBranch(true),
      });
    }
    items.push(
      {
        label: "Export the branch as a picture",
        icon: <ImageIcon className="h-4 w-4" />,
        onSelect: () => void exportPng(id),
      },
      { label: "Export the branch as OPML", icon: <FileDown className="h-4 w-4" />, onSelect: () => exportOpml(id) },
      {
        label: "Import OPML under this node…",
        icon: <FileUp className="h-4 w-4" />,
        onSelect: () => fileInput.current?.click(),
      },
    );
    if (!root) {
      items.push("-", {
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        keys: "Delete",
        danger: true,
        onSelect: () => deleteNode(id),
      });
    }
    return items;
  }

  if (status === "missing") {
    return <p className="m-auto p-8 text-sm text-stone-500">This map isn't here. It may have been deleted.</p>;
  }

  const editBox = edit && layout ? layout.boxes.get(edit.id) : undefined;
  const menuNode = menu ? store.get(menu.id) : undefined;
  const canUndo = model.history.canUndo;
  const canRedo = model.history.canRedo;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1 border-b border-stone-200 bg-white px-2 py-1.5">
        <button type="button" className={`${iconButton} md:hidden`} aria-label="Menu" onClick={props.onMenu}>
          <MenuIcon className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 font-semibold text-stone-800" title={name}>
          {name}
        </h1>
        <SaveState state={syncState} />
        <button
          type="button"
          className={iconButton}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <Menu
          label="Map menu"
          items={[
            {
              label: "Export as picture (PNG)",
              icon: <ImageIcon className="h-4 w-4" />,
              onSelect: () => void exportPng(null),
            },
            { label: "Export as OPML", icon: <FileDown className="h-4 w-4" />, onSelect: () => exportOpml(null) },
            {
              label: "Import OPML here…",
              icon: <FileUp className="h-4 w-4" />,
              onSelect: () => fileInput.current?.click(),
            },
            {
              label: "Delete map…",
              icon: <Trash2 className="h-4 w-4" />,
              danger: true,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".opml,.xml,text/x-opml,application/xml,text/xml"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importInto(file);
          }}
        />
      </header>

      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-roledescription="mind map"
        aria-label={`${name}. Arrow keys move between nodes, Enter edits, Tab adds a child, N a node below, question mark lists every key.`}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-stone-50 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-fuchsia-400 focus-visible:ring-inset"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={(e) => {
          const t = e.target as Element;
          if (t.closest("[data-ui], [data-badge]")) return;
          const node = t.closest("[data-node]")?.getAttribute("data-node");
          const arrow = t.closest("[data-arrow]")?.getAttribute("data-arrow");
          if (node) startEdit(node);
          else if (arrow) editLabel(arrow);
        }}
        onContextMenu={(e) => {
          const node = (e.target as Element).closest("[data-node]")?.getAttribute("data-node");
          if (!node || (e.target as Element).closest("[data-ui]")) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          openMenu(node, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onCopy={(e) => onClipboard("copy", e)}
        onCut={(e) => onClipboard("cut", e)}
        onPaste={(e) => onClipboard("paste", e)}
      >
        {layout ? (
          <MapCanvas
            layout={layout}
            arrows={arrows}
            textOf={textOf}
            selectedNode={pick ? pick.from : selectedNode}
            selectedArrow={sel?.kind === "arrow" ? sel.id : null}
            editing={edit?.id ?? null}
            pickFrom={pick?.from ?? null}
            pickTarget={pick?.target ?? null}
            dragging={drag?.ids ?? null}
            drop={drag?.drop ?? null}
            ghost={drag?.ghost ?? null}
            area={area}
            worldRef={worldRef}
          />
        ) : (
          <p className="p-8 text-sm text-stone-400">Opening the map…</p>
        )}

        {edit && editBox && (
          <div data-ui>
            <Editor
              box={editBox}
              text={edit.text}
              view={view}
              onChange={(text) => setEdit((e) => (e ? { ...e, text } : e))}
              onEnd={endEdit}
            />
          </div>
        )}

        {labelEdit && (
          <div data-ui>
            <LabelEditor
              at={{ x: labelEdit.x, y: labelEdit.y }}
              text={labelEdit.text}
              view={view}
              onEnd={(text) => {
                const id = labelEdit.arrowId;
                setLabelEdit(null);
                if (text !== null && text.trim() !== store.arrow(id)?.label) {
                  run({ ops: [{ op: "updateArrow", id, label: text.trim() }] }, { kind: "arrow", id });
                }
                selectArrow(id);
                focusMap();
              }}
            />
          </div>
        )}

        {menu && menuNode && (
          <div data-ui>
            <NodeMenu
              x={menu.x}
              y={menu.y}
              label={`Menu for ${short(menuNode.text)}`}
              onClose={() => {
                setMenu(null);
                focusMap();
              }}
              items={nodeMenuItems(menuNode)}
            />
          </div>
        )}

        {pick && (
          <div
            data-ui
            className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-stone-800 px-4 py-1.5 text-sm text-white shadow"
          >
            Pick the node the arrow points to · Esc cancels
          </div>
        )}

        <div
          data-ui
          className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shadow-sm"
        >
          <button
            type="button"
            className={iconButton}
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => view.zoomBy(0.8)}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-11 text-center text-xs text-stone-500 tabular-nums">{zoomText}</span>
          <button
            type="button"
            className={iconButton}
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => view.zoomBy(1.25)}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label="Fit the whole map"
            title="Fit the whole map (0)"
            onClick={() => layout && view.setBounds(drawnBounds(layout, arrows), true)}
          >
            <Maximize className="h-4 w-4" />
          </button>
        </div>

        {selectedNode && !edit && !pick && (
          <div
            data-ui
            className="absolute bottom-3 left-3 z-10 hidden items-center gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shadow-sm pointer-coarse:flex"
          >
            <button
              type="button"
              className={iconButton}
              aria-label="Add a child"
              onClick={() => addChild(selectedNode)}
            >
              <Plus className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} aria-label="Edit" onClick={() => startEdit(selectedNode)}>
              <Pencil className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Draw an arrow"
              onClick={() => startArrow(selectedNode)}
            >
              <Spline className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} aria-label="More" onClick={() => openMenu(selectedNode)}>
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        )}

        {undoToast && (
          <div
            data-ui
            role="status"
            className="absolute bottom-14 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-stone-800 px-4 py-2 text-sm text-white shadow-lg"
          >
            <span className="min-w-0 truncate">{undoToast.text}</span>
            <button
              type="button"
              className="shrink-0 font-semibold text-fuchsia-300 hover:text-fuchsia-200"
              onClick={() => {
                const id = undoToast.id;
                setUndoToast(null);
                if (run({ ops: [{ op: "restore", id }], select: id })) say("Brought back.");
                focusMap();
              }}
            >
              Undo
            </button>
          </div>
        )}

        <div className="sr-only" aria-live="polite" aria-atomic>
          {announcement}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this map?"
          message={`“${name}” and its ${count(
            Math.max(0, (layout ? branchSize(model.ctx(), store.rootId) : 1) - 1),
            "node",
            "nodes",
          )} and ${count(arrows.length, "arrow", "arrows")} go for good. This can't be undone.`}
          action="Delete the map"
          onConfirm={deleteMap}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/** "Saving…", "Offline", or nothing once everything is saved. */
function SaveState({ state }: { state: SyncState }) {
  if (state.kind === "saved") return null;
  const text =
    state.kind === "saving"
      ? "Saving…"
      : state.kind === "offline"
        ? "Offline: changes wait here"
        : "Signed out: changes wait here";
  return (
    <span className={`px-2 text-xs ${state.kind === "saving" ? "text-stone-400" : "text-amber-700"}`} role="status">
      {text}
    </span>
  );
}
