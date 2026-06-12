/**
 * Doc-bound live rooms end-to-end: share-token auth against the D1 row,
 * cold hydration, op flow, persistence back to the doc, the doc_live PUT
 * guard, delete-wins teardown, token rotation, the size cap, and the
 * at-capacity snapshot fallback.
 */
import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { api, mintToken } from "./helpers";
import type { ServerMessage } from "../src/doc-protocol";

const PLAN = { teamName: "Crusaders", size: 5, playersById: {}, playerOrder: [] };

/** Create a cloud doc and mint its share tokens. */
async function makeSharedDoc(sub: string, payload: unknown = PLAN) {
  const token = await mintToken(sub);
  const created = await api("/docs", {
    method: "POST",
    token,
    body: { kind: "team-plan", name: "GT prep", payload },
  });
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  const share = await api(`/docs/${id}/share`, { method: "POST", token });
  expect(share.status).toBe(200);
  return {
    token,
    id,
    createdAt: created.body.updated_at as number,
    editorToken: share.body.editorToken as string,
    viewerToken: share.body.viewerToken as string,
  };
}

/** Connect to a doc-bound room and collect messages; hello sent immediately. */
async function connectDoc(id: string, linkToken: string, nickname: string) {
  const res = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${linkToken}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const queue: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data as string) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  ws.accept();
  ws.send(JSON.stringify({ t: "hello", nickname, lastSeq: 0 }));
  function next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }
  return { ws, next };
}

function room(id: string) {
  return env.DOC_ROOM.get(env.DOC_ROOM.idFromName(`doc:${id}`));
}

function registry() {
  return env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global"));
}

describe("doc-bound joins", () => {
  it("welcomes with the D1 payload, doc name, and the token's role", async () => {
    const { id, editorToken, viewerToken } = await makeSharedDoc("live-join");
    const editor = await connectDoc(id, editorToken, "Alice");
    const welcome = await editor.next();
    if (welcome.t !== "welcome") throw new Error("expected welcome");
    expect(welcome.doc).toEqual(PLAN);
    expect(welcome.name).toBe("GT prep");
    expect(welcome.role).toBe("editor");
    expect(welcome.seq).toBe(0);

    const viewer = await connectDoc(id, viewerToken, "Watcher");
    const viewerWelcome = await viewer.next();
    if (viewerWelcome.t !== "welcome") throw new Error("expected welcome");
    expect(viewerWelcome.role).toBe("viewer");
  });

  it("refuses bad tokens, unshared docs, and unknown ids", async () => {
    const { id } = await makeSharedDoc("live-refuse");
    const bad = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=wrong`, {
      headers: { Upgrade: "websocket" },
    });
    expect(bad.status).toBe(403);

    const owner = await mintToken("live-unshared");
    const created = await api("/docs", {
      method: "POST",
      token: owner,
      body: { kind: "team-plan", name: "private", payload: PLAN },
    });
    const unshared = await SELF.fetch(
      `https://sync.test/docs/${created.body.id}/ws?token=anything`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(unshared.status).toBe(403);

    const unknown = await SELF.fetch(`https://sync.test/docs/no-such-doc/ws?token=x`, {
      headers: { Upgrade: "websocket" },
    });
    expect(unknown.status).toBe(404);
  });

  it("applies ops in order and a late joiner sees them; whole-doc replace works", async () => {
    const { id, editorToken } = await makeSharedDoc("live-ops");
    const a = await connectDoc(id, editorToken, "Alice");
    const welcomeA = await a.next();
    if (welcomeA.t !== "welcome") throw new Error("expected welcome");

    a.ws.send(
      JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Despoilers" }] }),
    );
    expect(await a.next()).toMatchObject({ t: "ack", clientSeq: 1, seq: 1 });

    // Whole-doc replace (the storage→session shape-bridge op the apps send).
    const replaced = { ...PLAN, teamName: "Replaced", size: 8 };
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 2, ops: [{ o: "set", p: [], v: replaced }] }));
    expect(await a.next()).toMatchObject({ t: "ack", clientSeq: 2, seq: 2 });

    const late = await connectDoc(id, editorToken, "Late");
    const welcomeLate = await late.next();
    if (welcomeLate.t !== "welcome") throw new Error("expected welcome");
    expect(welcomeLate.doc).toEqual(replaced);
    expect(welcomeLate.seq).toBe(2);
  });

  it("rejects an op batch that grows the doc past the payload cap", async () => {
    const { id, editorToken } = await makeSharedDoc("live-cap");
    const a = await connectDoc(id, editorToken, "Bigly");
    await a.next(); // welcome
    a.ws.send(
      JSON.stringify({
        t: "op",
        clientSeq: 1,
        ops: [{ o: "set", p: ["teamName"], v: "x".repeat(300 * 1024) }],
      }),
    );
    expect(await a.next()).toMatchObject({ t: "error", code: "doc_too_large" });
    // Doc unchanged for a fresh joiner.
    const fresh = await connectDoc(id, editorToken, "Fresh");
    const welcome = await fresh.next();
    if (welcome.t !== "welcome") throw new Error("expected welcome");
    expect(welcome.seq).toBe(0);
  });
});

describe("persistence back to D1", () => {
  it("a flushed edit shows up in the doc (payload + bumped updated_at)", async () => {
    const { token, id, editorToken, createdAt } = await makeSharedDoc("live-persist");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(
      JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Persisted" }] }),
    );
    await a.next(); // ack

    await room(id).persistNow();

    const got = await api(`/docs/${id}`, { token });
    expect(got.status).toBe(200);
    expect(got.body.payload.teamName).toBe("Persisted");
    expect(got.body.updated_at).toBeGreaterThanOrEqual(createdAt);
  });

  it("refuses snapshot PUTs while live (doc_live), accepts after release", async () => {
    const { token, id, editorToken } = await makeSharedDoc("live-putguard");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome — the room is live now

    const refused = await api(`/docs/${id}`, {
      method: "PUT",
      token,
      body: { payload: { ...PLAN, teamName: "stale snapshot" } },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("doc_live");

    // Simulate the room's slot being released (idle eviction).
    await registry().release(`doc:${id}`);
    const accepted = await api(`/docs/${id}`, {
      method: "PUT",
      token,
      body: { payload: { ...PLAN, teamName: "fresh snapshot" } },
    });
    expect(accepted.status).toBe(200);
  });

  it("delete wins over a live room: sockets close, slot frees, rejoin 404s", async () => {
    const { token, id, editorToken } = await makeSharedDoc("live-delete");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    expect(await registry().has(`doc:${id}`)).toBe(true);

    const closed = new Promise<void>((resolve) => a.ws.addEventListener("close", () => resolve()));
    expect((await api(`/docs/${id}`, { method: "DELETE", token })).status).toBe(200);
    await closed;

    expect(await registry().has(`doc:${id}`)).toBe(false);
    const rejoin = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(rejoin.status).toBe(404);
  });

  it("token regeneration locks out new joins but keeps connected sockets alive", async () => {
    const { token, id, editorToken } = await makeSharedDoc("live-rotate");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome

    const rotated = await api(`/docs/${id}/share`, {
      method: "POST",
      token,
      body: { regenerate: true },
    });
    const stale = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(stale.status).toBe(403);

    const b = await connectDoc(id, rotated.body.editorToken, "Bob");
    const welcomeB = await b.next();
    expect(welcomeB.t).toBe("welcome");

    // The pre-rotation socket still works (rotation isn't a kick).
    a.ws.send(
      JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "still here" }] }),
    );
    // A receives its ack (a presence from B's join may arrive first).
    let msg = await a.next();
    while (msg.t === "presence") msg = await a.next();
    expect(msg).toMatchObject({ t: "ack", clientSeq: 1 });
  });
});

describe("capacity", () => {
  it("refuses a cold join at the session cap; the snapshot route still serves", async () => {
    const { id, editorToken } = await makeSharedDoc("live-capacity");
    // Fill the global registry to its ceiling, remembering what we grabbed.
    const filler: string[] = [];
    try {
      for (let i = 0; i < 100; i++) {
        const code = `CAPF${i}`;
        if (!(await registry().tryAcquire(code))) break;
        filler.push(code);
      }
      const refused = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(refused.status).toBe(503);

      // The link still opens read-only via the anonymous snapshot route.
      const snapshot = await api(`/docs/${id}/shared?token=${editorToken}`);
      expect(snapshot.status).toBe(200);
      expect(snapshot.body.payload).toEqual(PLAN);
    } finally {
      for (const code of filler) await registry().release(code);
    }
  });
});
