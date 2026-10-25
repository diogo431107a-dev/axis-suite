import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "./style.css";
import "./input.js";
import { boot } from "./net.js";

/* =====================================================================
   BOOT
   ===================================================================== */
if (document.fonts && document.fonts.load) document.fonts.load('9px "Press Start 2P"').catch(() => {});
boot();
