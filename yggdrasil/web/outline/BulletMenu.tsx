// The menu of a bullet's dot (right-click the dot, or the ⋯ button on the row).
import { useEffect, useRef, type ReactNode } from "react";
import { Check, Link, Star, Trash2 } from "lucide-react";
import * as cmd from "../model/commands.ts";
import { useNode, useOutliner } from "./hooks.ts";
import { pathOf } from "./nav.ts";

interface Props {
  id: string;
  onClose: () => void;
  /** Extra items (export). */
  children?: ReactNode;
}

export function BulletMenu({ id, onClose, children }: Props) {
  const o = useOutliner();
  const node = useNode(id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [onClose]);

  if (!node) return null;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-[1.6em] z-30 w-56 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
    >
      <Item icon={<Star className="h-4 w-4" />} onClick={act(() => o.run((ctx) => cmd.toggleStar(ctx, id)))}>
        {node.starred ? "Remove star" : "Star"}
      </Item>
      <Item icon={<Check className="h-4 w-4" />} onClick={act(() => o.run((ctx) => cmd.toggleComplete(ctx, [id])))}>
        {node.completedAt ? "Mark as not completed" : "Complete"}
      </Item>
      {children}
      <Item
        icon={<Link className="h-4 w-4" />}
        onClick={act(() => void navigator.clipboard?.writeText(new URL(pathOf(id), location.origin).href))}
      >
        Copy link
      </Item>
      <div className="my-1 border-t border-gray-100" />
      <Item icon={<Trash2 className="h-4 w-4" />} danger onClick={act(() => o.run((ctx) => cmd.remove(ctx, [id])))}>
        Delete
      </Item>
    </div>
  );
}

export function Item({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 ${
        danger ? "text-red-700" : "text-gray-700"
      }`}
    >
      <span className="text-gray-400">{icon}</span>
      {children}
    </button>
  );
}
