import { describe, expect, it } from "vitest";
import { Dataset, emptyRawData, type RecipientSnapshot } from "../src/data/index.js";
import { resolveBuffs, type BuffSource, type EngineContext } from "../src/cruncher/index.js";
import type { Trigger, UnitSelector } from "../src/generated.js";

const trigger: Trigger = { event: "battle-started", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } } };
const selector: UnitSelector = { filter: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } };
const source = { kind: "ability", abilityId: "snapshot-example", abilityKind: "attached", sourceUnitId: "source" } as const;
const effect = { type: "for-each-unit", selector, effect: { type: "sequence", steps: [
  { type: "stat-modifier", target: "recipient", modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } },
  { type: "stat-modifier", target: "recipient", modifier: { stat: "T", operation: "add", value: 1 } },
] } };
const snapshot: RecipientSnapshot = { source, sourceUnitId: "source", trigger, selector, selectionPath: "", perspective: "attacker", recipientUnitId: "recipient", selected: true };
const input = { unitId: "recipient", factionId: "example", detachmentId: "example-detachment" };
const context: EngineContext = { phase: "fight", attackerUnitId: "recipient", attackerAttached: false, recipientSnapshots: [snapshot] };

function fixture(body: unknown = effect, event: unknown = trigger, intrinsic = false): Dataset {
  const raw = emptyRawData();
  raw.units = [
    { id: "recipient", name: "Example recipient", keywords: ["Infantry", "Character"] },
    { id: "source", name: "Example source", keywords: ["Character"] },
    { id: "outsider", name: "Example outsider", keywords: ["Infantry"] },
  ].map((unit) => ({ ...unit, faction_id: "example", faction_keywords: ["Example"], ability_ids: intrinsic && unit.id === "source" ? ["snapshot-example"] : [], model_count: { min: 1, max: 5 }, profiles: [{ name: "Example profile", M: 6, T: 4, Sv: 3, W: 2, Ld: 7, OC: 1 }], game_version: { edition: "11th", dataslate: "test" } })) as never;
  raw.abilities = [{ ability_id: "snapshot-example", name: "Example snapshot", faction_id: "example", ability_type: intrinsic ? "unit" : "enhancement", behavior: "reactive", ...(event === null ? {} : { trigger: event }), scope: { duration: "battle" }, effect: body, game_version: { edition: "11th", dataslate: "test" }, authored_by: "40kdc-community" }] as never;
  raw.enhancements = intrinsic ? [] : [{ id: "example-enhancement", name: "Example enhancement", ability_id: "snapshot-example", detachment_id: "example-detachment", cost: 5, keyword_restrictions: ["Example"], is_unique: true, game_version: { edition: "11th", dataslate: "test" } }] as never;
  return new Dataset(raw);
}

describe("caller-supplied source-bound recipient snapshots", () => {
  it("rediscovers an intrinsic ability only from its actual owning source unit", () => {
    const ds = fixture(effect, trigger, true);
    expect(ds.buffsFor(input, context).map((buff) => buff.contribution)).toEqual([{ type: "strength-mod", value: 1 }]);
    const outsider = { ...snapshot, sourceUnitId: "outsider", source: { ...source, sourceUnitId: "outsider" } };
    expect(ds.buffsFor(input, { ...context, recipientSnapshots: [outsider] })).toEqual([]);
  });

  it("keeps snapshotted AP and weapon-skill changes on the recipient's own attacks", () => {
    const body = { ...effect, effect: { type: "sequence", steps: ["AP", "WS", "BS"].map((stat) => ({
      type: "stat-modifier", target: "recipient", modifier: { stat, operation: "improve", value: 1 },
    })) } };
    const result = fixture(body).abilities.get("snapshot-example")!.describeBuffs(source, context);
    expect(result.unsupported).toEqual([]);
    expect(result.applied.map((buff) => buff.contribution)).toEqual([
      { type: "ap-mod", value: -1 },
      { type: "skill-mod", stat: "WS", value: 1 },
      { type: "skill-mod", stat: "BS", value: 1 },
    ]);
  });

  it("keeps the enhancement's Bodyguard buff discoverable after detachment without another purchase", () => {
    const ds = fixture();
    for (const request of [
      { ...input, attachedUnitIds: ["source"], attachmentRoles: { source: "leader", recipient: "bodyguard" } as const },
      input,
    ]) {
      const result = ds.stackableBuffsFor(request, context);
      const buffs = result.buffs.filter((lever) => lever.enabled).flatMap((lever) => lever.buffs);
      expect(buffs.map((buff) => buff.contribution)).toEqual([{ type: "strength-mod", value: 1 }]);
      expect(result.buffs.filter((lever) => lever.cost !== undefined)).toEqual([]);
      expect(resolveBuffs(buffs, { phase: "shooting" }).strengthMod.value).toBe(0);
    }
    expect(ds.buffsFor(input, context).map((buff) => buff.contribution)).toEqual([{ type: "strength-mod", value: 1 }]);
    expect(ds.stackableBuffsFor({ ...input, unitId: "source" }, { ...context, attackerUnitId: "source" }).buffs).toEqual([]);
  });

  it("keeps defensive recipients separate and never grants a Leader the bodyguard snapshot", () => {
    const ds = fixture();
    const defensive: EngineContext = { phase: "fight", targetUnitId: "recipient", targetAttached: false, recipientSnapshots: [{ ...snapshot, perspective: "target" }] };
    expect(ds.defensiveBuffsFor(input, defensive).map((buff) => buff.contribution)).toEqual([{ type: "toughness-mod", value: 1 }]);
    expect(ds.defensiveBuffsFor({ ...input, unitId: "source" }, { ...defensive, targetUnitId: "source" })).toEqual([]);
    expect(ds.defensiveBuffsFor(input, { ...defensive, recipientSnapshots: [snapshot] })).toEqual([]);
  });

  it("distinguishes known nonrecipients, missing evidence, conflicts and stale identities", () => {
    const ability = fixture().abilities.get("snapshot-example")!;
    const excluded = ability.describeBuffs(source, { ...context, recipientSnapshots: [{ ...snapshot, selected: false }] });
    expect(excluded).toEqual({ applied: [], activatable: [], unsupported: [] });
    for (const invalid of [
      { ...snapshot, sourceUnitId: "outsider" },
      { ...snapshot, source: { ...source, sourceUnitId: "outsider" } },
      { ...snapshot, selectionPath: "/steps/0" },
      { ...snapshot, trigger: { event: "turn-started" } },
      { ...snapshot, selector: { filter: { ...selector.filter, attachment_role: "leader" } } },
      { ...snapshot, recipientUnitId: "source" },
      { ...snapshot, perspective: "target" },
    ] as RecipientSnapshot[]) {
      const result = ability.describeBuffs(source, { ...context, recipientSnapshots: [invalid] });
      expect(result.applied).toEqual([]);
      expect(result.unsupported[0].reason).toContain("snapshot is unavailable");
    }
    expect(ability.describeBuffs(source, { ...context, recipientSnapshots: [] }).unsupported[0].reason).toContain("snapshot is unavailable");
    expect(ability.describeBuffs(source, { ...context, recipientSnapshots: [snapshot, { ...snapshot, selected: false }] }).unsupported[0].reason).toBe("conflicting trigger-time recipient snapshots");
  });

  it("ignores object insertion order but checks selector arrays in order", () => {
    const reordered: RecipientSnapshot = { ...snapshot, selector: { filter: { attachment_role: "bodyguard", member_of: "this-unit", level: "model" } }, trigger: { condition: trigger.condition, event: "battle-started" } };
    expect(fixture().abilities.get("snapshot-example")!.describeBuffs(source, { ...context, recipientSnapshots: [reordered] }).applied).toHaveLength(1);
    const withKeywords = { ...effect, selector: { filter: { ...selector.filter, all_of: ["INFANTRY", "CHARACTER"] } } };
    const wrongOrder = { ...snapshot, selector: { filter: { ...selector.filter, all_of: ["CHARACTER", "INFANTRY"] } } };
    expect(fixture(withKeywords).abilities.get("snapshot-example")!.describeBuffs(source, { ...context, recipientSnapshots: [wrongOrder] }).applied).toEqual([]);
  });

  it("retains ordinary conditions and refuses mixed model-only effects", () => {
    const guarded = { type: "conditional", condition: { type: "phase-is", parameters: { phase: "shooting" } }, effect };
    const guardSnapshot = { ...snapshot, selectionPath: "/effect" };
    expect(fixture(guarded).abilities.get("snapshot-example")!.describeBuffs(source, { ...context, recipientSnapshots: [guardSnapshot] }).applied).toEqual([]);
    const mixed = { ...effect, effect: { type: "sequence", steps: [...effect.effect.steps, { type: "roll-modifier", target: "this-model", modifier: { roll: "hit", operation: "add", value: 1 } }] } };
    const result = fixture(mixed).abilities.get("snapshot-example")!.describeBuffs(source, context);
    expect(result.applied).toEqual([]);
    expect(result.unsupported[0].reason).toContain("mixed or unresolved");
  });

  it("uses the owning effect path and local trigger for a nested ability part", () => {
    const nested = { type: "sequence", steps: [{ type: "ability-part", name: "Example part", trigger, effect }] };
    const local = { ...snapshot, selectionPath: "/steps/0/effect" };
    expect(fixture(nested, null).abilities.get("snapshot-example")!.describeBuffs(source, { ...context, recipientSnapshots: [local] }).applied).toHaveLength(1);
    expect(fixture(nested, null).abilities.get("snapshot-example")!.describeBuffs(source, context).applied).toEqual([]);
  });

  it("does not discover a snapshot from an ineligible bearer or wrong detachment", () => {
    const ds = fixture();
    const outsider: BuffSource = { ...source, sourceUnitId: "outsider" };
    expect(ds.buffsFor(input, { ...context, recipientSnapshots: [{ ...snapshot, source: outsider as typeof source, sourceUnitId: "outsider" }] })).toEqual([]);
    expect(ds.buffsFor({ ...input, detachmentId: "other-detachment" }, context)).toEqual([]);
  });
});
