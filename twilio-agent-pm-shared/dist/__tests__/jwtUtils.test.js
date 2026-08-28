import { decodeJwtPayload, isTokenExpired } from "../brain/jwtUtils.js";
import { DECODE_JWT_FIXTURES, IS_TOKEN_EXPIRED_FIXTURES, } from "../fixtures/jwtUtils.fixtures.js";
describe("decodeJwtPayload", () => {
    for (const f of DECODE_JWT_FIXTURES) {
        const label = f.note ?? `decodes expected payload`;
        it(label, () => {
            expect(decodeJwtPayload(f.token)).toEqual(f.expectedPayload);
        });
    }
});
describe("isTokenExpired", () => {
    for (const f of IS_TOKEN_EXPIRED_FIXTURES) {
        const label = f.note ?? `nowSecs=${f.nowSecs} → ${f.expected}`;
        it(label, () => {
            expect(isTokenExpired(f.token, f.nowSecs)).toBe(f.expected);
        });
    }
});
//# sourceMappingURL=jwtUtils.test.js.map