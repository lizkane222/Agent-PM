import type { CanvasNode } from "../types.js";
export interface FindNodeFixture {
    root: CanvasNode[];
    id: string;
    expectedId: string | null;
    note?: string;
}
export declare const FIND_NODE_FIXTURES: FindNodeFixture[];
export interface RemoveNodeFixture {
    root: CanvasNode[];
    id: string;
    expectedIds: string[];
    note?: string;
}
export declare const REMOVE_NODE_FIXTURES: RemoveNodeFixture[];
export interface DeepCloneFixture {
    source: CanvasNode;
    offsetRoot: boolean;
    note?: string;
}
export declare const DEEP_CLONE_FIXTURES: DeepCloneFixture[];
export interface RichTextPropsFixture {
    node: CanvasNode;
    /** Always true — marks this fixture as testing the untrusted-HTML invariant. */
    propsHtmlIsUntrusted: true;
    note: string;
}
export declare const RICH_TEXT_PROPS_FIXTURES: RichTextPropsFixture[];
//# sourceMappingURL=canvasTree.fixtures.d.ts.map