/**
 * Pure entitlement-token helpers shared by the 40kdc example apps (the
 * browser/runes glue lives in entitlement.svelte.ts; this module is plain TS
 * so it is unit-testable from any app's vitest).
 *
 * Tokens are minted by keys.alpacasoft.dev: `base64url(json).base64url(sig)`
 * with claims `{ v: 2, sub, exp }`. Clients can READ the claims (they're just
 * encoded, not encrypted) for expiry checks and display — only services
 * verify the signature.
 */

export interface EntitlementClaims {
  v: 2;
  /** Patreon user id, or `key:<label>` for access-key redemptions. */
  sub: string;
  /** Epoch ms expiry. */
  exp: number;
}

/** Decode a token's claims WITHOUT verifying (clients can't and don't need
 *  to — services do). Null for anything that doesn't parse to v2 claims. */
export function decodeTokenClaims(token: string): EntitlementClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  try {
    const json = atob(token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as EntitlementClaims;
    if (claims.v !== 2 || typeof claims.sub !== "string" || typeof claims.exp !== "number") {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

/** Is this token present and unexpired (with a small clock-skew margin so a
 *  token doesn't die mid-request)? */
export function tokenLive(token: string | null, nowMs = Date.now()): boolean {
  if (!token) return false;
  const claims = decodeTokenClaims(token);
  return claims !== null && claims.exp > nowMs + 30_000;
}

/** A `key:<label>` sub means everyone holding that access key shares one
 *  cloud namespace — the UI labels it so that isn't a surprise. */
export function isSharedIdentity(sub: string): boolean {
  return sub.startsWith("key:");
}

export function connectUrl(keysUrl: string, returnUrl: string): string {
  return `${keysUrl.replace(/\/$/, "")}/auth/patreon/start?return=${encodeURIComponent(returnUrl)}`;
}

/** Extract `#entitlement=<token>` / `#entitlement_error=<code>` from a URL
 *  fragment (how the OAuth callback delivers them). */
export function parseEntitlementFragment(
  hash: string,
): { token: string } | { error: string } | null {
  const ok = hash.match(/[#&]entitlement=([^&]+)/);
  if (ok) return { token: ok[1] };
  const err = hash.match(/[#&]entitlement_error=([^&]+)/);
  if (err) return { error: err[1] };
  return null;
}
