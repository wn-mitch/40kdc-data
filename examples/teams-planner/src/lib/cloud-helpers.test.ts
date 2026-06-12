/**
 * Pure halves of the shared cloud/entitlement plumbing (examples/_shared):
 * token-claim decoding, fragment capture, and shortlink parsing — the bits
 * every app's open-path depends on.
 */
import { describe, expect, it } from "vitest";
import {
  decodeTokenClaims,
  isSharedIdentity,
  parseEntitlementFragment,
  tokenLive,
} from "../../../_shared/entitlement-core";
import { docInviteUrl, parseDocInvite, parseShortlink, shortlinkUrl } from "../../../_shared/sync-api";
import { normalizeNickname } from "../../../_shared/nickname";

function fakeToken(claims: unknown): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${payload}.fake-signature`;
}

describe("decodeTokenClaims / tokenLive", () => {
  it("reads v2 claims without verifying", () => {
    const exp = Date.now() + 86_400_000;
    const claims = decodeTokenClaims(fakeToken({ v: 2, sub: "patron-7", exp }));
    expect(claims).toEqual({ v: 2, sub: "patron-7", exp });
  });

  it("rejects v1, malformed, and garbage tokens", () => {
    expect(decodeTokenClaims(fakeToken({ sub: "old", exp: 1 }))).toBeNull();
    expect(decodeTokenClaims(fakeToken({ v: 3, sub: "future", exp: 1 }))).toBeNull();
    expect(decodeTokenClaims("")).toBeNull();
    expect(decodeTokenClaims("no-dot")).toBeNull();
    expect(decodeTokenClaims("!!!.sig")).toBeNull();
  });

  it("tokenLive applies the clock-skew margin", () => {
    const now = 1_700_000_000_000;
    expect(tokenLive(fakeToken({ v: 2, sub: "a", exp: now + 60_000 }), now)).toBe(true);
    expect(tokenLive(fakeToken({ v: 2, sub: "a", exp: now + 10_000 }), now)).toBe(false);
    expect(tokenLive(fakeToken({ v: 2, sub: "a", exp: now - 1 }), now)).toBe(false);
    expect(tokenLive(null, now)).toBe(false);
  });

  it("flags access-key subs as shared identities", () => {
    expect(isSharedIdentity("key:friend-alice")).toBe(true);
    expect(isSharedIdentity("12345678")).toBe(false);
  });
});

describe("parseEntitlementFragment", () => {
  it("captures tokens and errors, ignores unrelated fragments", () => {
    expect(parseEntitlementFragment("#entitlement=abc.def")).toEqual({ token: "abc.def" });
    expect(parseEntitlementFragment("#foo=1&entitlement=abc.def")).toEqual({ token: "abc.def" });
    expect(parseEntitlementFragment("#entitlement_error=not_a_patron")).toEqual({
      error: "not_a_patron",
    });
    expect(parseEntitlementFragment("#t=some-share-token")).toBeNull();
    expect(parseEntitlementFragment("")).toBeNull();
  });
});

describe("shortlink helpers", () => {
  it("builds and re-parses app URLs, any origin", () => {
    const url = shortlinkUrl("https://list-builder.alpacasoft.dev", "/", "AB2KQ7XM");
    expect(url).toBe("https://list-builder.alpacasoft.dev/?s=AB2KQ7XM");
    expect(parseShortlink(url)).toBe("AB2KQ7XM");
    // The cross-app paste case: shadowboxing accepts a list-builder URL.
    expect(parseShortlink("https://teams-planner.alpacasoft.dev/?s=ab2kq7xm")).toBe("AB2KQ7XM");
  });

  it("accepts bare codes case-insensitively", () => {
    expect(parseShortlink("AB2KQ7XM")).toBe("AB2KQ7XM");
    expect(parseShortlink("  ab2kq7xm ")).toBe("AB2KQ7XM");
  });

  it("rejects wrong length, excluded letters, and URLs without ?s=", () => {
    expect(parseShortlink("ABC")).toBeNull();
    expect(parseShortlink("AB2KQ7XMZ")).toBeNull();
    expect(parseShortlink("AB2KQ7X0")).toBeNull(); // 0 not in alphabet
    expect(parseShortlink("https://example.com/?x=1")).toBeNull();
    expect(parseShortlink("not a url or code")).toBeNull();
  });
});

describe("live doc-link helpers", () => {
  it("builds and re-parses ?d=&token= invites, round-tripping odd ids", () => {
    const url = docInviteUrl(
      "https://teams-planner.alpacasoft.dev",
      "/",
      "0c5cbd06-aaaa-bbbb-cccc-1234567890ab",
      "tok-uuid",
    );
    expect(url).toBe(
      "https://teams-planner.alpacasoft.dev/?d=0c5cbd06-aaaa-bbbb-cccc-1234567890ab&token=tok-uuid",
    );
    expect(parseDocInvite(new URL(url).search)).toEqual({
      docId: "0c5cbd06-aaaa-bbbb-cccc-1234567890ab",
      token: "tok-uuid",
    });
    // Characters that need escaping survive the round trip.
    const odd = docInviteUrl("https://x.dev", "/", "a&b=c", "t/k+");
    expect(parseDocInvite(new URL(odd).search)).toEqual({ docId: "a&b=c", token: "t/k+" });
  });

  it("rejects invites missing either half, ignores unrelated queries", () => {
    expect(parseDocInvite("?d=abc")).toBeNull();
    expect(parseDocInvite("?token=xyz")).toBeNull();
    expect(parseDocInvite("?s=AB2KQ7XM")).toBeNull();
    expect(parseDocInvite("")).toBeNull();
    // A legacy session invite is NOT a doc invite (no ?d=).
    expect(parseDocInvite("?session=AB2KQ7&token=xyz")).toBeNull();
  });
});

describe("normalizeNickname", () => {
  it("trims, caps at 40 chars, and empties whitespace-only input", () => {
    expect(normalizeNickname("  Alice  ")).toBe("Alice");
    expect(normalizeNickname("x".repeat(60))).toHaveLength(40);
    expect(normalizeNickname("   ")).toBe("");
  });
});
