import { createContext, useContext } from "react";

/**
 * Current canvas zoom, for descendants that live *inside* the scaled transform
 * layer but must not visually scale with it — resize handles, drag previews,
 * hairline guides. They divide their fixed pixel sizes by `zoom`.
 *
 * Defaults to 1 so anything rendered outside a provider (tests, the orphaned
 * mini-canvas paths) behaves exactly as it did before zoom existed.
 */
const CanvasViewContext = createContext<{ zoom: number }>({ zoom: 1 });

export function useCanvasView() {
  return useContext(CanvasViewContext);
}

export default CanvasViewContext;
