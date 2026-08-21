import { useDraggable } from "@dnd-kit/core";
import type { CanvasNode } from "./types";
import NodeRenderer from "./NodeRenderer";
import { useCanvasView } from "./CanvasViewContext";

interface Props {
  node: CanvasNode;
  selectedId: string | null;
  multiSelectedIds?: string[];
  onSelect: (id: string, shift: boolean) => void;
  onDelete: (id: string) => void;
  onResizeLive:   (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onResizeCommit: (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onUpdateProps?: (id: string, props: Record<string, unknown>) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  onImportTeamMembers?: (anchorNodeId: string) => void;
  onFetchTimelineMeetings?: (nodeId: string) => void;
  isRoot?: boolean;
  isNested?: boolean;
  depth?: number;
}

export default function DraggableNode({
  node, selectedId, multiSelectedIds = [], onSelect, onDelete, onResizeLive, onResizeCommit, onUpdateProps,
  onContextMenu, onImportTeamMembers, onFetchTimelineMeetings,
  isRoot = false, isNested = false, depth = 0,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `canvas:${node.id}`,
    data: { kind: "canvas", nodeId: node.id, isRoot, isNested },
  });

  const x = (node.props.x as number) ?? 16;
  const y = (node.props.y as number) ?? 16;
  const isMultiSelected = multiSelectedIds.includes(node.id);

  // dnd-kit's translate is screen pixels, but this element sits inside the
  // canvas's scaled transform layer — so applying it raw makes the drag preview
  // travel `zoom`× further than the cursor. Divide it back out.
  const { zoom } = useCanvasView();
  const dragTransform = transform
    ? `translate3d(${transform.x / zoom}px, ${transform.y / zoom}px, 0)`
    : undefined;

  // A Page is a sheet other components sit on, so it must never rise above them.
  // The default `selected ? 10 : 1` would lift it over its own contents the moment
  // it was clicked, which reads as the page swallowing everything on it.
  const isPage = node.type === "Page";
  const zIndex = isPage
    ? (isDragging ? 100 : 0)
    : (isDragging ? 100 : selectedId === node.id ? 10 : 1);

  const style: React.CSSProperties = (isRoot || isNested)
    ? {
        position: "absolute",
        left: x,
        top: y,
        transform: dragTransform,
        opacity: isDragging ? 0.45 : 1,
        zIndex,
        width: node.props.width ? `${node.props.width}px` : undefined,
        minWidth: 40,
        cursor: isDragging ? "grabbing" : "default",
      }
    : {
        transform: dragTransform,
        opacity: isDragging ? 0.45 : 1,
        position: "relative",
        cursor: isDragging ? "grabbing" : "default",
      };

  return (
    <div
      ref={setNodeRef}
      data-node-id={node.id}
      {...listeners}
      {...attributes}
      style={{
        ...style,
        overflow: "visible",
        outline: isMultiSelected && selectedId !== node.id ? `${2 / zoom}px solid #818CF8` : undefined,
        outlineOffset: isMultiSelected && selectedId !== node.id ? `${2 / zoom}px` : undefined,
      }}
      className="group"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id, e.shiftKey);
      }}
      onDoubleClick={(e) => {
        // Let InlineText's own onDoubleClick handler fire; stop it from bubbling further
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(node.id, e);
      }}
    >
      <NodeRenderer
        node={node}
        selectedId={selectedId}
        multiSelectedIds={multiSelectedIds}
        onSelect={(id) => onSelect(id, false)}
        onDelete={onDelete}
        onResizeLive={onResizeLive}
        onResizeCommit={onResizeCommit}
        onUpdateProps={onUpdateProps}
        onImportTeamMembers={onImportTeamMembers}
        onFetchTimelineMeetings={onFetchTimelineMeetings}
        depth={depth}
      />
    </div>
  );
}
