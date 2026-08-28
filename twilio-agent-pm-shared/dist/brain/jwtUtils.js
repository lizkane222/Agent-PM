export function decodeJwtPayload(token) {
    try {
        const base64 = token.split(".")[1];
        if (!base64)
            return {};
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
        return JSON.parse(typeof Buffer !== "undefined"
            ? Buffer.from(padded, "base64").toString("utf8")
            : atob(padded));
    }
    catch {
        return {};
    }
}
// `nowSecs` is injected so this function is deterministic in tests.
export function isTokenExpired(token, nowSecs = Date.now() / 1000) {
    const payload = decodeJwtPayload(token);
    const exp = payload["exp"];
    if (typeof exp !== "number")
        return true;
    return nowSecs > exp;
}
export function getCurrentUser(token, nowSecs) {
    if (!token || isTokenExpired(token, nowSecs))
        return null;
    const payload = decodeJwtPayload(token);
    return {
        id: payload["user_id"],
        username: payload["username"],
        email: payload["email"] ?? "",
    };
}
//# sourceMappingURL=jwtUtils.js.map