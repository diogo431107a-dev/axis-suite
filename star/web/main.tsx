import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/500.css";
import "@fontsource/jost/300.css";
import "@fontsource/jost/300-italic.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/400-italic.css";
import "@fontsource/jost/500.css";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
