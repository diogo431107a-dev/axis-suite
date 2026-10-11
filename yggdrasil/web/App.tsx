import { useEffect, useState } from "react";
import { SignedOutError, fetchMe, goToSignIn, type Me } from "@axis-suite/heimdall-client/browser";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((e) => {
        if (e instanceof SignedOutError) goToSignIn(e);
        else setLoadError("Could not load your outline. Try again in a moment.");
      });
  }, []);

  if (!me) {
    return (
      <div className="flex items-center justify-center h-screen bg-white text-gray-400 text-sm">
        {loadError || "Loading…"}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen bg-white text-gray-800 text-lg">Hello, {me.name}</div>
  );
}
