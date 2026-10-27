import { describe, expect, it } from "vitest";

import { Dataset, emptyRawData } from "../src/data/index.js";

// A fabricated army (no GW rule prose): a mob, a boss who can join it or stand apart, an epic hero,
// one detachment with a granting rule, two Stratagems and an Enhancement. The same structure is
// what the four factions' cross-unit rules compile to.

const version = { edition: "11th", dataslate: "test" };
const profile = { M: 6, T: 5, W: 1, Sv: 5, Ld: 7, OC: 2 };
const unit = (id: string, keywords: string[], abilityIds: string[] = []) => ({
  id, name: id, faction_id: "orks", profiles: [{ name: id, ...profile }], keywords, faction_keywords: ["Orks"],
  model_count: { min: 1, max: 10 }, ability_ids: abilityIds, game_version: version,
});
const ability = (id: string, type: string, effect: unknown, extra: Record<string, unknown> = {}) => ({
  ability_id: id, name: extra.name ?? id, authored_by: "40kdc-community", faction_id: "orks", game_version: version,
  ability_type: type, behavior: "passive", effect, scope: { duration: "permanent" }, ...extra,
});
const hitPlus = (target: unknown) => ({ type: "roll-modifier", target, modifier: { roll: "hit", operation: "add", value: 1 } });
const grant = (keywordId: string, value?: number) => ({
  type: "weapon-ability-grant",
  target: "this-unit",
  modifier: { keywords: [{ keyword_id: keywordId, ...(value === undefined ? {} : { parameters: { value } }) }] },
});

function army(): Dataset {
  return new Dataset(armyRaw());
}

function armyRaw() {
  const raw = emptyRawData();
  raw.units = [
    unit("fix-mob", ["Infantry", "Mob"]),
    unit("fix-boss", ["Infantry", "Character"], ["fix-pick-a-mob", "fix-nob-aura"]),
    unit("fix-hero", ["Infantry", "Character", "Epic Hero"]),
  ] as never;
  raw.abilities = [
    // The boss picks another MOB unit within 9": re-roll wound rolls of 1.
    ability("fix-pick-a-mob", "unit", {
      type: "select-units",
      selector: { filter: { owner: "friendly", all_of: ["MOB"] }, count: { min: 1, max: 1 }, eligibility: { operator: "and", operands: [
        { operator: "not", operands: [{ type: "same-unit", parameters: { as: "ability-unit" } }] },
        { type: "matches", parameters: { subject: "selected-unit", filter: { within: { of: "this-model", range: { inches: 9 } } } } },
      ] } },
      effect: { type: "re-roll", target: "selected-unit", modifier: { roll: "wound", subset: "ones" } },
    }),
    // +1 hit for friendly NOBZ only, +1 attack for the boss's own unit only.
    ability("fix-nob-aura", "unit", { type: "sequence", steps: [
      hitPlus({ owner: "friendly", all_of: ["NOBZ"] }),
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "add", value: 1 } },
    ] }),
    // The detachment grants friendly MOB units a record holding a one-of-two stance.
    ability("fix-grant-rule", "detachment", { type: "ability-grant", target: { owner: "friendly", all_of: ["MOB"] }, modifier: { ability: "fix-granted" } }, { detachment_id: "fix-det" }),
    ability("fix-granted", "unit", { type: "stance-select", mode: "re-selectable", options: [
      { id: "stable-lethal", name: "Lethal", effect: grant("lethal-hits") },
      { id: "stable-sustained", name: "Sustained", effect: grant("sustained-hits", 1) },
    ] }, { name: "Fix Granted" }),
    // A Stratagem whose only content is a choice, and one adding a selection to the granted record.
    ability("fix-strat", "stratagem", { type: "choice", options: [hitPlus("this-unit"), { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } }] }, { detachment_id: "fix-det" }),
    ability("fix-more", "stratagem", { type: "stance-selection-capacity", modifier: { ability_id: "fix-granted", additional_selections: 1, allocation: "choose-one-option" } }, { detachment_id: "fix-det" }),
    ability("fix-banner", "enhancement", { type: "re-roll", target: "this-unit", modifier: { roll: "hit", subset: "ones" } }, { detachment_id: "fix-det" }),
  ] as never;
  raw.detachments = [{ id: "fix-det", name: "Fix Detachment", faction_id: "orks", stratagem_ids: ["fix-strat-s", "fix-more-s"], game_version: version }] as never;
  raw.stratagems = [
    { id: "fix-strat-s", name: "Fix Strat", category: "detachment", detachment_id: "fix-det", cp_cost: 2, phases: ["fight"], ability_id: "fix-strat", game_version: version },
    { id: "fix-more-s", name: "Fix More", category: "detachment", detachment_id: "fix-det", cp_cost: 1, phases: ["fight"], ability_id: "fix-more", game_version: version },
  ] as never;
  raw.enhancements = [
    { id: "fix-banner-e", name: "Fix Banner", detachment_id: "fix-det", cost: 20, keyword_restrictions: ["Orks"], ability_id: "fix-banner", is_unique: true, game_version: version },
  ] as never;
  return raw;
}


const ds = army();
const mob = { unitId: "fix-mob", factionId: "orks", detachmentId: "fix-det" };
const byId = (input: Parameters<Dataset["stackableBuffsFor"]>[0]) => {
  const { buffs, groups } = ds.stackableBuffsFor(input, { phase: "fight" });
  return { levers: new Map(buffs.map((lever) => [lever.id, lever])), groups: new Map(groups.map((group) => [group.id, group])) };
};

describe("Dataset.stackableBuffsFor: costs and providers", () => {
  it("prices a Stratagem as one CP lever its choices depend on, even when it applies nothing itself", () => {
    const { levers } = byId(mob);
    expect(levers.get("detachment-stratagem:fix-strat")).toMatchObject({ buffs: [], enabled: false, cost: { cp: 2 } });
    for (const id of ["fix-strat?0", "fix-strat?1"]) {
      expect(levers.get(id)).toMatchObject({ requiresLever: "detachment-stratagem:fix-strat", group: "fix-strat?choice" });
      expect(levers.get(id)!.cost).toBeUndefined();
    }
  });

  it("turns a record the detachment grants into the record's own choice levers, on the unit the grant reaches", () => {
    const { levers, groups } = byId(mob);
    expect(levers.get("fix-grant-rule>fix-granted#stable-lethal")).toMatchObject({ group: "fix-grant-rule>fix-granted?stance", enabled: false });
    expect(levers.get("fix-grant-rule>fix-granted#stable-lethal")!.requiresLever).toBeUndefined();
    expect(groups.get("fix-grant-rule>fix-granted?stance")).toEqual({ id: "fix-grant-rule>fix-granted?stance", abilityId: "fix-granted", label: "Fix Granted", maxActivations: 1 });
    // The boss is not a MOB: the grant does not reach it.
    const boss = byId({ unitId: "fix-boss", factionId: "orks", detachmentId: "fix-det" });
    expect([...boss.levers.keys()].some((id) => id.startsWith("fix-grant-rule>"))).toBe(false);
  });

  it("does not grant a record again to a unit that already holds it", () => {
    const holder = new Dataset({ ...armyRaw(), units: [unit("fix-mob", ["Infantry", "Mob"], ["fix-granted"])] as never });
    const ids = holder.stackableBuffsFor(mob, { phase: "fight" }).buffs.map((lever) => lever.id);
    expect(ids).toContain("fix-granted#stable-lethal");
    expect(ids.some((id) => id.startsWith("fix-grant-rule>"))).toBe(false);
  });

  it("points a selection-raising Stratagem at the pool it raises, and drops it where the pool is absent", () => {
    expect(byId(mob).levers.get("fix-more#cap")).toMatchObject({ buffs: [], raisesCap: { group: "fix-grant-rule>fix-granted?stance", by: 1, allocation: "choose-one-option" }, requiresLever: "detachment-stratagem:fix-more" });
    expect(byId({ unitId: "fix-boss", factionId: "orks", detachmentId: "fix-det" }).levers.has("fix-more#cap")).toBe(false);
  });

  it("offers another unit's selection as an opt-in lever naming that unit, and none of its own-unit buffs", () => {
    const { levers } = byId({ ...mob, supportingUnitIds: ["fix-boss"] });
    const picked = levers.get("fix-pick-a-mob#selected")!;
    expect(picked).toMatchObject({ enabled: false, source: { kind: "ability", abilityKind: "support", sourceUnitId: "fix-boss" } });
    expect(picked.requires).toHaveLength(1);
    expect(levers.has("support:fix-nob-aura")).toBe(false);
  });

  it("keeps the boss's selection off the mob it leads, since the selection excludes the boss's own unit", () => {
    expect(byId({ ...mob, attachedUnitIds: ["fix-boss"] }).levers.has("fix-pick-a-mob#selected")).toBe(false);
  });

  it("offers an Enhancement for a character in the unit at its points, one per bearer, and none to an epic hero", () => {
    const led = byId({ ...mob, attachedUnitIds: ["fix-boss"] });
    expect(led.levers.get("enhancement:fix-banner-e@fix-boss")).toMatchObject({
      cost: { points: 20 }, group: "enhancement@fix-boss", enabled: false,
      source: { kind: "ability", abilityKind: "attached", sourceUnitId: "fix-boss" },
    });
    expect(led.groups.get("enhancement@fix-boss")).toMatchObject({ maxActivations: 1 });
    expect([...byId(mob).levers.keys()].some((id) => id.startsWith("enhancement:"))).toBe(false);
    expect([...byId({ ...mob, attachedUnitIds: ["fix-hero"] }).levers.keys()].some((id) => id.startsWith("enhancement:"))).toBe(false);
  });

  it("preserves intersecting usage pools when an ability record is granted", () => {
    const raw = armyRaw();
    raw.abilities = raw.abilities.map((record) => record.ability_id === "fix-granted"
      ? { ...record, usage: { frequency: "n-per-battle" as const, count: 1 } }
      : record);
    const result = new Dataset(raw).stackableBuffsFor(mob, { phase: "fight" });
    const lever = result.buffs.find((candidate) => candidate.id === "fix-grant-rule>fix-granted#stable-lethal")!;
    expect(lever.group).toBe("fix-grant-rule>fix-granted?stance");
    expect(lever.groups).toContain("fix-grant-rule>fix-granted?usage");
    expect(result.groups).toContainEqual({
      id: "fix-grant-rule>fix-granted?usage", abilityId: "fix-granted", label: "Fix Granted", maxActivations: 1,
    });
  });

  it("resolves renamed stance pools by stable ids and retains fixed-option allocation", () => {
    const raw = armyRaw();
    raw.abilities = raw.abilities.map((record) => {
      if (record.ability_id === "fix-granted") return { ...record, name: "Renamed Display Label" };
      if (record.ability_id === "fix-more") return {
        ...record,
        effect: { type: "stance-selection-capacity", modifier: {
          ability_id: "fix-granted", additional_selections: 1, allocation: "fixed-option",
          option: { ability_id: "fix-granted", option_id: "stable-lethal" },
        } },
      } as never;
      return record;
    });
    const lever = new Dataset(raw).stackableBuffsFor(mob, { phase: "fight" }).buffs.find((candidate) => candidate.id === "fix-more#cap")!;
    expect(lever.raisesCap).toEqual({
      group: "fix-grant-rule>fix-granted?stance", by: 1, allocation: "fixed-option",
      option: { ability_id: "fix-granted", option_id: "stable-lethal" },
    });
  });

  it("binds a rule gated on a stance option to that option's lever, adding a buffless lever for an option with no buff", () => {
    const raw = armyRaw();
    const gatedOn = (optionId: string, effect: unknown) => ({
      type: "conditional", condition: { type: "rule-active", parameters: { rule: { ability_id: "fix-granted", option_id: optionId } } }, effect,
    });
    raw.abilities = [
      ...raw.abilities.map((record) => record.ability_id === "fix-granted" ? {
        ...record,
        effect: { ...(record.effect as object), options: [
          ...(record.effect as { options: unknown[] }).options,
          { id: "stable-hold", name: "Hold", effect: { type: "move-modifier", target: "this-unit", modifier: { applies_to_moves: ["normal"], distance_bonus: 1 } } },
        ] },
      } : record),
      ability("fix-surge", "stratagem", gatedOn("stable-hold", hitPlus("this-unit")), { detachment_id: "fix-det" }),
      ability("fix-edge", "stratagem", gatedOn("stable-lethal", { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } }), { detachment_id: "fix-det" }),
      ability("fix-steady", "detachment", { ...gatedOn("stable-hold", hitPlus("this-unit")), condition: { operator: "not", operands: [gatedOn("stable-hold", null).condition] } }, { detachment_id: "fix-det" }),
    ] as never;
    raw.detachments = [{ ...raw.detachments[0], stratagem_ids: [...raw.detachments[0].stratagem_ids!, "fix-surge-s", "fix-edge-s"] }] as never;
    raw.stratagems = [
      ...raw.stratagems,
      { id: "fix-surge-s", name: "Fix Surge", category: "detachment", detachment_id: "fix-det", cp_cost: 1, phases: ["fight"], ability_id: "fix-surge", game_version: version },
      { id: "fix-edge-s", name: "Fix Edge", category: "detachment", detachment_id: "fix-det", cp_cost: 1, phases: ["fight"], ability_id: "fix-edge", game_version: version },
    ] as never;
    const army = new Dataset(raw);
    const levers = new Map(army.stackableBuffsFor(mob, { phase: "fight" }).buffs.map((lever) => [lever.id, lever]));
    expect(levers.get("fix-surge#stable-hold")).toMatchObject({ requiresOption: "fix-grant-rule>fix-granted#stable-hold", requiresLever: "detachment-stratagem:fix-surge" });
    expect(levers.get("fix-grant-rule>fix-granted#stable-hold")).toMatchObject({ label: "Fix Granted — Hold", buffs: [], enabled: false, group: "fix-grant-rule>fix-granted?stance" });
    expect(levers.get("fix-edge#stable-lethal")).toMatchObject({ requiresOption: "fix-grant-rule>fix-granted#stable-lethal" });
    expect(levers.get("fix-steady#not-stable-hold")).toMatchObject({ excludesOption: "fix-grant-rule>fix-granted#stable-hold" });
    // The boss cannot pick the stance, so the rules gated on it offer it nothing.
    const boss = army.stackableBuffsFor({ unitId: "fix-boss", factionId: "orks", detachmentId: "fix-det" }, { phase: "fight" }).buffs.map((lever) => lever.id);
    expect(boss.filter((id) => id.startsWith("fix-surge#") || id.startsWith("fix-edge#"))).toEqual([]);
    // A rule gated on the boss not picking it always holds.
    const steady = army.stackableBuffsFor({ unitId: "fix-boss", factionId: "orks", detachmentId: "fix-det" }, { phase: "fight" }).buffs
      .find((lever) => lever.id === "fix-steady#not-stable-hold");
    expect(steady).toBeDefined();
    expect(steady!.excludesOption).toBeUndefined();
    // A declared active rule is evaluated directly instead.
    const declared = army.stackableBuffsFor(mob, { phase: "fight", activeRules: [{ ability_id: "fix-granted", option_id: "stable-hold" }] }).buffs;
    expect(declared.find((lever) => lever.id === "detachment-stratagem:fix-surge")!.buffs).toHaveLength(1);
    expect(declared.some((lever) => lever.requiresOption !== undefined)).toBe(false);
  });

  it("retains capacity providers inside granted records", () => {
    const raw = armyRaw();
    raw.abilities = raw.abilities.map((record) => record.ability_id === "fix-granted" ? {
      ...record,
      effect: { type: "sequence", steps: [
        record.effect,
        { type: "stance-selection-capacity", modifier: {
          ability_id: "fix-granted", additional_selections: 1, allocation: "choose-one-option",
          options: [{ ability_id: "fix-granted", option_id: "stable-lethal" }],
        } },
      ] },
    } as never : record);
    const result = new Dataset(raw).stackableBuffsFor(mob, { phase: "fight" });
    expect(result.buffs.find((lever) => lever.id === "fix-grant-rule>fix-granted#cap")?.raisesCap).toEqual({
      group: "fix-grant-rule>fix-granted?stance", by: 1, allocation: "choose-one-option",
      options: [{ ability_id: "fix-granted", option_id: "stable-lethal" }],
    });
  });

  it("does not expand grants with unknown predicates or model-only recipients", () => {
    for (const target of [
      { owner: "friendly", all_of: ["MOB"], state: "battle-shocked" },
      { owner: "friendly", level: "model", member_of: "this-unit" },
    ]) {
      const raw = armyRaw();
      raw.abilities = raw.abilities.map((record) => record.ability_id === "fix-grant-rule"
        ? { ...record, effect: { type: "ability-grant", target, modifier: { ability: "fix-granted" } } } as never
        : record);
      const result = new Dataset(raw).stackableBuffsFor(mob, { phase: "fight" });
      expect(result.buffs.some((lever) => lever.id.startsWith("fix-grant-rule>"))).toBe(false);
    }
  });

  it("resolves a model-level keyword recipient from the keywords every model of the combined unit carries", () => {
    const raw = armyRaw();
    const reroll = (all_of: string[]) => ({ type: "re-roll", target: { owner: "friendly", level: "model", all_of }, modifier: { roll: "hit", subset: "ones" } });
    raw.units = raw.units.map((record) => record.id === "fix-boss"
      ? { ...record, ability_ids: ["fix-orks-models", "fix-character-models"] }
      : record) as never;
    raw.abilities = [...raw.abilities, ability("fix-orks-models", "unit", reroll(["ORKS"])), ability("fix-character-models", "unit", reroll(["CHARACTER"]))] as never;
    const army = new Dataset(raw);
    const buffsOf = (input: Parameters<Dataset["stackableBuffsFor"]>[0], abilityId: string) => army.stackableBuffsFor(input, { phase: "fight" }).buffs
      .filter((lever) => lever.source.kind === "ability" && lever.source.abilityId === abilityId)
      .flatMap((lever) => lever.buffs);
    const led = { ...mob, attachedUnitIds: ["fix-boss"] };
    // Every model of the mob and its boss is ORKS; only the boss's models are CHARACTER.
    expect(buffsOf(led, "fix-orks-models")).not.toEqual([]);
    expect(buffsOf(led, "fix-character-models")).toEqual([]);
    expect(buffsOf({ unitId: "fix-boss", factionId: "orks" }, "fix-character-models")).not.toEqual([]);
  });
});
