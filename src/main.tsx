import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Kill the webview's default context menu everywhere (Reload / Inspect Element —
// DevTools embeds itself unusably into a transparent click-through overlay).
// Our own right-click picker handles the event on its targets first.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// A crashed React tree leaves an invisible, silent overlay (there is no visible
// page to show an error on). Self-heal: reload once, rate-limited so a genuine
// persistent crash cannot reload-loop.
class ReloadBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Danglings crashed:", error);
    const last = Number(sessionStorage.getItem("danglings.reloadAt") ?? 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem("danglings.reloadAt", String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReloadBoundary>
      <App />
    </ReloadBoundary>
  </React.StrictMode>,
);
