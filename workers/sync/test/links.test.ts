/**
 * Shortlinks: gated minting, free anonymous resolution, code normalization,
 * and quota.
 */
import { describe, expect, it } from "vitest";
import { api, mintToken } from "./helpers";

describe("shortlinks", () => {
  it("mints gated, resolves free (no token), case-insensitive", async () => {
    const token = await mintToken("sharer");
    const roster = { faction: "world-eaters", units: ["khorne-berzerkers"] };
    const minted = await api("/links", {
      method: "POST",
      token,
      body: { kind: "list", payload: roster },
    });
    expect(minted.status).toBe(200);
    const code: string = minted.body.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    // Anonymous resolve — the whole point of a shortlink.
    const resolved = await api(`/links/${code}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.kind).toBe("list");
    expect(resolved.body.payload).toEqual(roster);

    // Pasted lowercase still hits.
    expect((await api(`/links/${code.toLowerCase()}`)).status).toBe(200);
  });

  it("refuses minting without entitlement", async () => {
    const res = await api("/links", { method: "POST", body: { kind: "list", payload: {} } });
    expect(res.status).toBe(401);
  });

  it("404s unknown codes and 400s malformed ones", async () => {
    expect((await api("/links/AAAAAAAA")).status).toBe(404);
    for (const bad of ["short", "toolongcode", "AAAA-AAA", "AAAAAAA0"]) {
      expect((await api(`/links/${bad}`)).status).toBe(400);
    }
  });

  it("validates kind and payload size", async () => {
    const token = await mintToken("link-validator");
    expect(
      (await api("/links", { method: "POST", token, body: { kind: "nope", payload: {} } })).status,
    ).toBe(400);
    expect(
      (
        await api("/links", {
          method: "POST",
          token,
          body: { kind: "list", payload: { blob: "x".repeat(300 * 1024) } },
        })
      ).status,
    ).toBe(400);
  });

  it("enforces the per-owner link quota", async () => {
    const token = await mintToken("link-hoarder");
    for (let i = 0; i < 200; i++) {
      expect(
        (await api("/links", { method: "POST", token, body: { kind: "list", payload: { i } } }))
          .status,
      ).toBe(200);
    }
    const over = await api("/links", { method: "POST", token, body: { kind: "list", payload: {} } });
    expect(over.status).toBe(403);
    expect(over.body.error).toBe("link_quota_exceeded");
  });
});
