import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility, describeCondition } from "../src/translate/index.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refusalOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

/** The trigger a compiled ability fires on: its first trigger-bearing node. */
const triggerOf = (mechanics: Record<string, any>) => mechanics.trigger ?? mechanics.triggers?.[0] ?? mechanics;

const GIZMO_UNIT = { owner: "friendly", all_of: ["GIZMO"] };

// Aura moment whose unit is the one targeted with a Stratagem (fabricated wording).
describe("Aura recipient targeted with a Stratagem (object antecedent)", () => {
  it("names the targeted unit's owner and range, not this unit, as the trigger's subject and object", () => {
    const text = "While a friendly GIZMO unit is within 12\" of this model, each time that unit is chosen by a Gadget. You gain 1CP.";
    const mechanics = mechanicsOf(placed(text,
      ["friendly GIZMO unit", "unit-filter", { side: "friendly", keywords: ["GIZMO"] }],
      ["within 12\" of this model", "aura-range", { inches: 12, of: "this-model" }],
      ["each time that unit is chosen by a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem", object: "antecedent" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    const trigger = triggerOf(mechanics);
    expect(JSON.stringify(trigger)).toContain('"subject":{"owner":"any"}');
    expect(trigger.object).toEqual({ ...GIZMO_UNIT, within: { of: "this-model", range: { inches: 12 } } });
    expect(trigger.filter).toEqual({ kind: "stratagem" });
    expect(trigger.proximity).toBeUndefined();
  });

  it("keeps the named owner as the subject and the target's range as its object", () => {
    const text = "While a friendly ZETA unit is within 6\" of this model, each time you pick that unit for a Gadget. You gain 1CP.";
    const mechanics = mechanicsOf(placed(text,
      ["friendly ZETA unit", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["each time you pick that unit for a Gadget", "event", { kind: "targets-selected", owner: "friendly", action_kind: "stratagem", object: "antecedent" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    const trigger = triggerOf(mechanics);
    expect(JSON.stringify(trigger)).toContain('"subject":{"owner":"friendly"}');
    expect(trigger.object).toEqual({ owner: "friendly", all_of: ["ZETA"], within: { of: "this-model", range: { inches: 6 } } });
    expect(trigger.proximity).toBeUndefined();
  });

  it("refuses a range that cannot be the target's: wholly within, which only the subject form already refuses", () => {
    const text = "While a friendly unit is within 6\" of this model wholly, each time that unit is chosen by a Gadget.";
    const message = refusalOf(placed(text,
      ["friendly unit", "unit-filter", { side: "friendly", keywords: [] }],
      ["within 6\" of this model wholly", "aura-range", { inches: 6, of: "this-model", wholly: true }],
      ["each time that unit is chosen by a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem", object: "antecedent" }]), text);
    expect(message).toMatch(/wholly/);
  });

  it("refuses an object antecedent on a used moment: the recipient is not who used the rule", () => {
    const text = "While a friendly unit is within 6\" of this model, each time that unit uses its Foo ability. You gain 1CP.";
    const message = refusalOf(placed(text,
      ["friendly unit", "unit-filter", { side: "friendly", keywords: [] }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["each time that unit uses", "event", { kind: "used", object: "antecedent" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    expect(message).toMatch(/not who used it/);
  });
});

// The opponent's targeting of a unit within range (fabricated wording).
describe("Opponent targets a unit within range with a Stratagem", () => {
  const text = "A rival picks a squad from its force within 12\" of the carrier with a Gadget. You gain 1CP.";
  const leaves = () => placed(text,
    ["A rival picks", "event", { kind: "targets-selected", owner: "enemy" }],
    ["a squad from its force", "unit-filter", { side: "enemy", keywords: [] }],
    ["within 12\" of the carrier", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent" }],
    ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }],
    ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);

  it("folds the unit-filter and range into the moment's object, and the tail into its Stratagem filter", () => {
    const trigger = triggerOf(mechanicsOf(leaves(), text));
    expect(trigger.subject).toEqual({ owner: "enemy" });
    expect(trigger.filter).toEqual({ kind: "stratagem" });
    expect(trigger.object).toEqual({ owner: "enemy", within: { of: "this-model", range: { inches: 12 } } });
    expect(trigger.proximity).toBeUndefined();
  });

  it("is one trigger: the tail is consumed rather than read as a second moment", () => {
    const mechanics = mechanicsOf(leaves(), text);
    expect(triggerOf(mechanics).event).toBe("targets-selected");
    expect(triggerOf(mechanics).proximity).toBeUndefined();
    // Without the fold the tail is a second targets-selected moment; the compiled ability has one trigger.
    expect(Object.keys(triggerOf(mechanics))).not.toContain("operator");
  });

  it("refuses a range from the target that is negated", () => {
    const message = refusalOf(placed(text,
      ["A rival picks", "event", { kind: "targets-selected", owner: "enemy" }],
      ["a squad from its force", "unit-filter", { side: "enemy", keywords: [] }],
      ["within 12\" of the carrier", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: true }],
      ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    expect(message).toMatch(/negated/);
  });

  it("refuses a range measured from a unit other than this unit or model", () => {
    const message = refusalOf(placed(text,
      ["A rival picks", "event", { kind: "targets-selected", owner: "enemy" }],
      ["a squad from its force", "unit-filter", { side: "enemy", keywords: [] }],
      ["within 12\" of the carrier", "unit-position", { kind: "within", inches: 12, of: "event-subject", subject: "antecedent" }],
      ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    expect(message).toMatch(/measured from this unit or this model/);
  });

  it("refuses a Stratagem tail after a moment that already names its action kind", () => {
    const message = refusalOf(placed(text,
      ["A rival picks", "event", { kind: "targets-selected", owner: "enemy", action_kind: "attack" }],
      ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }]), text);
    expect(message).toMatch(/action kind/);
  });
});

// Restriction on units already targeted with named Stratagems (fabricated wording).
describe("Unit not targeted with named Stratagems this phase (unit-activity v15)", () => {
  const text = "One unit that has not been chosen by the Alpha Gadget or Beta Gadget this phase. It gains 1CP.";
  const ids = ["alpha-strike-fabricated-detachment", "beta-strike-fabricated-detachment"];

  it("is a negated any-of over the named Stratagems, each targeting the unit this phase", () => {
    const mechanics = mechanicsOf(placed(text,
      ["not been chosen by the Alpha Gadget or Beta Gadget this phase", "unit-activity", { activities: ["targeted-with-stratagem-this-phase"], stratagem_ids: ids, subject: "this-unit", negated: true }],
      ["It gains 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), text);
    expect(mechanics.condition ?? mechanics).toEqual(expect.anything());
    const serialized = JSON.stringify(mechanics);
    expect(serialized).toContain('"operator":"not"');
    expect(serialized).toContain('"operator":"or"');
    for (const id of ids) expect(serialized).toContain(`"id":"${id}"`);
    expect(serialized).toContain('"window":"phase"');
  });

  it("keeps the activity's own Stratagem out when a single id names the other Stratagem", () => {
    const single = "One unit that has not been chosen by the Beta Gadget this phase. It gains 1CP.";
    const mechanics = mechanicsOf(placed(single,
      ["not been chosen by the Beta Gadget this phase", "unit-activity", { activities: ["targeted-with-stratagem-this-phase"], stratagem_ids: ["beta-strike-fabricated-detachment"], subject: "this-unit", negated: true }],
      ["It gains 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), single);
    const serialized = JSON.stringify(mechanics);
    expect(serialized).toContain('"operator":"not"');
    expect(serialized).not.toContain('"operator":"or"');
    expect(serialized).not.toContain("alpha-strike-fabricated-detachment");
  });

  it("refuses a leaf that names the activity without its Stratagems", () => {
    const message = refusalOf(placed(text,
      ["not been chosen", "unit-activity", { activities: ["targeted-with-stratagem-this-phase"], subject: "this-unit", negated: true }]), text);
    expect(message).toMatch(/stratagem_ids/);
  });

  it("refuses stratagem_ids on a leaf whose activity is not the targeting activity", () => {
    const message = refusalOf(placed(text,
      ["not been chosen", "unit-activity", { activities: ["fought-this-phase"], stratagem_ids: ids, subject: "this-unit", negated: true }]), text);
    expect(message).toMatch(/applies only to the Stratagem-targeting activity/);
  });

  it("refuses the targeting activity mixed with another activity in one leaf", () => {
    const message = refusalOf(placed(text,
      ["not been chosen", "unit-activity", { activities: ["targeted-with-stratagem-this-phase", "fought-this-phase"], stratagem_ids: ids, subject: "this-unit", negated: true }]), text);
    expect(message).toMatch(/not mixed/);
  });

  it("refuses an id that is not kebab-case, and a Stratagem named twice, at authoring", () => {
    const base = { activities: ["targeted-with-stratagem-this-phase"], subject: "this-unit" };
    expect(() => normalizeFingerprintParameters("unit-activity", { ...base, stratagem_ids: ["Alpha Strike"] }, currentFamilyVersion("unit-activity"))).toThrow(TypeError);
    expect(() => normalizeFingerprintParameters("unit-activity", { ...base, stratagem_ids: [ids[0], ids[0]] }, currentFamilyVersion("unit-activity"))).toThrow(/twice/);
  });

  it("accepts the targeting activity at authoring with its ids sorted", () => {
    const normalized = normalizeFingerprintParameters("unit-activity", { activities: ["targeted-with-stratagem-this-phase"], stratagem_ids: [ids[1], ids[0]], subject: "this-unit", negated: true }, currentFamilyVersion("unit-activity"));
    expect(normalized.stratagem_ids).toEqual([...ids].sort());
    expect(normalized.activities).toEqual(["targeted-with-stratagem-this-phase"]);
  });
});

// Authoring-time widening of event (version 19): object antecedent and owner any, targets-selected only.
describe("event version 19 widens targets-selected only", () => {
  const version = currentFamilyVersion("event");

  it("accepts an object antecedent and an owner any on targets-selected", () => {
    expect(normalizeFingerprintParameters("event", { kind: "targets-selected", action_kind: "stratagem", object: "antecedent" }, version).object).toBe("antecedent");
    expect(normalizeFingerprintParameters("event", { kind: "targets-selected", action_kind: "stratagem", owner: "any" }, version).owner).toBe("any");
  });

  it("refuses an object antecedent or owner any on any other moment", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "used", object: "antecedent" }, version)).toThrow(TypeError);
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", owner: "any" }, version)).toThrow(TypeError);
  });

  it("keeps the earlier object and owner values as they were", () => {
    expect(normalizeFingerprintParameters("event", { kind: "targets-selected", object: "this-model" }, version).object).toBe("this-model");
    expect(normalizeFingerprintParameters("event", { kind: "targets-selected", owner: "enemy" }, version).owner).toBe("enemy");
  });
});

// Whole-record shapes: each record's leaves as its design rows draft them (fabricated wording).
describe("Record shapes from the wave-10 design compile whole", () => {
  it("7011's opponent-targeting enhancement: moment, unit-filter, range and Stratagem tail with its other leaves", () => {
    const text = "GIZMO model only. Once per round, when a rival picks a squad from its force within 12\" of the carrier with a Gadget, the carrier can use this Relic, and increase the CP cost of that use by 1CP.";
    const mechanics = mechanicsOf(placed(text,
      ["GIZMO model only", "bearer-eligibility", { keywords: ["GIZMO", "CARRIER"], match: "all", excluded_keywords: [] }],
      ["Once per round", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["when a rival picks", "event", { kind: "targets-selected", owner: "enemy" }],
      ["a squad from its force", "unit-filter", { side: "enemy", keywords: [] }],
      ["within 12\" of the carrier", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent", negated: false }],
      ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }],
      ["the carrier can use this Relic", "optional-use", { who: "this-model" }],
      ["increase the CP cost of that use by 1CP", "stratagem-cost", { of: "stratagem", operation: "increase", amount: 1, applies_to: "the-triggering-use" }]), text);
    const serialized = JSON.stringify(mechanics);
    expect(serialized).toContain('"subject":{"owner":"enemy"}');
    expect(serialized).toContain('"within":{"of":"this-model","range":{"inches":12}}');
    expect(serialized).toContain('"kind":"stratagem"');
    expect(serialized).not.toContain("proximity");
  });

  it("8869's aura: once per battle round, the friendly unit and its range, and a Stratagem targeting it by any player", () => {
    const text = "Once per battle round, while a friendly GIZMO unit is within 12\" of this model, when that unit is chosen by a Gadget, this model can use this ability and reduce the CP cost of that Gadget by 1CP.";
    const mechanics = mechanicsOf(placed(text,
      ["Once per battle round", "usage-limit", { frequency: "once-per-battle-round", per: "model" }],
      ["while a friendly GIZMO unit", "unit-filter", { side: "friendly", keywords: ["GIZMO"] }],
      ["within 12\" of this model", "aura-range", { inches: 12, of: "this-model" }],
      ["when that unit is chosen by a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem", object: "antecedent" }],
      ["this model can use this ability", "optional-use", { who: "this-model" }],
      ["reduce the CP cost of that Gadget by 1CP", "stratagem-cost", { of: "stratagem", operation: "decrease", amount: 1, applies_to: "the-triggering-use" }]), text);
    const serialized = JSON.stringify(mechanics);
    expect(serialized).toContain('"subject":{"owner":"any"}');
    expect(serialized).toContain('"within":{"of":"this-model","range":{"inches":12}}');
    expect(serialized).toContain('"owner":"friendly"');
    expect(serialized).not.toContain("antecedent");
  });
});

// The describer names the Stratagem a unit was targeted with, and the unit that was targeted.
describe("Describer for Stratagem targeting", () => {
  it("says the unit has been targeted with the named Stratagem this phase, not that it selected a unit", () => {
    const happened = { type: "happened", parameters: { event: "targets-selected", subject: { owner: "any" }, object: "this-unit", filter: { kind: "stratagem", id: "alpha-strike-fabricated" }, window: "phase" } };
    const text = describeCondition(happened as any);
    expect(text).toBe("the unit has been targeted with the Alpha Strike Fabricated Stratagem this phase");
    expect(describeCondition({ operator: "not", operands: [happened] } as any)).toBe("the unit has not been targeted with the Alpha Strike Fabricated Stratagem this phase");
  });

  it("describes an aura recipient's Stratagem trigger with its range", () => {
    const text = describeAbility({
      effect: { type: "cp-gain", target: "this-model", modifier: { amount: 1 } },
      scope: { duration: "permanent" },
      trigger: { event: "targets-selected", subject: { owner: "any" }, filter: { kind: "stratagem" }, object: { owner: "friendly", all_of: ["GIZMO"], within: { of: "this-model", range: { inches: 6 } } } },
      behavior: "triggered",
    } as any);
    expect(text).toBe('When a friendly GIZMO unit within 6" of this model is targeted with a Stratagem, you gain 1CP.');
  });
});

// Refusals and real-shape checks for the wave-10 opponent-Stratagem records (fabricated wording;
// ids and keywords are the data's own, as the records name them).
describe("Opponent Stratagem targeting: refusals of unfolded shapes", () => {
  const text = "A rival picks a squad from its force within 12\" of the carrier with a Gadget. You gain 1CP.";
  const moment = ["A rival picks", "event", { kind: "targets-selected", owner: "enemy" }] as const;
  const filter = ["a squad from its force", "unit-filter", { side: "enemy", keywords: [] }] as const;
  const range = ["within 12\" of the carrier", "unit-position", { kind: "within", inches: 12, of: "this-model", subject: "antecedent" }] as const;
  const tail = ["with a Gadget", "event", { kind: "targets-selected", action_kind: "stratagem" }] as const;
  const gain = ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }] as const;

  it("refuses a range after the moment when no unit-filter names the target between them", () => {
    const message = refusalOf(placed(text, [...moment], [...range], [...tail], [...gain]), text);
    expect(message).toMatch(/unit-filter between/);
  });

  it("refuses a Stratagem tail that does not directly follow the moment (a unit-filter sits between)", () => {
    const message = refusalOf(placed(text, [...moment], [...filter], [...tail], [...gain]), text);
    expect(message).toMatch(/directly follow a targets-selected moment/);
  });

  it("refuses a Stratagem tail with no moment before it, rather than a standalone targets-selected trigger", () => {
    const message = refusalOf(placed(text, [...tail], [...gain]), text);
    expect(message).toMatch(/directly follow a targets-selected moment/);
  });

  it("refuses an object antecedent on a targets-selected moment with no aura naming that unit", () => {
    const owned = "Each time you pick that unit for a Gadget. You gain 1CP.";
    const message = refusalOf(placed(owned,
      ["Each time you pick that unit for a Gadget", "event", { kind: "targets-selected", owner: "friendly", action_kind: "stratagem", object: "antecedent" }],
      ["You gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]), owned);
    expect(message).toMatch(/aura/);
  });
});

describe("Opponent Stratagem targeting: the wave-10 restriction records with their real ids", () => {
  // The target leaf and unit-filter lead the restriction, as they do in the authored records.
  const restriction = (sentence: string, ids: string[]) => {
    const text = `${sentence} You gain 1CP.`;
    const list = placed(text,
      ["Pick one", "stratagem-target", { count: "one" }],
      ["DEATHWATCH INFANTRY unit", "unit-filter", { side: "friendly", keywords: ["DEATHWATCH", "INFANTRY"] }],
      ["cannot select any units that have already been targeted with the named Stratagems this phase.", "unit-activity", { activities: ["targeted-with-stratagem-this-phase"], stratagem_ids: ids, subject: "this-unit", negated: true }],
      ["You gain 1CP.", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);
    // The restriction leaves sit in the TARGET fragment, as in the authored records; the gain is the EFFECT.
    for (const leaf of list.slice(0, 3)) leaf.fragment = "TARGET";
    const result = compileLeaves(list, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return JSON.stringify(result.core);
  };

  it("1267: the restriction names the Kraken and Hellfire Rounds ids, and not its own Dragonfire Rounds", () => {
    const serialized = restriction(
      "Pick one DEATHWATCH INFANTRY unit. It cannot select any units that have already been targeted with the named Stratagems this phase.",
      ["kraken-rounds-ordo-xenos-alien-hunters-agents-of-the-imperium", "hellfire-rounds-ordo-xenos-alien-hunters-agents-of-the-imperium"]);
    expect(serialized).toContain('"id":"kraken-rounds-ordo-xenos-alien-hunters-agents-of-the-imperium"');
    expect(serialized).toContain('"id":"hellfire-rounds-ordo-xenos-alien-hunters-agents-of-the-imperium"');
    expect(serialized).not.toContain("dragonfire-rounds");
  });

  it("7760: the restriction names the Empyric Dislocation id, and not the Armour of Corruption", () => {
    const serialized = restriction(
      "Pick one DEATHWATCH INFANTRY unit. It cannot select any units that have already been targeted with the named Stratagems this phase.",
      ["empyric-dislocation-warpstrike-champions-chaos-space-marines"]);
    expect(serialized).toContain('"id":"empyric-dislocation-warpstrike-champions-chaos-space-marines"');
    expect(serialized).not.toContain("armour-of-corruption");
  });
});
