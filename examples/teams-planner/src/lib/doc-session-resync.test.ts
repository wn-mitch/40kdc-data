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

function welcome(seq: number, doc: unknown = { teamName: "Start" }): ServerMessage {
  return {
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
  it("resyncs instead of applying a peer op that raced an unacked local op", () => {
    const socket = joinedSocket();
    sendOps(SET_A);
    // The server ordered the peer's op first (seq 1), then ours (seq 2).
    socket.deliver({ t: "op", seq: 1, ops: SET_B, from: "peer" });
    expect(remote).toEqual([]);
    expect(socket.closedWith).toBe(4000);

    // The reconnect's welcome carries the server's order, replacing local state.
    vi.runOnlyPendingTimers();
    const next = FakeSocket.instances.at(-1)!;
    expect(next).not.toBe(socket);
    next.open();
    next.deliver(welcome(2, { teamName: "Mine" }));
    expect(docs.at(-1)).toEqual({ teamName: "Mine" });
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
