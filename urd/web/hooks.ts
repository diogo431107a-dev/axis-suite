import { useEffect, useState } from "react";
import { today } from "../shared/dates.ts";

/** Today's date, which changes at midnight (or when the computer wakes up on another day). From Papyrus. */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const check = () => setDay(today());
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const timer = setTimeout(check, midnight + 1000);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [day]);
  return day;
}
