import type { ReactNode } from "react";
import { go, opensElsewhere, pathOf } from "../nav.ts";

interface LinkProps {
  /** a conversation key */
  to: string;
  className?: string;
  /** runs before going there (e.g. closing the menu on a phone) */
  onClick?: () => void;
  current?: boolean;
  children: ReactNode;
}

/** A link to a conversation: a real <a>, so it can also open in a new tab. */
export function Link({ to, className, onClick, current, children }: LinkProps) {
  return (
    <a
      href={pathOf(to)}
      className={className}
      aria-current={current ? "page" : undefined}
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
