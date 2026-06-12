/**
 * Document CRUD through real routes with real Ed25519 tokens: ownership
 * isolation, the 409 conflict hint, quotas, and validation.
 */
import { describe, expect, it } from "vitest";
import { api, mintToken } from "./helpers";

describe("auth gate", () => {
  it("refuses missing, expired, and tampered tokens", async () => {
    expect((await api("/docs")).status).toBe(401);
    const expired = await mintToken("late", Date.now() - 1);
    expect((await api("/docs", { token: expired })).status).toBe(401);
    const good = await mintToken("alice");
    expect((await api("/docs", { token: good + "x" })).status).toBe(401);
    expect((await api("/docs", { token: good })).status).toBe(200);
  });
});

describe("docs CRUD", () => {
  it("create → list (metadata only) → get → update → delete round-trip", async () => {
    const token = await mintToken("alice");
    const plan = { teamName: "Crusaders", size: 5, players: [] };

    const created = await api("/docs", {
      method: "POST",
      token,
      body: { kind: "team-plan", name: "GT prep", payload: plan },
    });
    expect(created.status).toBe(200);
    const { id, updated_at } = created.body;

    const list = await api("/docs?kind=team-plan", { token });
    expect(list.status).toBe(200);
    const entry = list.body.docs.find((d: any) => d.id === id);
    expect(entry.name).toBe("GT prep");
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.payload).toBeUndefined();

    const got = await api(`/docs/${id}`, { token });
    expect(got.body.payload).toEqual(plan);

    const updated = await api(`/docs/${id}`, {
      method: "PUT",
      token,
      body: { payload: { ...plan, size: 8 }, ifUpdatedAt: updated_at },
    });
    expect(updated.status).toBe(200);
    expect((await api(`/docs/${id}`, { token })).body.payload.size).toBe(8);

    expect((await api(`/docs/${id}`, { method: "DELETE", token })).status).toBe(200);
    expect((await api(`/docs/${id}`, { token })).status).toBe(404);
  });

  it("isolates owners: bob cannot read, update, or delete alice's doc", async () => {
    const alice = await mintToken("alice-iso");
    const bob = await mintToken("bob-iso");
    const created = await api("/docs", {
      method: "POST",
      token: alice,
      body: { kind: "list", name: "secret list", payload: { units: [] } },
    });
    const id = created.body.id;

    expect((await api(`/docs/${id}`, { token: bob })).status).toBe(404);
    expect(
      (await api(`/docs/${id}`, { method: "PUT", token: bob, body: { payload: {} } })).status,
    ).toBe(404);
    expect((await api(`/docs/${id}`, { method: "DELETE", token: bob })).status).toBe(404);
    expect((await api("/docs", { token: bob })).body.docs).toHaveLength(0);
    // Alice still has it, intact.
    expect((await api(`/docs/${id}`, { token: alice })).status).toBe(200);
  });

  it("409s a stale ifUpdatedAt with the current state as the prompt hook", async () => {
    const token = await mintToken("conflicted");
    const created = await api("/docs", {
      method: "POST",
      token,
      body: { kind: "list", name: "v1", payload: { v: 1 } },
    });
    const id = created.body.id;

    // Device B writes…
    const second = await api(`/docs/${id}`, {
      method: "PUT",
      token,
      body: { name: "v2", payload: { v: 2 } },
    });
    // …device A, still holding the original updated_at, must get a conflict.
    const conflict = await api(`/docs/${id}`, {
      method: "PUT",
      token,
      body: { payload: { v: 3 }, ifUpdatedAt: created.body.updated_at },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("conflict");
    expect(conflict.body.updated_at).toBe(second.body.updated_at);
    expect(conflict.body.name).toBe("v2");
    // The doc kept device B's write.
    expect((await api(`/docs/${id}`, { token })).body.payload).toEqual({ v: 2 });

    // Without the hint, last write wins (explicit overwrite).
    const force = await api(`/docs/${id}`, { method: "PUT", token, body: { payload: { v: 3 } } });
    expect(force.status).toBe(200);
  });

  it("validates kind, name, and payload size", async () => {
    const token = await mintToken("validator");
    const bad = [
      { kind: "diary", name: "x", payload: {} },
      { kind: "list", name: "", payload: {} },
      { kind: "list", name: "x".repeat(201), payload: {} },
      { kind: "list", name: "x" },
      { kind: "list", name: "big", payload: { blob: "x".repeat(300 * 1024) } },
    ];
    for (const body of bad) {
      expect((await api("/docs", { method: "POST", token, body })).status).toBe(400);
    }
  });

  it("enforces the per-owner doc quota", async () => {
    const token = await mintToken("hoarder");
    // The test env doesn't override MAX_DOCS_PER_OWNER, so the default (100)
    // applies; creating 100 then one more proves the ceiling.
    for (let i = 0; i < 100; i++) {
      const res = await api("/docs", {
        method: "POST",
        token,
        body: { kind: "list", name: `list ${i}`, payload: { i } },
      });
      expect(res.status).toBe(200);
    }
    const over = await api("/docs", {
      method: "POST",
      token,
      body: { kind: "list", name: "one too many", payload: {} },
    });
    expect(over.status).toBe(403);
    expect(over.body.error).toBe("doc_quota_exceeded");
  });
});
