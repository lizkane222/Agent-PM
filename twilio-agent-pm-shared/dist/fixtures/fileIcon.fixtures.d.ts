export interface FileIconFixture {
    mime: string;
    name: string;
    expected: string;
}
export declare const FILE_ICON_FIXTURES: FileIconFixture[];
export interface AttachLinkIconFixture {
    url: string;
    expected: string;
}
export declare const ATTACH_LINK_ICON_FIXTURES: AttachLinkIconFixture[];
export interface FmtBytesFixture {
    bytes: number | null;
    expected: string;
}
export declare const FMT_BYTES_FIXTURES: FmtBytesFixture[];
export interface FmtTimeFixture {
    seconds: number;
    expected: string;
}
export declare const FMT_TIME_FIXTURES: FmtTimeFixture[];
export interface FormatArrFixture {
    input: string | null;
    expected: string;
}
export declare const FORMAT_ARR_FIXTURES: FormatArrFixture[];
//# sourceMappingURL=fileIcon.fixtures.d.ts.map