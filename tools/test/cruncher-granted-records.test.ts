import { describe, expect, it } from "vitest";

import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { resolveGrantedRecords, type GrantedRecord } from "../src/cruncher/granted-records.js";
import type { BuffSource, EngineContext } from "../src/cruncher/index.js";
import { classifyUnsupported } from "../src/semantic-authoring/pipeline-8b-gates.js";

const source: BuffSource = { kind: "ability", abilityId: "fabricated-banner", abilityKind: "unit" };
const context: EngineContext = { phase: "shooting", attackerStationary: false };
const grant = (target: unknown, ability: string, extra: Record<string, unknown> = {}) => ({ type: "ability-grant", target, modifier: { ability, ...extra } });
// An army rule that only holds in its own army, granted by an aura to the units around its bearer.
const armyRule: GrantedRecord = {
  effect: { type: "conditional", condition: { type: "army-faction", parameters: { faction: "example" } },
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } } },
  trigger: { event: "selected", filter: { to: "shoot" } },
  usage: { frequency: "once-per-turn", per: "unit" },
};
const records: Record<string, GrantedRecord> = { "fabricated-army-rule": armyRule };
const aura = {
  type: "aura", target: "friendly-within-aura",
  modifier: { range: { inches: 6 }, eligible: { owner: "friendly", all_of: ["EXAMPLE"] }, effect: grant("recipient", "fabricated-army-rule") },
};

describe("resolveGrantedRecords", () => {
  it("prints a granted record as an ability part carrying its effect, trigger and usage", () => {
    const resolved = resolveGrantedRecords(aura, (id) => records[id]) as typeof aura;
    expect(resolved.modifier.effect.modifier).toEqual({
      ability: "fabricated-army-rule",
      definition: { type: "ability-part", effect: armyRule.effect, trigger: armyRule.trigger, usage: armyRule.usage },
    });
    expect(resolved.modifier.range).toBe(aura.modifier.range);
  });

  it("leaves printed grants, rules bundles, core abilities and the granting ability itself alone", () => {
    const lookup = (id: string) => (id === "stealth" ? undefined : records["fabricated-army-rule"]);
    for (const node of [
      grant("this-unit", "fabricated-army-rule", { definition: { type: "ability-part", effect: { type: "sequence", steps: [] } } }),
      grant("this-unit", "fabricated-army-rule", { rules_bundle: true }),
      grant("this-unit", "stealth"),
    ]) expect(resolveGrantedRecords(node, lookup)).toBe(node);
    const own = grant("this-unit", "fabricated-banner");
    expect(resolveGrantedRecords(own, lookup, new Set(["fabricated-banner"]))).toBe(own);
  });

  it("turns an aura grant of an army rule from an unrecognised shape into an honest unknown", () => {
    const lookup = (id: string) => records[id]?.effect;
    const raw = classifyUnsupported(effectToBuffs(aura, source, context).unsupported, lookup);
    expect(raw.unrecognizedShape).toBe(1);
    const resolved = effectToBuffs(resolveGrantedRecords(aura, (id) => records[id]), source, context);
    expect(classifyUnsupported(resolved.unsupported, lookup)).toEqual({ honestUnknown: 1, outsideDamagePath: 0, unrecognizedShape: 0 });
    // Declaring the army turns the rule into the holder's own opt-in lever.
    const declared = effectToBuffs(resolveGrantedRecords(aura, (id) => records[id]), source, { ...context, armyFaction: "example" });
    expect(declared.unsupported).toEqual([]);
    expect(declared.activatable.map((lever) => lever.buffs.map((buff) => buff.contribution))).toEqual([[{ type: "hit-mod", value: 1 }]]);
  });
});
