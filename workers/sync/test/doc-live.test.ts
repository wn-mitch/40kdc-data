/**
 * Doc-bound live rooms end-to-end: share-token auth against the D1 row,
 * cold hydration, op flow, persistence back to the doc, the doc_live PUT
 * guard, delete-wins teardown, token rotation, the size cap, and the
 * at-capacity snapshot fallback.
 */
import { describe, expect, it } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { api, mintToken } from "./helpers";
import { connectDoc, makeSharedDoc, PLAN, registry, room, wrappedDb } from "./live-helpers";

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

  it("keeps an edit that lands while a flush is writing to D1", async () => {
    const { token, id, editorToken } = await makeSharedDoc("live-inflight");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    const op = (clientSeq: number, v: string) =>
      a.ws.send(JSON.stringify({ t: "op", clientSeq, ops: [{ o: "set", p: ["teamName"], v }] }));
    op(1, "First");
    await a.next(); // ack

    // Hold the room's D1 write open so a second op can land mid-flush.
    let writeStarted!: () => void;
    const started = new Promise<void>((r) => (writeStarted = r));
    let releaseWrite!: () => void;
    const gate = new Promise<void>((r) => (releaseWrite = r));
    const flush = runInDurableObject(room(id), async (instance) => {
      const self = instance as unknown as { env: { DB: D1Database } };
      const realDb = self.env.DB;
      self.env = {
        ...self.env,
        DB: wrappedDb(realDb, async () => {
          writeStarted();
          await gate;
        }),
      };
      try {
        await instance.persistNow();
      } finally {
        self.env = { ...self.env, DB: realDb };
      }
    });
    await started;
    op(2, "Second");
    await a.next(); // ack — applied while the first write is in flight
    releaseWrite();
    await flush;

    expect((await api(`/docs/${id}`, { token })).body.payload.teamName).toBe("First");
    await room(id).persistNow();
    expect((await api(`/docs/${id}`, { token })).body.payload.teamName).toBe("Second");
  });

  it("runs overlapping flushes one at a time, so the newest snapshot lands last", async () => {
    const { token, id, editorToken } = await makeSharedDoc("live-overlap");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    const op = (clientSeq: number, v: string) =>
      a.ws.send(JSON.stringify({ t: "op", clientSeq, ops: [{ o: "set", p: ["teamName"], v }] }));
    op(1, "First");
    await a.next(); // ack

    // Gate only the first D1 write; any later write runs straight through.
    let writeStarted!: () => void;
    const started = new Promise<void>((r) => (writeStarted = r));
    let releaseWrite!: () => void;
    const gate = new Promise<void>((r) => (releaseWrite = r));
    let second!: Promise<void>;
    const first = runInDurableObject(room(id), async (instance) => {
      const self = instance as unknown as { env: { DB: D1Database } };
      const realDb = self.env.DB;
      self.env = {
        ...self.env,
        DB: wrappedDb(realDb, async (_sql, call) => {
          if (call === 0) {
            writeStarted();
            await gate;
          }
        }),
      };
      try {
        await instance.persistNow();
        await second;
      } finally {
        self.env = { ...self.env, DB: realDb };
      }
    });
    await started;
    op(2, "Second");
    await a.next(); // ack
    second = runInDurableObject(room(id), (instance) => instance.persistNow());
    // Let the second flush run as far as it can before the first is released.
    await new Promise((r) => setTimeout(r, 20));
    releaseWrite();
    await first;
    expect((await api(`/docs/${id}`, { token })).body.payload.teamName).toBe("Second");
  });

  it("keeps its slot stamped while a dirty eviction flush keeps failing", async () => {
    const { id, editorToken } = await makeSharedDoc("live-outage");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Unsaved" }] }));
    await a.next(); // ack — dirty
    await runInDurableObject(registry(), (_instance, state) => {
      state.storage.sql.exec("UPDATE active SET created_at = 0 WHERE code = ?", `doc:${id}`);
    });
    await runInDurableObject(room(id), async (instance, state) => {
      // Idle past the TTL with D1 down: the eviction flush fails and retries.
      state.storage.sql.exec("UPDATE meta SET v = '0' WHERE k = 'last_activity'");
      const self = instance as unknown as { env: { DB: D1Database } };
      const realDb = self.env.DB;
      self.env = {
        ...self.env,
        DB: wrappedDb(realDb, () => {
          throw new Error("D1 unavailable");
        }),
      };
      try {
        await instance.alarm();
      } finally {
        self.env = { ...self.env, DB: realDb };
      }
    });
    const stamp = await runInDurableObject(registry(), (_instance, state) =>
      state.storage.sql
        .exec<{ created_at: number }>("SELECT created_at FROM active WHERE code = ?", `doc:${id}`)
        .toArray()[0]?.created_at,
    );
    expect(stamp).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a doc-bound room with no edits still re-stamps its slot", async () => {
    const { token, id, viewerToken } = await makeSharedDoc("live-lease");
    const v = await connectDoc(id, viewerToken, "Watcher");
    await v.next(); // welcome — live, never dirty
    await runInDurableObject(registry(), (_instance, state) => {
      state.storage.sql.exec("UPDATE active SET created_at = 0 WHERE code = ?", `doc:${id}`);
    });
    expect(await runDurableObjectAlarm(room(id))).toBe(true);
    const stamp = await runInDurableObject(registry(), (_instance, state) =>
      state.storage.sql
        .exec<{ created_at: number }>("SELECT created_at FROM active WHERE code = ?", `doc:${id}`)
        .toArray()[0]?.created_at,
    );
    expect(stamp).toBeGreaterThan(Date.now() - 60_000);
    // Still live, so snapshot PUTs stay refused.
    const put = await api(`/docs/${id}`, { method: "PUT", token, body: { payload: PLAN } });
    expect(put.body.error).toBe("doc_live");
  });

  it("refuses a PUT while the D1 lease is held, even if the registry has no slot", async () => {
    // The registry check and the write are separate steps; the lease rides in
    // the UPDATE, so a room that went live between them still blocks the PUT.
    const { token, id } = await makeSharedDoc("lease-guard");
    await env.DB.prepare("UPDATE documents SET live_until = ? WHERE id = ?")
      .bind(Date.now() + 60_000, id)
      .run();
    expect(await registry().has(`doc:${id}`)).toBe(false);
    const refused = await api(`/docs/${id}`, { method: "PUT", token, body: { payload: PLAN } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("doc_live");

    // An expired lease (a room that died without clearing it) doesn't block.
    await env.DB.prepare("UPDATE documents SET live_until = ? WHERE id = ?")
      .bind(Date.now() - 1, id)
      .run();
    expect((await api(`/docs/${id}`, { method: "PUT", token, body: { payload: PLAN } })).status).toBe(200);
  });

  it("claims the lease when it goes live and loads the doc through that claim", async () => {
    const { token, id, editorToken } = await makeSharedDoc("lease-claim");
    const before = Date.now();
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    const row = await env.DB.prepare("SELECT live_until FROM documents WHERE id = ?")
      .bind(id)
      .first<{ live_until: number | null }>();
    expect(row?.live_until).toBeGreaterThan(before);
    // The owner's GET never exposes the lease column.
    expect((await api(`/docs/${id}`, { token })).body).not.toHaveProperty("live_until");
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

    // Idle eviction: the room shuts down, releasing its slot and its lease.
    await runInDurableObject(room(id), (_instance, state) => {
      state.storage.sql.exec("UPDATE meta SET v = '0' WHERE k = 'last_activity'");
    });
    expect(await runDurableObjectAlarm(room(id))).toBe(true);
    expect(await registry().has(`doc:${id}`)).toBe(false);
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
