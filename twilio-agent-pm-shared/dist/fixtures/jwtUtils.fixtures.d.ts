export interface DecodeJwtFixture {
    token: string;
    expectedPayload: Record<string, unknown>;
    note?: string;
}
export declare const VALID_TOKEN: string;
export declare const EXPIRED_TOKEN: string;
export declare const MALFORMED_TOKEN = "not.a.jwt.at.all";
export declare const DECODE_JWT_FIXTURES: DecodeJwtFixture[];
export interface IsTokenExpiredFixture {
    token: string;
    nowSecs: number;
    expected: boolean;
    note?: string;
}
export declare const IS_TOKEN_EXPIRED_FIXTURES: IsTokenExpiredFixture[];
//# sourceMappingURL=jwtUtils.fixtures.d.ts.map