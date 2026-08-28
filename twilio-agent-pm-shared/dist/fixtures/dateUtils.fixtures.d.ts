export interface LocalIsoFixture {
    input: string;
    expectedDate: string;
    expectedTime: string;
    note?: string;
}
export declare const TO_LOCAL_ISO_FIXTURES: LocalIsoFixture[];
export interface AddMsFixture {
    localStr: string;
    ms: number;
    expectedDate: string;
    expectedTime: string;
    note?: string;
}
export declare const ADD_MS_TO_LOCAL_ISO_FIXTURES: AddMsFixture[];
//# sourceMappingURL=dateUtils.fixtures.d.ts.map