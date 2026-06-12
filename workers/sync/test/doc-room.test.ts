/**
 * Live-session rooms end-to-end through real routes + WebSockets: gated
 * creation, welcome with the full doc, total-ordered ops with acks, late-join
 * exactness, viewer write-drop, bad-batch rejection, reconnect freshness, and
 * capacity caps.
 */
import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { api, mintToken } from "./helpers";
import type { ServerMessage } from "../src/doc-protocol";

const PLAN = { teamName: "Crusaders", size: 5, playersById: {}, playerOrder: [] };

async function createSession(payload: unknown = PLAN) {
  const token = await mintToken("session-creator");
  const res = await api("/session", {
    method: "POST",
    token,
    body: { kind: "team-plan", payload },
  });
  expect(res.status).toBe(200);
  return res.body as { code: string; editorToken: string; viewerToken: string };
}

/** Connect a socket and collect messages; hello is sent immediately. */
async function connect(code: string, token: string, nickname: string, lastSeq = 0) {
  const res = await SELF.fetch(`https://sync.test/session/${code}/ws?token=${token}`, {
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
  ws.send(JSON.stringify({ t: "hello", nickname, lastSeq }));
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

describe("session creation", () => {
  it("requires entitlement and a valid kind/payload", async () => {
    expect(
      (await api("/session", { method: "POST", body: { kind: "team-plan", payload: PLAN } })).status,
    ).toBe(401);
    const token = await mintToken("creator");
    expect(
      (await api("/session", { method: "POST", token, body: { kind: "nope", payload: PLAN } })).status,
    ).toBe(400);
    expect((await api("/session", { method: "POST", token, body: { kind: "list" } })).status).toBe(400);
  });

  it("returns a 6-char code and distinct role tokens", async () => {
    const { code, editorToken, viewerToken } = await createSession();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(editorToken).not.toBe(viewerToken);
    expect(await env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global")).activeCount()).toBeGreaterThanOrEqual(1);
  });

  it("refuses a bad ws token and a malformed code", async () => {
    const { code } = await createSession();
    const bad = await SELF.fetch(`https://sync.test/session/${code}/ws?token=wrong`, {
      headers: { Upgrade: "websocket" },
    });
    expect(bad.status).toBe(403);
    const malformed = await api("/session/NOPE/ws");
    expect(malformed.status).toBe(400);
  });
});

describe("live editing", () => {
  it("welcome carries the exact seeded doc; ops apply in order with acks", async () => {
    const { code, editorToken } = await createSession();
    const a = await connect(code, editorToken, "Alice");
    const welcomeA = await a.next();
    expect(welcomeA.t).toBe("welcome");
    if (welcomeA.t !== "welcome") return;
    expect(welcomeA.doc).toEqual(PLAN);
    expect(welcomeA.seq).toBe(0);
    expect(welcomeA.role).toBe("editor");

    const b = await connect(code, editorToken, "Bob");
    const welcomeB = await b.next();
    if (welcomeB.t !== "welcome") throw new Error("expected welcome");
    // A learns of B via presence.
    const presenceA = await a.next();
    expect(presenceA.t).toBe("presence");

    // A edits; A gets an ack, B gets the ops with the same seq.
    a.ws.send(
      JSON.stringify({
        t: "op",
        clientSeq: 1,
        ops: [{ o: "set", p: ["teamName"], v: "Despoilers" }],
      }),
    );
    const ack = await a.next();
    expect(ack).toMatchObject({ t: "ack", clientSeq: 1, seq: 1 });
    const opAtB = await b.next();
    expect(opAtB).toMatchObject({ t: "op", seq: 1 });
    if (opAtB.t === "op") expect(opAtB.from).toBe(welcomeA.participantId);

    // Late joiner sees the post-edit doc exactly.
    const c = await connect(code, editorToken, "Cara");
    const welcomeC = await c.next();
    if (welcomeC.t !== "welcome") throw new Error("expected welcome");
    expect((welcomeC.doc as any).teamName).toBe("Despoilers");
    expect(welcomeC.seq).toBe(1);
  });

  it("drops viewer writes with an explicit error; doc unchanged", async () => {
    const { code, editorToken, viewerToken } = await createSession();
    const viewer = await connect(code, viewerToken, "Watcher");
    const welcome = await viewer.next();
    if (welcome.t !== "welcome") throw new Error("expected welcome");
    expect(welcome.role).toBe("viewer");

    viewer.ws.send(
      JSON.stringify({ t: "op", clientSeq: 1, ops: [{ o: "set", p: ["teamName"], v: "hax" }] }),
    );
    const err = await viewer.next();
    expect(err).toMatchObject({ t: "error", code: "read_only" });

    const editor = await connect(code, editorToken, "Editor");
    const editorWelcome = await editor.next();
    if (editorWelcome.t !== "welcome") throw new Error("expected welcome");
    expect((editorWelcome.doc as any).teamName).toBe("Crusaders");
    expect(editorWelcome.seq).toBe(0);
  });

  it("rejects an unresolvable batch atomically and the client can hard-resync", async () => {
    const { code, editorToken } = await createSession();
    const a = await connect(code, editorToken, "Alice");
    await a.next(); // welcome

    a.ws.send(
      JSON.stringify({
        t: "op",
        clientSeq: 1,
        ops: [
          { o: "set", p: ["teamName"], v: "Halfway" },
          { o: "set", p: ["playersById", "ghost", "name"], v: "boo" },
        ],
      }),
    );
    const err = await a.next();
    expect(err).toMatchObject({ t: "error", code: "bad_ops" });

    // Hard-resync: a fresh connect gets the untouched doc at seq 0.
    const fresh = await connect(code, editorToken, "Alice-again");
    const welcome = await fresh.next();
    if (welcome.t !== "welcome") throw new Error("expected welcome");
    expect((welcome.doc as any).teamName).toBe("Crusaders");
    expect(welcome.seq).toBe(0);
  });

  it("a second init on a live code is refused (collision can't clobber)", async () => {
    const { code } = await createSession();
    const again = await env.DOC_ROOM.get(env.DOC_ROOM.idFromName(code)).init(code, "team-plan", { other: true });
    expect(again).toBeNull();
  });

  it("broadcasts a nickname change to everyone, sender included", async () => {
    const { code, editorToken } = await createSession();
    const a = await connect(code, editorToken, "Alice");
    await a.next(); // welcome
    const b = await connect(code, editorToken, "guest");
    await b.next(); // welcome
    await a.next(); // presence: B joined

    b.ws.send(JSON.stringify({ t: "nick", nickname: "  Bob the Builder  " }));
    const atA = await a.next();
    const atB = await b.next();
    for (const msg of [atA, atB]) {
      expect(msg.t).toBe("presence");
      if (msg.t !== "presence") continue;
      expect(msg.participants.map((p) => p.nickname)).toContain("Bob the Builder");
      expect(msg.participants.map((p) => p.nickname)).not.toContain("guest");
    }
  });

  it("enforces the editor connection cap", async () => {
    const { code, editorToken } = await createSession();
    // Test env doesn't override MAX_EDITORS (default 10).
    const sockets = [];
    for (let i = 0; i < 10; i++) {
      sockets.push(await connect(code, editorToken, `editor-${i}`));
    }
    const over = await SELF.fetch(`https://sync.test/session/${code}/ws?token=${editorToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(over.status).toBe(503);
  });
});
