import type { AuthUser } from "../types.js";
export declare function decodeJwtPayload(token: string): Record<string, unknown>;
export declare function isTokenExpired(token: string, nowSecs?: number): boolean;
export declare function getCurrentUser(token: string, nowSecs?: number): AuthUser | null;
//# sourceMappingURL=jwtUtils.d.ts.map