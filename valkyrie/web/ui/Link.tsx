import type { ReactNode } from "react";
import { go, opensElsewhere, pathOf, type Route } from "../nav.ts";

interface LinkProps {
  to: Route;
  className?: string;
  title?: string;
  id?: string;
  /** runs before going there (e.g. closing the menu on a phone) */
  onClick?: () => void;
  children: ReactNode;
}

/** A link to a board or card: a real <a>, so it can also open in a new tab. */
export function Link({ to, className, title, id, onClick, children }: LinkProps) {
  return (
    <a
      href={pathOf(to)}
      className={className}
      title={title}
      id={id}
      draggable={false}
      onClick={(e) => {
        if (opensElsewhere(e)) return;
        e.preventDefault();
        onClick?.();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
