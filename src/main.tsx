import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Kill the webview's default context menu everywhere (Reload / Inspect Element —
// DevTools embeds itself unusably into a transparent click-through overlay).
// Our own right-click picker handles the event on its targets first.
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
