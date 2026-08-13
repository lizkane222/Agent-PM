/**
 * CommentContext — global context for triggering the comment panel.
 *
 * Usage:
 *   1. Wrap app in <CommentProvider> (done in App.tsx)
 *   2. Call openComments(resourceType, resourceId, resourceLabel, anchorX, anchorY)
 *      from any right-click handler
 *   3. Or use the useRightClickComment() helper on any element
 *
 * The floating panel is rendered in a portal so it works on every page.
 */
import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import type { CommentResourceType } from "../../types";
import CommentPanel from "./CommentPanel";

interface CommentTarget {
  resourceType: CommentResourceType;
  resourceId: number;
  resourceLabel: string;
  x: number;
  y: number;
}

interface CommentContextValue {
  openComments: (target: CommentTarget) => void;
  closeComments: () => void;
}

const CommentCtx = createContext<CommentContextValue>({
  openComments: () => {},
  closeComments: () => {},
});

export function useCommentContext() {
  return useContext(CommentCtx);
}

/**
 * Hook that attaches an onContextMenu handler to an element.
 * Returns the ref to attach + the handler.
 */
export function useRightClickComment<T extends HTMLElement>(
  resourceType: CommentResourceType,
  resourceId: number | null,
  resourceLabel = ""
) {
  const { openComments } = useCommentContext();

  const onContextMenu = useCallback(
    (e: React.MouseEvent<T>) => {
      if (!resourceId) return;
      e.preventDefault();
      e.stopPropagation();
      openComments({ resourceType, resourceId, resourceLabel, x: e.clientX, y: e.clientY });
    },
    [openComments, resourceType, resourceId, resourceLabel]
  );

  return { onContextMenu };
}

const PANEL_WIDTH = 370;
const PANEL_HEIGHT = 520;

export function CommentProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<CommentTarget | null>(null);

  const openComments = useCallback((t: CommentTarget) => {
    setTarget(t);
  }, []);

  const closeComments = useCallback(() => {
    setTarget(null);
  }, []);

  // Calculate clamped position so panel stays in viewport
  let panelStyle: React.CSSProperties = {};
  if (target) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x + 8;
    let top = target.y + 8;
    if (left + PANEL_WIDTH > vw - 16) left = target.x - PANEL_WIDTH - 8;
    if (top + PANEL_HEIGHT > vh - 16) top = vh - PANEL_HEIGHT - 16;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    panelStyle = { position: "fixed", left, top, zIndex: 9999 };
  }

  return (
    <CommentCtx.Provider value={{ openComments, closeComments }}>
      {children}
      {target &&
        createPortal(
          <div style={panelStyle}>
            <CommentPanel
              resourceType={target.resourceType}
              resourceId={target.resourceId}
              resourceLabel={target.resourceLabel}
              onClose={closeComments}
            />
          </div>,
          document.body
        )}
    </CommentCtx.Provider>
  );
}
