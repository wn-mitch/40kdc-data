/**
 * Entitlement verification — tokens are minted only by keys.alpacasoft.dev
 * (Ed25519 envelopes `base64url(json).base64url(sig)`, claims {v:2, sub, exp});
 * this worker verifies against the raw public key(s) pinned in
 * ENTITLEMENT_PUBLIC_KEYS (comma-separated base64url; a list so rotation is
 * add-new / flip-signer / remove-old).
 *
 * A near-copy of shadowboxing's session-worker verifier, minus that worker's
 * legacy-HMAC transition path (this worker never minted HMAC tokens). Two
 * repos share this by duplication on purpose — extract a package only if a
 * third consumer appears.
 *
 * Unlike the session gate (a pure cost lever, open when unconfigured), the
 * sync routes need an OWNER identity from the token — so an unconfigured
 * worker refuses authenticated routes (501) instead of opening them.
 * DEV_ALLOW_ALL=true (dev/tests, NEVER production) accepts any bearer and
 * uses it as the owner, so local dev can simulate multiple users.
 */

export interface VerifyEntitlementEnv {
  DEV_ALLOW_ALL?: string;
  /** Comma-separated raw Ed25519 public keys (base64url), pinned at deploy. */
  ENTITLEMENT_PUBLIC_KEYS?: string;
}

export interface EntitlementClaims {
  v: 2;
  /** Patreon user id, or `key:<label>` (attribution + doc-namespace key). */
  sub: string;
  /** Epoch ms expiry. */
  exp: number;
}

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** Verify an Ed25519 entitlement token against the pinned public keys.
 *  Null for anything invalid: bad shape, bad signature, wrong version, expired. */
export async function verifyEd25519Token(
  publicKeysCsv: string,
  token: string,
): Promise<EntitlementClaims | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  let sig: Uint8Array;
  try {
    sig = b64urlToBytes(token.slice(dot + 1));
  } catch {
    return null;
  }

  let verified = false;
  for (const raw of publicKeysCsv.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const key = await crypto.subtle.importKey("raw", b64urlToBytes(trimmed), { name: "Ed25519" }, false, [
        "verify",
      ]);
      if (await crypto.subtle.verify("Ed25519", key, sig, enc.encode(payload))) {
        verified = true;
        break;
      }
    } catch {
      // Malformed pinned key — try the next one.
    }
  }
  if (!verified) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as EntitlementClaims;
    if (claims.v !== 2 || typeof claims.sub !== "string" || typeof claims.exp !== "number") {
      return null;
    }
    return claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

export type AuthResult =
  | { ok: true; owner: string }
  | { ok: false; status: 401 | 501 };

/** Resolve the request's owner identity from its bearer token. */
export async function authenticate(request: Request, env: VerifyEntitlementEnv): Promise<AuthResult> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (env.DEV_ALLOW_ALL === "true") {
    // Dev/test bypass: the bearer string itself is the owner.
    return token ? { ok: true, owner: `dev:${token}` } : { ok: false, status: 401 };
  }
  if (!env.ENTITLEMENT_PUBLIC_KEYS) {
    // No pinned key = nothing can authenticate; refuse rather than open.
    return { ok: false, status: 501 };
  }
  if (!token) return { ok: false, status: 401 };
  const claims = await verifyEd25519Token(env.ENTITLEMENT_PUBLIC_KEYS, token);
  return claims ? { ok: true, owner: claims.sub } : { ok: false, status: 401 };
}
