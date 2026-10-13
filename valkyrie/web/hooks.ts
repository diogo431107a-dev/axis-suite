import { useEffect, useState } from "react";
import { pad } from "../shared/dates.ts";

/** This device's date now, YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today's date, which changes at midnight (checked every minute, and when the window gets focus). */
export function useToday(): string {
  const [day, setDay] = useState(localToday);
  useEffect(() => {
    const check = () => setDay(localToday());
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  return day;
}
