// Light or dark: the computer's setting, unless told otherwise (the choice is kept on this computer).
import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

/** The switch's cycle: System, Light, Dark. */
export const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

const THEME_KEY = "urd.theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function loadTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function saveTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // not kept: the next visit follows the computer
  }
}

/** Marks the page dark or light; "light" also turns off index.css's fallback for a dark computer. */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}

/** The theme chosen, and a move to the next one. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    // The computer can change while the page is open (at sunset, for some).
    const query = darkQuery();
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const next = useCallback(() => {
    setTheme((t) => {
      saveTheme(NEXT_THEME[t]);
      return NEXT_THEME[t];
    });
  }, []);

  return [theme, next];
}
