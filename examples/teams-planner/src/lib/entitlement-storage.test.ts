/** Where the shared entitlement client keeps the owner's bearer token: this
 *  tab's sessionStorage only, with any copy an older build persisted to
 *  localStorage moved out on first read. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnect,
  maybeCaptureEntitlement,
  redeemKey,
  storedEntitlement,
} from "../../../_shared/entitlement.svelte";

const KEY = "alpacasoft.entitlement";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** A client-decodable token (claims are only base64url; see entitlement-core). */
function liveToken(sub: string): string {
  const claims = { v: 2, sub, exp: Date.now() + 3_600_000 };
  const b64 = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}.sig`;
}

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("entitlement token storage", () => {
  it("keeps a redeemed key's token in sessionStorage, never localStorage", async () => {
    const token = liveToken("key:alice");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ entitlement: token }), { status: 200 })),
    );
    expect(await redeemKey("ABC-123")).toBe(true);
    expect(session.getItem(KEY)).toBe(token);
    expect(local.getItem(KEY)).toBeNull();
    expect(storedEntitlement()).toBe(token);
  });

  it("keeps an OAuth fragment token in sessionStorage", () => {
    const token = liveToken("patreon:bob");
    vi.stubGlobal("window", { location: { hash: `#entitlement=${token}`, pathname: "/", search: "" } });
    vi.stubGlobal("history", { replaceState: vi.fn() });
    maybeCaptureEntitlement();
    expect(session.getItem(KEY)).toBe(token);
    expect(local.getItem(KEY)).toBeNull();
  });

  it("moves a legacy localStorage token into the session and deletes the persisted copy", () => {
    const token = liveToken("patreon:carol");
    local.setItem(KEY, token);
    expect(storedEntitlement()).toBe(token);
    expect(local.getItem(KEY)).toBeNull();
    expect(session.getItem(KEY)).toBe(token);
  });

  it("disconnect clears both stores", () => {
    session.setItem(KEY, liveToken("a"));
    local.setItem(KEY, liveToken("b"));
    disconnect();
    expect(session.getItem(KEY)).toBeNull();
    expect(local.getItem(KEY)).toBeNull();
  });
});
