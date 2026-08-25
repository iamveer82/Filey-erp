import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "@shared/theme";
import { applyAccent } from "@shared/accent";

// Same theme + accent stores as the desktop app: whatever the user picked
// there (same localStorage origin when embedded, same keys everywhere) is
// what the phone renders.
applyTheme();
applyAccent();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
