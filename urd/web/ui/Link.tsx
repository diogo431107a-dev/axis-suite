import type { ReactNode } from "react";
import { go, opensElsewhere, pathOf, type Route } from "../nav.ts";

interface LinkProps {
  to: Route;
  className?: string;
  title?: string;
  /** runs before going there (e.g. closing the menu on a phone) */
  onClick?: () => void;
  children: ReactNode;
}

/** A link to a view of the page: a real <a>, so it can also open in a new tab. */
export function Link({ to, className, title, onClick, children }: LinkProps) {
  return (
    <a
      href={pathOf(to)}
      className={className}
      title={title}
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
