import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/theme.css";
import "./styles/ui.css";
import "./styles/shell.css";
import "./styles/screens.css";
import { hydrate } from "./lib/device";
import { App } from "./App";

// The device's secrets load before the first paint, so no screen flashes as a stranger to a room it belongs to.
hydrate()
  .catch(() => {})
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
