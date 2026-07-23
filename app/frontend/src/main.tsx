import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Initialise Segment analytics.js with the project write key.
// The snippet in index.html stubs the analytics object; .load() fetches the real SDK.
const segmentKey = import.meta.env["VITE_SEGMENT_WRITE_KEY"] as string | undefined;
if (segmentKey && window.analytics) {
  window.analytics.load?.(segmentKey);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
