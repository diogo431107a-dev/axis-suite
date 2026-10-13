import { useEffect, useState } from "react";
import { todayIn } from "../shared/zones.ts";

/** Today's date in a zone, which changes at midnight (checked every minute, and when the window gets focus). */
export function useToday(zone: string): string {
  const [day, setDay] = useState(() => todayIn(zone));
  useEffect(() => {
    const check = () => setDay(todayIn(zone));
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [zone]);
  return day;
}
