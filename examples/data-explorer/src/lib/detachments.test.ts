import { describe, it, expect } from "vitest";
import { detachments } from "@alpaca-software/40kdc-data";
import {
  resolveAbility,
  resolveDetachment,
  detachmentsForFaction,
} from "./detachments.js";

/**
 * Integration tests against the real embedded dataset (no mocks) — the linked
 * collections are exactly what the UI consumes, so this exercises the real
 * resolution path including the shared-id ambiguity guard.
 */

function find(factionId: string, id: string) {
  const d = detachmentsForFaction(factionId).find((r) => r.raw.id === id);
  if (!d) throw new Error(`detachment ${id} not found in ${factionId}`);
  return d;
}

describe("resolveDetachment", () => {
  it("resolves a detachment's rule, dispositions, enhancements, and stratagems", () => {
    const d = find("adepta-sororitas", "hallowed-martyrs");
    // the-blood-of-martyrs exists in enrichment, so the rule resolves.
    expect(d.rules.map((r) => r.id)).toContain("the-blood-of-martyrs");
    expect(d.dispositions.map((x) => x.id)).toEqual(["priority-assets"]);
    expect(d.dispositions[0].name).toBe("Priority Assets");
    expect(d.enhancements).toHaveLength(4);
    expect(d.stratagems).toHaveLength(6);
  });

  it("handles a detachment with no stratagems", () => {
    const d = find("adepta-sororitas", "sanctified-orators");
    expect(d.stratagems).toHaveLength(0);
    expect(d.enhancements).toHaveLength(1);
  });

  it("does not throw resolving a detachment replicated across chapters", () => {
    // gladius-task-force (and its enhancements/stratagems) is duplicated into
    // every Space Marine chapter; .get() would throw on the ambiguous ids, so
    // resolution must use .getAny() throughout.
    expect(() => detachmentsForFaction("adeptus-astartes")).not.toThrow();
    expect(() => detachmentsForFaction("ultramarines")).not.toThrow();
    const gladius = find("ultramarines", "gladius-task-force");
    expect(gladius.enhancements.length).toBeGreaterThan(0);
    expect(gladius.stratagems.length).toBeGreaterThan(0);
  });

  it("sorts faction detachments by name", () => {
    const names = detachmentsForFaction("adepta-sororitas").map((d) => d.raw.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names.length).toBeGreaterThan(0);
  });
});

describe("resolveAbility", () => {
  it("returns undefined for null/absent/unknown ids", () => {
    expect(resolveAbility(null, "adepta-sororitas")).toBeUndefined();
    expect(resolveAbility(undefined, "adepta-sororitas")).toBeUndefined();
    expect(resolveAbility("", "adepta-sororitas")).toBeUndefined();
    expect(resolveAbility("definitely-not-an-ability-xyz", "adepta-sororitas")).toBeUndefined();
  });

  it("resolves a known ability to name + describer output", () => {
    const r = resolveAbility("the-blood-of-martyrs", "adepta-sororitas");
    expect(r).toBeDefined();
    expect(r!.id).toBe("the-blood-of-martyrs");
    expect(typeof r!.name).toBe("string");
    expect(r!.name.length).toBeGreaterThan(0);
    expect(typeof r!.description).toBe("string"); // may be "" but never throws
  });
});
