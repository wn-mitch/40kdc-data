/** Pure DocOp application: the convergence-critical core, shared verbatim by
 *  server (authoritative) and clients (optimistic). */
import { describe, expect, it } from "vitest";
import { applyDocOps, OpError } from "../src/apply-ops";
import type { DocOp } from "../src/doc-protocol";

const base = () => ({
  teamName: "Crusaders",
  size: 5,
  playersById: {
    p1: { id: "p1", name: "Alice", armies: ["a1"] },
    p2: { id: "p2", name: "Bob", armies: [] },
  },
  playerOrder: ["p1", "p2"],
});

describe("applyDocOps", () => {
  it("sets at object paths and never mutates the input", () => {
    const doc = base();
    const next = applyDocOps(doc, [{ o: "set", p: ["teamName"], v: "Despoilers" }]) as any;
    expect(next.teamName).toBe("Despoilers");
    expect(doc.teamName).toBe("Crusaders");
    // Untouched subtrees keep identity (structural sharing).
    expect(next.playersById).toBe(doc.playersById);
  });

  it("sets nested paths and array indices", () => {
    const next = applyDocOps(base(), [
      { o: "set", p: ["playersById", "p1", "name"], v: "Alicia" },
      { o: "set", p: ["playerOrder", 1], v: "p2-renamed" },
    ]) as any;
    expect(next.playersById.p1.name).toBe("Alicia");
    expect(next.playerOrder[1]).toBe("p2-renamed");
  });

  it("deletes keys and splices arrays", () => {
    const next = applyDocOps(base(), [
      { o: "del", p: ["playersById", "p2"] },
      { o: "splice", p: ["playerOrder"], i: 1, d: 1, ins: [] },
    ]) as any;
    expect(next.playersById.p2).toBeUndefined();
    expect(next.playerOrder).toEqual(["p1"]);
  });

  it("supports whole-doc replacement via an empty set path", () => {
    expect(applyDocOps(base(), [{ o: "set", p: [], v: { fresh: true } }])).toEqual({ fresh: true });
  });

  it("rejects unresolvable paths without partial application", () => {
    const doc = base();
    const batch: DocOp[] = [
      { o: "set", p: ["teamName"], v: "Halfway" },
      { o: "set", p: ["playersById", "ghost", "name"], v: "boo" },
    ];
    expect(() => applyDocOps(doc, batch)).toThrow(OpError);
    expect(doc.teamName).toBe("Crusaders");
  });

  it("rejects structural abuse: deep paths, big batches, proto pollution, root delete", () => {
    expect(() =>
      applyDocOps({}, [{ o: "set", p: Array(20).fill("a"), v: 1 }]),
    ).toThrow(OpError);
    expect(() =>
      applyDocOps({}, Array.from({ length: 65 }, () => ({ o: "set", p: ["x"], v: 1 }) as DocOp)),
    ).toThrow(OpError);
    expect(() => applyDocOps({}, [{ o: "set", p: ["__proto__", "polluted"], v: 1 }])).toThrow(OpError);
    expect(() => applyDocOps({}, [{ o: "del", p: [] }])).toThrow(OpError);
    expect(() => applyDocOps([], [{ o: "splice", p: [], i: 5, d: 0, ins: [] }])).toThrow(OpError);
  });

  it("rejects a set with no value at the root or nested, leaving the doc intact", () => {
    const doc = { teamName: "Crusaders" };
    const noValue = (p: string[]) => ({ o: "set", p }) as unknown as DocOp;
    expect(() => applyDocOps(doc, [noValue([])])).toThrow(OpError);
    expect(() => applyDocOps(doc, [noValue(["teamName"])])).toThrow(OpError);
    expect(doc).toEqual({ teamName: "Crusaders" });
    // null is a real JSON value and still sets.
    expect(applyDocOps(doc, [{ o: "set", p: ["teamName"], v: null }])).toEqual({ teamName: null });
  });
});
