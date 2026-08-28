export interface ResourceLabelFixture {
    url: string;
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    expectedLabel: string | null;
    note?: string;
}
export declare const RESOURCE_LABEL_FIXTURES: ResourceLabelFixture[];
//# sourceMappingURL=resourceLabelMatcher.fixtures.d.ts.map