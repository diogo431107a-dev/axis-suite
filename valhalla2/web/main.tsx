import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/600.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "./index.css";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no root to render into");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
