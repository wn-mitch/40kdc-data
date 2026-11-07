/**
 * The fences between a doc-bound room and snapshot PUTs: the D1 lease, the
 * version check on every room write, and the join/teardown races around them.
 */
import { describe, expect, it } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { api } from "./helpers";
import { connectDoc, makeSharedDoc, PLAN, registry, room, wrappedDb } from "./live-helpers";
import type { ServerMessage } from "../src/doc-protocol";

type DbHolder = { env: { DB: D1Database } };

/** Swap the room's D1 binding until `restore` is called. */
async function patchRoomDb(
  id: string,
  before: (sql: string, call: number) => Promise<void> | void,
): Promise<() => Promise<void>> {
  let realDb!: D1Database;
  await runInDurableObject(room(id), (instance) => {
    const self = instance as unknown as DbHolder;
    realDb = self.env.DB;
    self.env = { ...self.env, DB: wrappedDb(realDb, before) };
  });
  return () =>
    runInDurableObject(room(id), (instance) => {
      const self = instance as unknown as DbHolder;
      self.env = { ...self.env, DB: realDb };
    });
}

/** A write that reached the row behind the room's back (a PUT admitted while
 *  the lease had lapsed). */
async function writeBehindRoom(id: string, payload: unknown): Promise<void> {
  await env.DB.prepare(
    "UPDATE documents SET payload = ?, updated_at = updated_at + 5, live_until = NULL WHERE id = ?",
  )
    .bind(JSON.stringify(payload), id)
    .run();
}

async function nextOfType<T extends ServerMessage["t"]>(
  next: () => Promise<ServerMessage>,
  t: T,
): Promise<Extract<ServerMessage, { t: T }>> {
  for (;;) {
    const m = await next();
    if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
  }
}

async function leaseOf(id: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT live_until FROM documents WHERE id = ?")
    .bind(id)
    .first<{ live_until: number | null }>();
  return row?.live_until ?? null;
}

describe("version fence", () => {
  it("a flush never overwrites a write that landed behind the room; the room adopts it", async () => {
    const { token, id, editorToken } = await makeSharedDoc("fence-persist");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Live" }] }));
    await a.next(); // ack — dirty
    const behind = { ...PLAN, teamName: "Saved elsewhere" };
    await writeBehindRoom(id, behind);

    await room(id).persistNow();

    expect((await api(`/docs/${id}`, { token })).body.payload).toEqual(behind);
    const rewelcome = await nextOfType(a.next, "welcome");
    expect(rewelcome.doc).toEqual(behind);
    expect(await leaseOf(id)).toBeGreaterThan(Date.now());
  });

  it("holds ops while the room reloads, so an op sent mid-reload lands on the adopted doc", async () => {
    const { token, id, editorToken } = await makeSharedDoc("fence-hold");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Live" }] }));
    await a.next(); // ack — dirty
    await writeBehindRoom(id, { ...PLAN, teamName: "Saved elsewhere" });

    let claimStarted!: () => void;
    const started = new Promise<void>((r) => (claimStarted = r));
    let releaseClaim!: () => void;
    const gate = new Promise<void>((r) => (releaseClaim = r));
    const restore = await patchRoomDb(id, async (sql) => {
      if (sql.startsWith("UPDATE documents SET live_until")) {
        claimStarted();
        await gate;
      }
    });
    try {
      const flush = room(id).persistNow(); // version mismatch → reconcile
      await started; // the reload's lease claim is in flight
      a.ws.send(JSON.stringify({ t: "op", clientSeq: 2, ops: [{ o: "set", p: ["size"], v: 8 }] }));
      await new Promise((r) => setTimeout(r, 20));
      releaseClaim();
      await flush;
      // The re-welcome comes first; the held op then applies on top of it.
      const first = await a.next();
      expect(first.t).toBe("welcome");
      expect((await a.next()).t).toBe("ack");
    } finally {
      await restore();
    }
    await room(id).persistNow();
    expect((await api(`/docs/${id}`, { token })).body.payload).toMatchObject({
      teamName: "Saved elsewhere",
      size: 8,
    });
  });

  it("an active alarm's lease renewal also detects the write and re-welcomes", async () => {
    const { id, editorToken } = await makeSharedDoc("fence-renew");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome — clean, never dirty
    const behind = { ...PLAN, teamName: "Renamed elsewhere" };
    await writeBehindRoom(id, behind);

    expect(await runDurableObjectAlarm(room(id))).toBe(true);

    expect((await nextOfType(a.next, "welcome")).doc).toEqual(behind);
    expect(await leaseOf(id)).toBeGreaterThan(Date.now());
  });
});

describe("row queue", () => {
  it("a renewal waits for an in-flight flush instead of mistaking it for an outside write", async () => {
    const { token, id, editorToken } = await makeSharedDoc("queue-renew");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Mine" }] }));
    await a.next(); // ack — dirty

    // The flush's UPDATE commits, then its reply is held: the row is already
    // at the new version while the room still knows the old one.
    let flushCommitted!: () => void;
    const committed = new Promise<void>((r) => (flushCommitted = r));
    let releaseFlush!: () => void;
    const gate = new Promise<void>((r) => (releaseFlush = r));
    let realDb!: D1Database;
    let calls = 0;
    await runInDurableObject(room(id), (instance) => {
      const self = instance as unknown as DbHolder;
      realDb = self.env.DB;
      self.env = {
        ...self.env,
        DB: {
          prepare: (sql: string) => ({
            bind: (...args: unknown[]) => {
              const st = realDb.prepare(sql).bind(...args);
              return {
                run: () => st.run(),
                first: async <T,>() => {
                  const out = await st.first<T>();
                  if (calls++ === 0) {
                    flushCommitted();
                    await gate;
                  }
                  return out;
                },
              };
            },
          }),
        } as unknown as D1Database,
      };
    });
    try {
      const flush = room(id).persistNow();
      await committed;
      // An edit lands mid-flush, so the room's doc is now ahead of the row.
      a.ws.send(JSON.stringify({ t: "op", clientSeq: 2, ops: [{ o: "set", p: ["size"], v: 7 }] }));
      expect((await a.next()).t).toBe("ack");
      const alarm = runDurableObjectAlarm(room(id)); // active → renews the lease
      await new Promise((r) => setTimeout(r, 20));
      releaseFlush();
      await flush;
      await alarm;
    } finally {
      await runInDurableObject(room(id), (instance) => {
        (instance as unknown as DbHolder).env = { ...(instance as unknown as DbHolder).env, DB: realDb };
      });
    }
    // No reconcile: the next message is the ack for a new op, not a re-welcome,
    // and the mid-flush edit survives to the next flush.
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 3, ops: [{ o: "set", p: ["teamName"], v: "Mine!" }] }));
    expect((await a.next()).t).toBe("ack");
    await room(id).persistNow();
    expect((await api(`/docs/${id}`, { token })).body.payload).toMatchObject({ teamName: "Mine!", size: 7 });
  });
});

describe("rooms from before version tracking", () => {
  it("a clean legacy room re-reads the row on renewal instead of adopting its version blind", async () => {
    const { id, editorToken } = await makeSharedDoc("legacy-renew");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    await runInDurableObject(room(id), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM meta WHERE k = 'version'");
    });
    const behind = { ...PLAN, teamName: "Saved while unleased" };
    await writeBehindRoom(id, behind);

    expect(await runDurableObjectAlarm(room(id))).toBe(true);
    expect((await nextOfType(a.next, "welcome")).doc).toEqual(behind);
  });
});

describe("lost D1 replies", () => {
  /** Run the statement for real, then fail as if its reply never arrived. */
  function commitThenFail(match: (sql: string) => boolean, times = 1): D1Database {
    const real = env.DB;
    let left = times;
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          const st = real.prepare(sql).bind(...args);
          const maybeFail = async <T,>(out: Promise<T>) => {
            const value = await out;
            if (match(sql) && left-- > 0) throw new Error("reply lost");
            return value;
          };
          return { run: () => maybeFail(st.run()), first: <T,>() => maybeFail(st.first<T>()) };
        },
      }),
    } as unknown as D1Database;
  }

  async function withRoomDb<T>(id: string, db: D1Database, fn: () => Promise<T>): Promise<T> {
    let realDb!: D1Database;
    await runInDurableObject(room(id), (instance) => {
      const self = instance as unknown as DbHolder;
      realDb = self.env.DB;
      self.env = { ...self.env, DB: db };
    });
    try {
      return await fn();
    } finally {
      await runInDurableObject(room(id), (instance) => {
        (instance as unknown as DbHolder).env = { ...(instance as unknown as DbHolder).env, DB: realDb };
      });
    }
  }

  it("recognises its own committed flush and keeps newer edits", async () => {
    const { token, id, editorToken } = await makeSharedDoc("lost-flush");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "First" }] }));
    await a.next(); // ack
    await withRoomDb(id, commitThenFail((sql) => sql.startsWith("UPDATE documents SET payload")), () =>
      expect(room(id).persistNow()).rejects.toThrow(),
    );
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 2, ops: [{ o: "set", p: ["size"], v: 6 }] }));
    expect((await a.next()).t).toBe("ack");

    // The retry fails the version fence against the room's own write.
    await room(id).persistNow();
    await room(id).persistNow();
    expect((await api(`/docs/${id}`, { token })).body.payload).toMatchObject({ teamName: "First", size: 6 });
    // No re-welcome: the next message is the ack for a new op.
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 3, ops: [{ o: "set", p: ["size"], v: 7 }] }));
    expect((await a.next()).t).toBe("ack");
  });

  it("keeps the committed flush's digest through a long run of failing retries", async () => {
    const { token, id, editorToken } = await makeSharedDoc("lost-flush-outage");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    const op = async (clientSeq: number, size: number) => {
      a.ws.send(JSON.stringify({ t: "op", clientSeq, ops: [{ o: "set", p: ["size"], v: size }] }));
      expect((await a.next()).t).toBe("ack");
    };
    await op(1, 100);
    await withRoomDb(id, commitThenFail((sql) => sql.startsWith("UPDATE documents SET payload")), () =>
      expect(room(id).persistNow()).rejects.toThrow(),
    );
    // D1 then stays down while edits keep arriving: each retry is a new state.
    const down = wrappedDb(env.DB, () => {
      throw new Error("D1 unavailable");
    });
    for (let i = 0; i < 12; i++) {
      await op(i + 2, 101 + i);
      await withRoomDb(id, down, () => expect(room(id).persistNow()).rejects.toThrow());
    }
    await room(id).persistNow(); // fence miss → recognised as our own write
    await room(id).persistNow();
    expect((await api(`/docs/${id}`, { token })).body.payload.size).toBe(112);
  });

  it("a definite fence miss is not mistaken for this room's own write", async () => {
    const { id, editorToken } = await makeSharedDoc("fence-miss");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    a.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["size"], v: 3 }] }));
    await a.next(); // ack — dirty
    // An outside write with the same payload the room is about to flush, but
    // a new name: only adopting the row picks up the name.
    const doc = await runInDurableObject(room(id), (_i, state) =>
      state.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'doc'").toArray()[0].v,
    );
    await env.DB.prepare(
      "UPDATE documents SET payload = ?, name = 'Renamed', updated_at = updated_at + 5, live_until = NULL WHERE id = ?",
    )
      .bind(doc, id)
      .run();
    await room(id).persistNow();
    const rewelcome = await nextOfType(a.next, "welcome");
    expect(rewelcome.name).toBe("Renamed");
  });

  it("clears a lease whose claim committed but whose reply was lost", async () => {
    const { token, id, editorToken } = await makeSharedDoc("lost-claim");
    await withRoomDb(id, commitThenFail((sql) => sql.startsWith("UPDATE documents SET live_until = ? WHERE id = ? RETURNING")), async () => {
      const res = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(503);
    });
    expect(await leaseOf(id)).toBeNull();
    expect(await registry().has(`doc:${id}`)).toBe(false);
    expect((await api(`/docs/${id}`, { method: "PUT", token, body: { payload: PLAN } })).status).toBe(200);
  });
});

describe("lease upkeep", () => {
  it("retries a failed renewal on the persist cadence, not a full TTL later", async () => {
    const { id, editorToken } = await makeSharedDoc("lease-retry");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    const restore = await patchRoomDb(id, () => {
      throw new Error("D1 unavailable");
    });
    try {
      const alarmAt = await runInDurableObject(room(id), async (instance, state) => {
        await instance.alarm();
        return state.storage.getAlarm();
      });
      // The test env leaves DOC_PERSIST_SECONDS at 15s; the TTL is 120 min.
      expect(alarmAt).not.toBeNull();
      expect(alarmAt!).toBeLessThan(Date.now() + 60_000);
    } finally {
      await restore();
    }
  });

  it("guards a room that went live before leases existed through its registry slot", async () => {
    const { token, id, editorToken } = await makeSharedDoc("lease-legacy");
    const a = await connectDoc(id, editorToken, "Alice");
    await a.next(); // welcome
    await env.DB.prepare("UPDATE documents SET live_until = NULL WHERE id = ?").bind(id).run();
    const put = await api(`/docs/${id}`, { method: "PUT", token, body: { payload: PLAN } });
    expect(put.status).toBe(409);
    expect(put.body.error).toBe("doc_live");
  });
});

describe("cold-join races", () => {
  it("concurrent cold joins share one bring-live: one lease claim, one initialization", async () => {
    const { id, editorToken } = await makeSharedDoc("join-race");
    let claimStarted!: () => void;
    const started = new Promise<void>((r) => (claimStarted = r));
    let releaseClaim!: () => void;
    const gate = new Promise<void>((r) => (releaseClaim = r));
    let claims = 0;
    const restore = await patchRoomDb(id, async (sql) => {
      if (sql.startsWith("UPDATE documents SET live_until")) {
        if (claims++ === 0) {
          claimStarted();
          await gate;
        }
      }
    });
    try {
      const join = () =>
        SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
          headers: { Upgrade: "websocket" },
        });
      const first = join();
      await started; // the first join is mid-claim
      const second = join();
      await new Promise((r) => setTimeout(r, 20)); // let it reach the room
      releaseClaim();
      expect((await first).status).toBe(101);
      expect((await second).status).toBe(101);
      // A straggler re-claiming and re-initializing is what reset live edits.
      expect(claims).toBe(1);

      const b = await connectDoc(id, editorToken, "Bob");
      await b.next(); // welcome
      b.ws.send(JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "Bob's" }] }));
      await nextOfType(b.next, "ack");
      const c = await connectDoc(id, editorToken, "Cara");
      const welcome = await nextOfType(c.next, "welcome");
      expect(welcome.doc).toMatchObject({ teamName: "Bob's" });
      expect(welcome.seq).toBe(1);
    } finally {
      await restore();
    }
  });

  it("a delete that lands mid-claim tears the room down once the join finishes", async () => {
    const { token, id, editorToken } = await makeSharedDoc("join-delete");
    let claimDone!: () => void;
    const claimed = new Promise<void>((r) => (claimDone = r));
    let releaseClaim!: () => void;
    const gate = new Promise<void>((r) => (releaseClaim = r));
    // Hold the join just AFTER its claim succeeded, before it publishes doc_id.
    let restoreDb!: () => Promise<void>;
    await runInDurableObject(room(id), (instance) => {
      const self = instance as unknown as DbHolder;
      const realDb = self.env.DB;
      self.env = {
        ...self.env,
        DB: {
          prepare: (sql: string) => ({
            bind: (...args: unknown[]) => {
              const st = realDb.prepare(sql).bind(...args);
              return {
                run: () => st.run(),
                first: async <T,>() => {
                  const out = await st.first<T>();
                  if (sql.startsWith("UPDATE documents SET live_until")) {
                    claimDone();
                    await gate;
                  }
                  return out;
                },
              };
            },
          }),
        } as unknown as D1Database,
      };
      restoreDb = () =>
        runInDurableObject(room(id), (i) => {
          (i as unknown as DbHolder).env = { ...(i as unknown as DbHolder).env, DB: realDb };
        });
    });
    try {
      const join = SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
        headers: { Upgrade: "websocket" },
      });
      await claimed;
      expect((await api(`/docs/${id}`, { method: "DELETE", token })).status).toBe(200);
      const torn = room(id).docDeleted();
      await new Promise((r) => setTimeout(r, 20)); // let it reach the room
      releaseClaim();
      await join;
      await torn;
      expect(await registry().has(`doc:${id}`)).toBe(false);
      const rejoin = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(rejoin.status).toBe(404);
    } finally {
      await restoreDb();
    }
  });

  it("releases the registry slot when the lease claim itself fails", async () => {
    const { id, editorToken } = await makeSharedDoc("join-claim-fail");
    const restore = await patchRoomDb(id, (sql) => {
      if (sql.startsWith("UPDATE documents SET live_until")) throw new Error("D1 unavailable");
    });
    try {
      const res = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${editorToken}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(503);
      expect(await registry().has(`doc:${id}`)).toBe(false);
    } finally {
      await restore();
    }
  });
});
