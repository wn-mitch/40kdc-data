/** The shared live-session client against a scripted socket: a peer op that
 *  the server ordered before this client's unacked op must trigger a hard
 *  resync, never be replayed on top of the optimistic local state. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocOp, ServerMessage } from "../../../_shared/doc-protocol";
import {
  joinDocSession,
  leaveDocSession,
  registerDocSession,
  sendOps,
} from "../../../_shared/doc-session.svelte";

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | null = null;
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000): void {
    if (this.closedWith !== null) return;
    this.closedWith = code;
    this.readyState = 3;
    this.emit("close", {});
  }
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open", {});
  }
  deliver(msg: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(msg) });
  }
  private emit(type: string, e: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

const SET_A: DocOp[] = [{ o: "set", p: ["teamName"], v: "Mine" }];
const SET_B: DocOp[] = [{ o: "set", p: ["teamName"], v: "Theirs" }];

function welcome(
  seq: number,
  doc: unknown = { teamName: "Start" },
  helloId?: number,
): ServerMessage {
  return {
    ...(helloId !== undefined ? { helloId } : {}),
    t: "welcome",
    participantId: "me",
    role: "editor",
    kind: "team-plan",
    doc,
    seq,
    participants: [],
  };
}

let remote: DocOp[][];
let docs: unknown[];

function joinedSocket(): FakeSocket {
  joinDocSession("ABCDEF", "editor-token", "Tester");
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  socket.deliver(welcome(0));
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  remote = [];
  docs = [];
  registerDocSession({ onDoc: (d) => docs.push(d), onRemoteOps: (ops) => remote.push(ops) });
});

afterEach(() => {
  leaveDocSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("doc-session ordering", () => {
  /** Messages of type `t` this client has sent on `socket`. */
  const sentOf = (socket: FakeSocket, t: string) =>
    socket.sent.filter((m) => (m as { t: string }).t === t);

  /** The id of the latest resync hello sent on `socket`. */
  const lastHelloId = (socket: FakeSocket) =>
    (sentOf(socket, "hello").at(-1) as { id?: number }).id;

  it("resyncs on the same socket instead of applying a peer op that raced an unacked op", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    // The server ordered the peer's op first (seq 1), then ours (seq 2).
    socket.deliver({ t: "op", seq: 1, ops: SET_B, from: "peer" });
    expect(remote).toEqual([]);
    // A second hello, with an id, on the SAME socket: its welcome is ordered
    // after our op.
    expect(socket.closedWith).toBeNull();
    expect(sentOf(socket, "hello")).toHaveLength(2);
    const id = lastHelloId(socket);
    expect(typeof id).toBe("number");

    // Until that welcome: peer ops are already reflected in it, and local
    // edits are queued (sent now, the welcome would omit them).
    socket.deliver({ t: "ack", clientSeq: 1, seq: 2 });
    socket.deliver({ t: "op", seq: 3, ops: SET_B, from: "peer" });
    const QUEUED: DocOp[] = [{ o: "set", p: ["size"], v: 4 }];
    sendOps(QUEUED);
    expect(remote).toEqual([]);
    expect(sentOf(socket, "op")).toHaveLength(1);
    expect(sentOf(socket, "hello")).toHaveLength(2); // one resync at a time

    // The answer replaces local state with the queued edit replayed on top,
    // and the edit is sent now.
    const before = docs.length;
    socket.deliver(welcome(3, { teamName: "Mine" }, id));
    expect(docs.length).toBe(before + 1);
    expect(docs.at(-1)).toEqual({ teamName: "Mine", size: 4 });
    expect(sentOf(socket, "op")).toHaveLength(2);
    expect((sentOf(socket, "op").at(-1) as { ops: DocOp[] }).ops).toEqual(QUEUED);
  });

  it("ignores an unsolicited welcome while its resync hello is pending", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    socket.deliver({ t: "op", seq: 1, ops: SET_B, from: "peer" }); // → resync
    const id = lastHelloId(socket);
    const before = docs.length;
    // The room reloaded its row and re-welcomed everyone (no helloId).
    socket.deliver(welcome(2, { teamName: "Reloaded" }));
    expect(docs.length).toBe(before);
    sendOps(SET_B);
    expect(sentOf(socket, "op")).toHaveLength(1); // still queued, not sent
    socket.deliver({ t: "ack", clientSeq: 1, seq: 3 });
    socket.deliver(welcome(3, { teamName: "Reloaded+Mine" }, id));
    expect(docs.at(-1)).toEqual({ teamName: "Theirs" });
    expect(sentOf(socket, "op")).toHaveLength(2);
  });

  it("drops a queued edit that no longer applies to the welcome", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    socket.deliver({ t: "op", seq: 1, ops: SET_B, from: "peer" }); // → resync
    const id = lastHelloId(socket);
    sendOps([{ o: "set", p: ["gone", "deep"], v: 1 }]); // parent missing in the welcome
    socket.deliver({ t: "ack", clientSeq: 1, seq: 2 });
    socket.deliver(welcome(2, { teamName: "Mine" }, id));
    expect(docs.at(-1)).toEqual({ teamName: "Mine" });
    expect(sentOf(socket, "op")).toHaveLength(1);
  });

  it("carries edits queued during a resync across a dropped connection", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    socket.deliver({ t: "op", seq: 1, ops: SET_B, from: "peer" }); // → resync
    const QUEUED: DocOp[] = [{ o: "set", p: ["size"], v: 4 }];
    sendOps(QUEUED);
    socket.close(1006); // dropped before the answer
    vi.runOnlyPendingTimers();
    const next = FakeSocket.instances.at(-1)!;
    expect(next).not.toBe(socket);
    next.open();
    next.deliver(welcome(2, { teamName: "Mine" }));
    expect(docs.at(-1)).toEqual({ teamName: "Mine", size: 4 });
    expect(sentOf(next, "op").map((m) => (m as { ops: DocOp[] }).ops)).toEqual([QUEUED]);
  });

  it("resyncs on a re-welcome that arrives while local ops are unacked", () => {
    const socket = joinedSocket();
    const adopted = docs.length;
    sendOps(SET_A);
    // The room reloaded its row; our op is still queued behind this welcome.
    socket.deliver(welcome(5, { teamName: "Reloaded" }));
    expect(docs.length).toBe(adopted);
    expect(sentOf(socket, "hello")).toHaveLength(2);
    socket.deliver({ t: "ack", clientSeq: 1, seq: 6 });
    socket.deliver(welcome(6, { teamName: "Reloaded+Mine" }, lastHelloId(socket)));
    expect(docs.at(-1)).toEqual({ teamName: "Reloaded+Mine" });
  });

  it("adopts a re-welcome when nothing is in flight", () => {
    const socket = joinedSocket();
    socket.deliver(welcome(5, { teamName: "Reloaded" }));
    expect(docs.at(-1)).toEqual({ teamName: "Reloaded" });
    expect(sentOf(socket, "hello")).toHaveLength(1);
  });

  it("applies peer ops once every local op is acked", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    socket.deliver({ t: "ack", clientSeq: 1, seq: 1 });
    socket.deliver({ t: "op", seq: 2, ops: SET_B, from: "peer" });
    expect(remote).toEqual([SET_B]);
    expect(socket.closedWith).toBeNull();
  });

  it("does not carry unacked ops across a reconnect", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    socket.close(1006); // dropped before the ack arrived
    vi.runOnlyPendingTimers();
    const next = FakeSocket.instances.at(-1)!;
    next.open();
    next.deliver(welcome(1));
    next.deliver({ t: "op", seq: 2, ops: SET_B, from: "peer" });
    expect(remote).toEqual([SET_B]);
    expect(next.closedWith).toBeNull();
  });
});
