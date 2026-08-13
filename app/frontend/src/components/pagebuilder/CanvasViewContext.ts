import { createContext, useContext } from "react";

const CanvasViewContext = createContext<{ zoom: number }>({ zoom: 1 });

export function useCanvasView() {
  return useContext(CanvasViewContext);
}

export default CanvasViewContext;
