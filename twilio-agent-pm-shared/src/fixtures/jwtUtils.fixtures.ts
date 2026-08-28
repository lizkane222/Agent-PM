// decodeJwtPayload(token) → Record<string, unknown>
// isTokenExpired(token, nowSecs) → boolean  (clock-injected)

export interface DecodeJwtFixture {
  token: string;
  expectedPayload: Record<string, unknown>;
  note?: string;
}

// Minimal valid JWT structure: header.payload.signature (base64url-encoded)
// Payload: { "user_id": 42, "username": "alice", "email": "alice@twilio.com", "exp": 9999999999 }
const VALID_PAYLOAD_B64 = btoa(
  JSON.stringify({ user_id: 42, username: "alice", email: "alice@twilio.com", exp: 9999999999 })
).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const EXPIRED_PAYLOAD_B64 = btoa(
  JSON.stringify({ user_id: 1, username: "bob", exp: 1 })
).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

export const VALID_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${VALID_PAYLOAD_B64}.sig`;
export const EXPIRED_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${EXPIRED_PAYLOAD_B64}.sig`;
export const MALFORMED_TOKEN = "not.a.jwt.at.all";

export const DECODE_JWT_FIXTURES: DecodeJwtFixture[] = [
  {
    token: VALID_TOKEN,
    expectedPayload: { user_id: 42, username: "alice", email: "alice@twilio.com", exp: 9999999999 },
  },
  {
    token: EXPIRED_TOKEN,
    expectedPayload: { user_id: 1, username: "bob", exp: 1 },
  },
  {
    token: MALFORMED_TOKEN,
    expectedPayload: {},
    note: "malformed token → empty object",
  },
];

export interface IsTokenExpiredFixture {
  token: string;
  nowSecs: number;
  expected: boolean;
  note?: string;
}

export const IS_TOKEN_EXPIRED_FIXTURES: IsTokenExpiredFixture[] = [
  {
    token: VALID_TOKEN,
    nowSecs: 1000000000,
    expected: false,
    note: "exp=9999999999 far in the future",
  },
  {
    token: EXPIRED_TOKEN,
    nowSecs: 1000000000,
    expected: true,
    note: "exp=1 is in the past",
  },
  {
    token: MALFORMED_TOKEN,
    nowSecs: 1000000000,
    expected: true,
    note: "malformed token has no exp → treat as expired",
  },
];
