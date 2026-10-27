import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording and identities; no rules text.

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanics(text: string, leaves: CompileLeaf[], abilityId?: string): Record<string, any> {
  const result = compileLeaves(leaves, text, abilityId ? { abilityId } : {});
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** Every ability-part in an effect tree, depth-first. */
function parts(node: unknown): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap(parts);
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, any>;
  return [...(record.type === "ability-part" ? [record] : []), ...Object.values(record).flatMap(parts)];
}

describe("a window printed in a later part of a compound ability", () => {
  const PACT: Array<[string, string, Record<string, unknown>]> = [
    ["When this unit uses its Pact", "event", { kind: "used", activity: "dark-pact" }],
    ["this unit can", "optional-use", { who: "this-unit" }],
    ["re-roll Nerve rolls", "reroll", { roll: "leadership", subset: "all", weapon_type: "all" }],
  ];

  it("bounds only its own part: a one-off later part leaves the earlier lasting part unbounded", () => {
    const text = "When this unit uses its Pact, this unit can re-roll Nerve rolls. In your Shooting phase, when this unit has shot, this unit mends 3 wounds.";
    const result = mechanics(text, placed(text, ...PACT,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["when this unit has shot", "event", { kind: "after-shooting" }],
      ["this unit mends 3 wounds", "regain-wounds", { subject: "this-unit", amount: "3" }],
    ));
    // The re-roll is not "until the end of the phase": the phase is the mend's window, not the Pact's.
    expect(result.scope).toEqual({ duration: "permanent" });
    expect(parts(result.effect).filter((part) => part.duration !== undefined)).toEqual([]);
    // The window still gates the later part's effect.
    expect(JSON.stringify(parts(result.effect)[1])).toContain('"phase":"shooting"');
  });

  it("gives a later part with a lasting effect its own window's period", () => {
    const text = "When this unit uses its Pact, this unit can re-roll Nerve rolls. In your Shooting phase, when this unit has shot, add 1 to the Hit roll.";
    const result = mechanics(text, placed(text, ...PACT,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["when this unit has shot", "event", { kind: "after-shooting" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ));
    expect(result.scope).toEqual({ duration: "permanent" });
    const [first, second] = result.effect.steps as Record<string, any>[];
    expect(first).toMatchObject({ type: "ability-part", trigger: { event: "used" } });
    expect(first!.duration).toBeUndefined();
    expect(second).toMatchObject({ type: "ability-part", trigger: { event: "attacks-resolved" }, duration: "phase" });
  });

  it("keeps a window printed before the first effect as the whole ability's period", () => {
    // "That unit" ties the second sentence back, so the record is one part whose first moment holds the window.
    const text = "In your Shooting phase, when this unit has shot, add 1 to the Hit roll. When that unit uses its Pact, that unit mends 3 wounds.";
    const result = mechanics(text, placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["when this unit has shot", "event", { kind: "after-shooting" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["When that unit uses its Pact", "event", { kind: "used", activity: "dark-pact" }],
      ["that unit mends 3 wounds", "regain-wounds", { subject: "this-unit", amount: "3" }],
    ));
    // The window gates both parts, and its period bounds the whole ability.
    expect(result.effect).toMatchObject({ type: "conditional", effect: { type: "sequence" } });
    expect(result.effect.effect.steps).toHaveLength(2);
    expect(result.scope).toEqual({ duration: "phase" });
  });
});

describe("a resource order across a labelled income paragraph", () => {
  const owner = "sample-stance-rule";
  const text = [
    "SAMPLE units from your army have one of two stances (see below):",
    "■ At the start of the battle, your units have Ember until the start of your next Command phase.",
    "■ At the end of your Command phase, if you have fewer than 3SP, your units have Ember until the start of your next Command phase.",
    "■ At the end of your Command phase, if you have 3SP or more, your units have Frost until the start of your next Command phase.",
    "**Ember**",
    "■ Each time a model in this unit makes an attack, add 1 to the Hit roll.",
    "**Frost**",
    "■ Each time a model in this unit makes an attack, add 1 to the Wound roll.",
    "**Tithe**",
    "At the end of each player’s Command phase, you gain 1SP. In your turn, SP gained in this way are always gained before checking which stance units from your army have.",
  ].join("\n");
  const until = "until the start of your next Command phase";
  const grant = (definition: string) => ({ subject: "antecedent", ability_id: owner, definition_id: definition });
  const leaves = () => placed(text,
    ["SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["At the start of the battle", "event", { kind: "battle-started" }],
    ["have Ember", "named-ability-grant", grant("ember")],
    [until, "duration", { endpoint: "start-of-next-command-phase" }],
    ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["if you have fewer than 3SP", "resource", { pool: "sample-pool", at_most: 2 }],
    ["your units have Ember", "named-ability-grant", grant("ember")],
    [until, "duration", { endpoint: "start-of-next-command-phase" }],
    ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
    ["if you have 3SP or more", "resource", { pool: "sample-pool", at_least: 3 }],
    ["your units have Frost", "named-ability-grant", grant("frost")],
    [until, "duration", { endpoint: "start-of-next-command-phase" }],
    ["Ember", "named-ability-definition", { definition_id: "ember", label: "Ember" }],
    ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ["Frost", "named-ability-definition", { definition_id: "frost", label: "Frost" }],
    ["Each time a model in this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
    ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ["Tithe", "named-ability-definition-end", {}],
    ["At the end of each player’s Command phase", "event", { kind: "phase-end", phase: "command", turn: "either" }],
    ["you gain 1SP", "resource-gain", { pool: "sample-pool", amount: 1 }],
    ["In your turn, SP gained in this way are always gained before checking which stance units from your army have", "resource-before-ability-determination", { pool: "sample-pool" }],
  );

  it("orders income before the determination, each grant keeping its own lifetime", () => {
    const list = leaves();
    // "from your army" inside the ordering sentence is that sentence's own wording, nested in its span.
    const ordering = list.at(-1)!;
    const ownerAt = Buffer.from(text, "utf8").indexOf(Buffer.from("from your army", "utf8"), ordering.start_byte);
    const version = currentFamilyVersion("unit-owner");
    list.push({ role: familyRole("unit-owner", version), family_id: "unit-owner", family_version: version,
      parameters: normalizeFingerprintParameters("unit-owner", { owner: "friendly" }, version), start_byte: ownerAt, end_byte: ownerAt + 14, fragment: "RAW_TEXT" });
    const result = mechanics(text, list, owner);
    const grants = parts(result.effect).filter((part) => part.effect?.type === "ability-grant");
    // Three printed lifetimes, one on each grant, and none around the battle-start or phase-end parts.
    expect(grants.map((part) => part.duration)).toEqual(["until-next-command-phase", "until-next-command-phase", "until-next-command-phase"]);
    expect(parts(result.effect).filter((part) => part.duration !== undefined && part.effect?.type !== "ability-grant")).toEqual([]);
    // One phase-end resolution: the income step first, then both thresholds.
    const resolution = parts(result.effect).find((part) => part.trigger?.event === "phase-ended")!;
    const steps = resolution.effect.steps as unknown[];
    expect(steps).toHaveLength(3);
    expect(JSON.stringify(steps[0])).toContain('"resource-gain"');
    expect(JSON.stringify(steps.slice(1))).not.toContain('"resource-gain"');
  });
});
