import { useEffect, useState } from "react";
import { SignedOutError, fetchMe, goToSignIn, type Me } from "@axis-suite/heimdall-client/browser";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((err) => err instanceof SignedOutError && goToSignIn(err));
  }, []);
  return <p className="p-6 text-stone-700">{me ? `Papyrus — ${me.name}` : "Loading…"}</p>;
}
