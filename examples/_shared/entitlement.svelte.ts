/**
 * Entitlement state for the 40kdc example apps (runes + browser glue over
 * entitlement-core.ts). Mirrors shadowboxing's flow: "Connect Patreon"
 * round-trips through keys.alpacasoft.dev and lands the token back in the
 * URL FRAGMENT; access keys redeem to the same token. The token lives in
 * localStorage — per-origin, so each app connects once (a silent redirect
 * for an active patron).
 */
import {
  connectUrl,
  decodeTokenClaims,
  isSharedIdentity,
  parseEntitlementFragment,
  tokenLive,
} from "./entitlement-core";

const KEYS_URL: string =
  (import.meta.env as Record<string, string | undefined>).VITE_KEYS_URL ??
  "https://keys.alpacasoft.dev";

const STORAGE_KEY = "alpacasoft.entitlement";

export const entitlement = $state({
  /** A live (unexpired) token is stored. */
  connected: false,
  /** Token sub for display; null when disconnected. */
  sub: null as string | null,
  /** True when the sub is an access-key identity (shared cloud namespace). */
  shared: false,
  /** Last connect/redeem error, for inline display. */
  error: null as string | null,
});

function syncState(): void {
  const token = storedEntitlement();
  const claims = token ? decodeTokenClaims(token) : null;
  entitlement.connected = token !== null;
  entitlement.sub = claims?.sub ?? null;
  entitlement.shared = claims ? isSharedIdentity(claims.sub) : false;
}

/** The stored token if it is still live, else null (expired tokens are
 *  dropped eagerly so `connected` never lies). */
export function storedEntitlement(): string | null {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    if (tokenLive(token)) return token;
    if (token) localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

/** Kick off the Patreon connect flow (bounces back here with a token). */
export function connectPatreon(): void {
  const ret = window.location.origin + window.location.pathname;
  window.location.href = connectUrl(KEYS_URL, ret);
}

/** Redeem a personally-distributed access key into the same token. */
export async function redeemKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) return false;
  try {
    const res = await fetch(`${KEYS_URL.replace(/\/$/, "")}/auth/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: trimmed }),
    });
    if (!res.ok) {
      entitlement.error =
        res.status === 403
          ? "That access key is not valid or has been revoked."
          : `Key redemption failed (${res.status})`;
      return false;
    }
    const { entitlement: token } = (await res.json()) as { entitlement: string };
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* storage blocked — token lost, user can retry */
    }
    entitlement.error = null;
    syncState();
    return true;
  } catch (e) {
    entitlement.error = e instanceof Error ? e.message : "key redemption failed";
    return false;
  }
}

/** Capture a token delivered in the URL fragment by the OAuth callback.
 *  Call once at app startup, before any gated UI renders. */
export function maybeCaptureEntitlement(): void {
  if (typeof window === "undefined") return;
  const result = parseEntitlementFragment(window.location.hash);
  if (result && "token" in result) {
    try {
      localStorage.setItem(STORAGE_KEY, result.token);
    } catch {
      /* storage blocked — token lost, user can reconnect */
    }
    history.replaceState({}, "", window.location.pathname + window.location.search);
  } else if (result && "error" in result) {
    entitlement.error = "Patreon connect failed — are you an active patron?";
    history.replaceState({}, "", window.location.pathname + window.location.search);
  }
  syncState();
}

/** Drop the stored token (a "sign out" for the patron features). */
export function disconnect(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to drop */
  }
  syncState();
}
