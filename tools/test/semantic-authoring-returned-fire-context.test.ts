import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

type Item = [string, Record<string, unknown>];
function compile(items: Item[]) {
  const leaves: CompileLeaf[] = items.map(([family, parameters], index) => {
    const version = currentFamilyVersion(family);
    return { family_id: family, family_version: version, role: familyRole(family, version),
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: index * 10,
      end_byte: index * 10 + 5, fragment: "RAW_TEXT" };
  });
  return compileLeaves(leaves);
}
const permission: Item = ["eligibility-permission", { subject: "this-model", activity: "shoot", allow: true, as_if: "shooting-phase" }];
const context: Item = ["attack", { refers: "earlier-permission" }];
const penalty: Item = ["characteristic-modifier", { subject: "attack", characteristics: ["BS"], operation: "worsen", value: 1, weapon_type: "all" }];
function nodes(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Record<string, any>, ...Object.values(value).flatMap(nodes)];
}

describe("returned attacks bind their permission", () => {
  it("keeps the permission, BS penalty and exact enemy target in one resolution", () => {
    const result = compile([permission, context, penalty,
      ["targeting-restriction", { by: "this-model", target: "event-subject", kind: "shoot", may: "must-target", weapon_type: "ranged" }]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = nodes(result.mechanics.effect);
    const resolution = tree.find((node) => node.type === "ability-part" && node.duration === "resolution");
    expect(resolution).toBeDefined();
    const scoped = nodes(resolution);
    expect(scoped.find((node) => node.type === "permission")).toMatchObject({ target: "this-model", modifier: { activity: "shoot", as_if: "shooting-phase" } });
    expect(scoped.find((node) => node.type === "stat-modifier")).toMatchObject({ target: "this-model", modifier: { stat: "BS", operation: "worsen", value: 1 } });
    expect(scoped.find((node) => node.type === "attack-is")).toMatchObject({ parameters: { attack_type: "ranged" } });
    expect(scoped.find((node) => node.type === "targeting")).toMatchObject({ modifier: { target: "event-subject", kind: "shoot" } });
    expect(tree.some((node) => node.duration === "after-resolving")).toBe(false);
  });

  it.each([
    [context, penalty],
    [permission, permission, context, penalty],
    [["eligibility-permission", { subject: "this-model", activity: "shoot", allow: false }] as Item, context, penalty],
    [permission, ["attack", { refers: "earlier-permission", attack_type: "melee" }] as Item, penalty],
  ])("refuses an absent, ambiguous, forbidden or contradictory attack permission", (...items) => {
    expect(compile(items).ok).toBe(false);
  });

  it("does not reinterpret previously trusted attack references", () => {
    expect(normalizeFingerprintParameters("attack", { refers: "earlier-attack" }, 8)).toEqual({ refers: "earlier-attack" });
  });

  it("binds battle-start Bodyguard membership to the attached unit", () => {
    const result = compile([
      ["leading-unit", { subject: "this-unit", attachment: "any" }],
      ["event", { kind: "battle-started" }],
      ["duration", { endpoint: "end-of-battle" }],
      ["characteristic-modifier", { subject: "antecedent", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
      ["unit-filter", { side: "friendly", level: "model", member_of: "antecedent", attachment_role: "bodyguard" }],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.trigger).toMatchObject({ event: "battle-started", condition: { type: "attachment" } });
    expect(result.mechanics.scope).toMatchObject({ duration: "battle" });
    expect(result.mechanics.effect).toMatchObject({
      type: "for-each-unit",
      selector: { filter: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } },
    });
    expect((result.mechanics.effect.selector as Record<string, unknown>).count).toBeUndefined();
    expect(nodes(result.mechanics.effect).find((node) => node.type === "stat-modifier")).toMatchObject({
      target: "recipient",
      modifier: { weapons: { type: "melee" }, stat: "S", value: 1 },
    });
  });

  it("does not leak a selection from one menu option into another option's aura", () => {
    const result = compile([
      ["turn-start", { turn: "battle-round" }],
      ["choice-open", { min_choices: 1, max_choices: 1 }],
      ["named-option", { label: "First option" }],
      ["select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["weapon-ability-grant", { subject: "antecedent", keyword: "Hazardous", weapon_type: "ranged" }],
      ["named-option", { label: "Second option" }],
      ["aura-range", { side: "friendly", inches: 6 }],
      ["characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 1 }],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.trigger).toMatchObject({ event: "round-started" });
    const tree = nodes(result.mechanics.effect);
    const aura = tree.find((node) => node.type === "aura");
    expect(aura).toBeDefined();
    expect(nodes(aura).find((node) => node.type === "stat-modifier")?.target).toBe("recipient");
    expect(tree.find((node) => node.type === "select-units")).toBeDefined();
  });
});
