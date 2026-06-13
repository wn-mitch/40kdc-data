/** Saved ⇄ session-doc mapping: round-trips, side-disjoint minimal diffs, the
 *  shape bridge, and convergence of the diff→apply loop the live session runs. */
import { describe, expect, it } from "vitest";
import { emptyPlayerGame } from "@alpaca-software/40kdc-data";
import { applyDocOps } from "../../../_shared/doc-protocol";
import {
  diffSessionDocs,
  fromCloudPayload,
  isSessionShaped,
  savedToSessionDoc,
  sessionDocToSaved,
  toSnapshotPayload,
} from "./session-doc.js";
import type { Saved } from "./save.js";

function sampleSaved(): Saved {
  return {
    dispYou: "take-and-hold",
    dispOpp: "purge-the-foe",
    round: 3,
    gameYou: { ...emptyPlayerGame("tactical"), handIds: ["a"], rounds: emptyPlayerGame().rounds.map((c, i) => (i === 0 ? { primary: 10, secondary: 5 } : c)) },
    gameOpp: emptyPlayerGame("fixed"),
    activeYou: "a",
    activeOpp: null,
    discardsYou: ["b"],
    discardsOpp: [],
    primaryTicksYou: { 1: { on: { 0: true }, counts: { 0: 2 } } },
    primaryTicksOpp: {},
    keystoneFacing: false,
    autoCollapse: false,
    verbose: true,
    cpYou: 4,
    cpOpp: 2,
    // Cloud-binding fields must NOT survive the session round-trip.
    cloudDocId: "doc-123",
    cloudName: "My game",
  };
}

describe("savedToSessionDoc / sessionDocToSaved", () => {
  it("round-trips the shared game state (dropping cloud-binding fields)", () => {
    const saved = sampleSaved();
    const restored = sessionDocToSaved(savedToSessionDoc(saved));
    // Cloud binding is intentionally local-only.
    expect(restored.cloudDocId).toBeUndefined();
    expect(restored.cloudName).toBeUndefined();
    // Everything else survives.
    const { cloudDocId: _a, cloudName: _b, ...shared } = saved;
    expect(restored).toEqual(shared);
  });

  it("keys mutable state under sides.you / sides.opp", () => {
    const doc = savedToSessionDoc(sampleSaved());
    expect(doc.sides.you.cp).toBe(4);
    expect(doc.sides.opp.cp).toBe(2);
    expect(doc.sides.you.active).toBe("a");
    expect(doc.sides.you.primaryTicks[1].on[0]).toBe(true);
  });
});

describe("isSessionShaped / fromCloudPayload / toSnapshotPayload", () => {
  it("detects the side-keyed shape and bridges it back to Saved", () => {
    const doc = savedToSessionDoc(sampleSaved());
    expect(isSessionShaped(doc)).toBe(true);
    expect(isSessionShaped(sampleSaved())).toBe(false);
    expect(isSessionShaped(null)).toBe(false);
    expect(isSessionShaped({ sides: {} })).toBe(false);

    // A session-shaped payload is lowered; a storage-shaped one passes through.
    expect((fromCloudPayload(doc) as Saved).cpYou).toBe(4);
    const storage = sampleSaved();
    expect(fromCloudPayload(storage)).toBe(storage);
    expect(toSnapshotPayload(doc)).toEqual(fromCloudPayload(doc));
  });
});

describe("diffSessionDocs", () => {
  it("emits nothing when unchanged", () => {
    const doc = savedToSessionDoc(sampleSaved());
    expect(diffSessionDocs(doc, structuredClone(doc))).toEqual([]);
  });

  it("touches only the side that changed (disjoint paths)", () => {
    const prev = savedToSessionDoc(sampleSaved());
    const next = structuredClone(prev);
    next.sides.you.cp = 5;
    const ops = diffSessionDocs(prev, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ o: "set", p: ["sides", "you"] });
  });

  it("sets a scalar path for a shared-field change", () => {
    const prev = savedToSessionDoc(sampleSaved());
    const next = structuredClone(prev);
    next.round = 4;
    expect(diffSessionDocs(prev, next)).toEqual([{ o: "set", p: ["round"], v: 4 }]);
  });

  it("diff → applyDocOps converges (the live loop)", () => {
    const prev = savedToSessionDoc(sampleSaved());
    const next = structuredClone(prev);
    next.round = 5;
    next.sides.opp.cp = 9;
    next.sides.you.active = null;
    const ops = diffSessionDocs(prev, next);
    expect(applyDocOps(prev, ops)).toEqual(next);
  });
});
