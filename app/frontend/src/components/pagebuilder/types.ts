export interface CanvasNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: CanvasNode[];
}

export type PropValue = string | number | boolean;
