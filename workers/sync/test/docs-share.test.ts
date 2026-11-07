/**
 * Durable share tokens + the anonymous shared-snapshot read: minting is
 * owner-gated and idempotent, regeneration rotates, and the tokens unlock
 * exactly one anonymous read route without ever leaking through the others.
 */
import { describe, expect, it } from "vitest";
import { api, mintToken } from "./helpers";

async function makeDoc(token: string, name = "shared plan"): Promise<string> {
  const created = await api("/docs", {
    method: "POST",
    token,
    body: { kind: "team-plan", name, payload: { teamName: name, size: 5, players: [] } },
  });
  expect(created.status).toBe(200);
  return created.body.id as string;
}

describe("share-token minting", () => {
  it("is owner-gated: anonymous 401, another owner 404", async () => {
    const alice = await mintToken("share-alice");
    const id = await makeDoc(alice);
    expect((await api(`/docs/${id}/share`, { method: "POST" })).status).toBe(401);
    const bob = await mintToken("share-bob");
    expect((await api(`/docs/${id}/share`, { method: "POST", token: bob })).status).toBe(404);
    expect((await api(`/docs/unknown-id/share`, { method: "POST", token: alice })).status).toBe(404);
  });

  it("mints two distinct tokens, idempotently, and regenerate rotates both", async () => {
    const token = await mintToken("share-mint");
    const id = await makeDoc(token);

    const first = await api(`/docs/${id}/share`, { method: "POST", token });
    expect(first.status).toBe(200);
    expect(first.body.editorToken).toBeTruthy();
    expect(first.body.viewerToken).toBeTruthy();
    expect(first.body.editorToken).not.toBe(first.body.viewerToken);

    const again = await api(`/docs/${id}/share`, { method: "POST", token });
    expect(again.body.editorToken).toBe(first.body.editorToken);
    expect(again.body.viewerToken).toBe(first.body.viewerToken);

    const rotated = await api(`/docs/${id}/share`, {
      method: "POST",
      token,
      body: { regenerate: true },
    });
    expect(rotated.body.editorToken).not.toBe(first.body.editorToken);
    expect(rotated.body.viewerToken).not.toBe(first.body.viewerToken);

    // The old tokens stop opening the shared read; the new ones work.
    expect((await api(`/docs/${id}/shared?token=${first.body.editorToken}`)).status).toBe(403);
    expect((await api(`/docs/${id}/shared?token=${rotated.body.editorToken}`)).status).toBe(200);
  });

  it("hands concurrent first shares the same token pair", async () => {
    const token = await mintToken("share-race");
    const id = await makeDoc(token);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => api(`/docs/${id}/share`, { method: "POST", token, body: {} })),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.editorToken).toBe(results[0].body.editorToken);
      expect(r.body.viewerToken).toBe(results[0].body.viewerToken);
    }
    // Every link handed out still opens the doc.
    expect((await api(`/docs/${id}/shared?token=${results[0].body.editorToken}`)).status).toBe(200);
  });

  it("404s sharing an unknown id", async () => {
    const token = await mintToken("share-missing");
    expect((await api(`/docs/no-such-doc/share`, { method: "POST", token })).status).toBe(404);
  });

  it("never leaks tokens through doc reads or listings", async () => {
    const token = await mintToken("share-leak");
    const id = await makeDoc(token);
    await api(`/docs/${id}/share`, { method: "POST", token });

    const got = await api(`/docs/${id}`, { token });
    expect(got.body.editor_token).toBeUndefined();
    expect(got.body.viewer_token).toBeUndefined();

    const list = await api("/docs?kind=team-plan", { token });
    const entry = list.body.docs.find((d: any) => d.id === id);
    expect(entry.editor_token).toBeUndefined();
    expect(entry.viewer_token).toBeUndefined();
    expect(entry.shared).toBe(true);
  });

  it("flags unshared docs as shared: false in the listing", async () => {
    const token = await mintToken("share-flag");
    const id = await makeDoc(token, "never shared");
    const list = await api("/docs", { token });
    const entry = list.body.docs.find((d: any) => d.id === id);
    expect(entry.shared).toBe(false);
  });
});

describe("anonymous shared-snapshot read", () => {
  it("serves the doc to either token with the matching role", async () => {
    const token = await mintToken("share-read");
    const id = await makeDoc(token, "the plan");
    const { body: tokens } = await api(`/docs/${id}/share`, { method: "POST", token });

    const asEditor = await api(`/docs/${id}/shared?token=${tokens.editorToken}`);
    expect(asEditor.status).toBe(200);
    expect(asEditor.body.role).toBe("editor");
    expect(asEditor.body.kind).toBe("team-plan");
    expect(asEditor.body.name).toBe("the plan");
    expect(asEditor.body.payload.teamName).toBe("the plan");
    expect(asEditor.body.updated_at).toBeGreaterThan(0);

    const asViewer = await api(`/docs/${id}/shared?token=${tokens.viewerToken}`);
    expect(asViewer.body.role).toBe("viewer");
  });

  it("refuses wrong tokens, unshared docs, and unknown ids distinctly", async () => {
    const token = await mintToken("share-refuse");
    const id = await makeDoc(token);
    // Unshared: no token can match the NULL columns.
    expect((await api(`/docs/${id}/shared?token=anything`)).status).toBe(403);
    await api(`/docs/${id}/share`, { method: "POST", token });
    expect((await api(`/docs/${id}/shared?token=wrong`)).status).toBe(403);
    expect((await api(`/docs/${id}/shared`)).status).toBe(403);
    expect((await api(`/docs/no-such-doc/shared?token=x`)).status).toBe(404);
  });
});
