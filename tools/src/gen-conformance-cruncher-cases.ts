import type { Dataset } from "./data/dataset.js";
import { crunch, type BuffSource, type EngineContext, type RecipientSnapshot, type WeaponKeywordRef } from "./cruncher/index.js";
import { effectToBuffs } from "./cruncher/from-dsl.js";
import type { Trigger, UnitSelector } from "./generated.js";

export const RECIPIENT_CASE_PREFIX = "canonical/recipient-snapshot/";
export const HALF_WEAPON_RANGE_CASE_PREFIX = "canonical/half-weapon-range/";

interface DslInput {
  caseId: string;
  abilityId: string;
  effect: unknown;
  source: Extract<BuffSource, { kind: "ability" }>;
  context: EngineContext;
  perspective: "attacker" | "target";
}

/** Fabricated, source-attested history; deliberately no current attachment-role evidence. */
export function canonicalRecipientCases() {
  const source = { kind: "ability", abilityId: "snapshot-example", abilityKind: "attached", sourceUnitId: "source" } as const;
  const trigger: Trigger = { event: "battle-started", condition: { type: "attachment", parameters: { subject: "this-model", role: "leading" } } };
  const selector: UnitSelector = { filter: { level: "model", member_of: "this-unit", attachment_role: "bodyguard" } };
  const pool = { type: "for-each-unit", selector, effect: { type: "sequence", steps: [
    { type: "stat-modifier", target: "recipient", modifier: { stat: "S", operation: "add", value: 1, weapons: { type: "melee" } } },
    { type: "stat-modifier", target: "recipient", modifier: { stat: "T", operation: "add", value: 1 } },
  ] } };
  // from-dsl consumes an effect, not an ability record. A real local part trigger carries
  // the same activation without pre-resolving the historical recipient in the generator.
  const effect = { type: "ability-part", trigger, duration: "battle", effect: pool };
  const snapshot: RecipientSnapshot = { source, sourceUnitId: "source", trigger, selector, selectionPath: "/effect", perspective: "attacker", recipientUnitId: "recipient", selected: true };
  const context: EngineContext = { phase: "fight", attackerUnitId: "recipient", attackerKeywords: ["INFANTRY", "CHARACTER"], attackerAttached: false };
  const cases: DslInput[] = [];
  const add = (id: string, snapshots: RecipientSnapshot[], overrides: Partial<DslInput> = {}) => {
    cases.push({ caseId: `${RECIPIENT_CASE_PREFIX}${id}`, abilityId: source.abilityId, source, effect,
      context: { ...context, recipientSnapshots: snapshots }, perspective: "attacker", ...overrides });
  };
  add("attested-strength-after-detachment", [snapshot]);
  add("attested-toughness-after-detachment", [], {
    perspective: "target",
    context: { phase: "fight", targetUnitId: "recipient", targetKeywords: ["INFANTRY", "CHARACTER"], targetAttached: false, recipientSnapshots: [{ ...snapshot, perspective: "target" }] },
  });
  add("missing", []);
  add("wrong-source-unit", [{ ...snapshot, sourceUnitId: "outsider" }]);
  add("wrong-source-identity", [{ ...snapshot, source: { ...source, sourceUnitId: "outsider" } }]);
  add("conflicting", [snapshot, { ...snapshot, selected: false }]);
  add("known-nonrecipient", [{ ...snapshot, selected: false }]);
  add("wrong-recipient", [{ ...snapshot, recipientUnitId: "source" }]);
  add("wrong-perspective", [{ ...snapshot, perspective: "target" }]);
  add("wrong-trigger", [{ ...snapshot, trigger: { event: "turn-started" } }]);
  add("wrong-selection-path", [{ ...snapshot, selectionPath: "" }]);
  add("wrong-selector-role", [{ ...snapshot, selector: { filter: { ...selector.filter, attachment_role: "leader" } } }]);
  add("reordered-object-fields", [{ ...snapshot, selector: { filter: { attachment_role: "bodyguard", member_of: "this-unit", level: "model" } }, trigger: { condition: trigger.condition, event: "battle-started" } }]);
  add("nested-local-trigger-path", [{ ...snapshot, selectionPath: "/steps/0/effect" }], { effect: { type: "sequence", steps: [effect] } });
  add("recipient-relative-ap-ws-bs", [snapshot], { effect: { ...effect, effect: { ...pool, effect: { type: "sequence", steps: ["AP", "WS", "BS"].map((stat) => ({
    type: "stat-modifier", target: "recipient", modifier: { stat, operation: "improve", value: 1 },
  })) } } } });
  return cases.map((row) => {
    const result = effectToBuffs(row.effect, row.source, row.context, row.perspective);
    return { ...row, expected: {
      applied: result.applied.map((buff) => buff.contribution),
      unsupportedReasons: result.unsupported.map((item) => item.reason),
      activatable: result.activatable.map((lever) => ({
        id: lever.id, label: lever.label, group: lever.group ?? null,
        requires: lever.requires ?? null, capRaise: lever.capRaise ?? null,
        buffs: lever.buffs.map((buff) => buff.contribution),
      })),
    } };
  });
}

/** Fabricated conditional buff cases for the attacker/defender half-weapon relationship. */
export function canonicalHalfWeaponRangeCases() {
  const source = { kind: "ability", abilityId: "fabricated-half-weapon-range", abilityKind: "unit" } as const;
  const baseWithin = { range: "half-weapon", of: "attacker" };
  const buff = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } };
  const conditional = (within: unknown) => ({
    type: "conditional",
    condition: { type: "matches", parameters: { subject: "defender", filter: { owner: "enemy", level: "unit", within } } },
    effect: buff,
  });
  const inputs: Array<{ id: string; context: EngineContext; effect: unknown }> = [
    { id: "known-true", context: { phase: "shooting", withinHalfRange: true }, effect: conditional(baseWithin) },
    { id: "known-false", context: { phase: "shooting", withinHalfRange: false }, effect: conditional(baseWithin) },
    { id: "missing-unknown", context: { phase: "shooting" }, effect: conditional(baseWithin) },
    { id: "wholly-unknown", context: { phase: "shooting", withinHalfRange: true }, effect: conditional({ ...baseWithin, wholly: true }) },
    { id: "unrelated-unknown", context: { phase: "shooting", withinHalfRange: true }, effect: conditional({ ...baseWithin, of: "defender" }) },
  ];
  return inputs.map((input) => {
    const row: DslInput = {
      caseId: `${HALF_WEAPON_RANGE_CASE_PREFIX}${input.id}`,
      abilityId: source.abilityId,
      source,
      effect: input.effect,
      context: input.context,
      perspective: "attacker",
    };
    const result = effectToBuffs(row.effect, row.source, row.context, row.perspective);
    return { ...row, expected: {
      applied: result.applied.map((applied) => applied.contribution),
      unsupportedReasons: result.unsupported.map((item) => item.reason),
      activatable: result.activatable.map((lever) => ({
        id: lever.id, label: lever.label, group: lever.group ?? null,
        requires: lever.requires ?? null, capRaise: lever.capRaise ?? null,
        buffs: lever.buffs.map((applied) => applied.contribution),
      })),
    } };
  });
}

/** Pin gates in the actual damage path: from-dsl's contribution projection omits applicability. */
export function canonicalWeaponScopeCases(ds: Dataset) {
  const source = { kind: "ability", abilityId: "fabricated-weapon-scope", abilityKind: "unit" } as const;
  const vehicle: WeaponKeywordRef = { keyword_id: "anti", parameters: { target_keyword: "VEHICLE", threshold: 4 } };
  const infantry: WeaponKeywordRef = { keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 3 } };
  const effect = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 2, weapons: { keyword: vehicle } } };
  const nested = { type: "conditional", condition: { type: "attack-is", parameters: { weapons: { keyword: vehicle } } },
    effect: { ...effect, modifier: { ...effect.modifier, weapons: { keyword: infantry } } } };
  const inputs: { id: string; effect: unknown; keywords: WeaponKeywordRef[] }[] = [
    { id: "exact-anti-match", effect, keywords: [vehicle] },
    { id: "same-id-wrong-target", effect, keywords: [{ ...vehicle, parameters: { target_keyword: "INFANTRY", threshold: 4 } }] },
    { id: "same-id-wrong-rating", effect, keywords: [{ ...vehicle, parameters: { target_keyword: "VEHICLE", threshold: 3 } }] },
    { id: "same-id-unknown-parameters", effect, keywords: [{ keyword_id: "anti" }] },
    { id: "nested-both-match", effect: nested, keywords: [vehicle, infantry] },
    { id: "nested-outer-only", effect: nested, keywords: [vehicle] },
    { id: "nested-inner-only", effect: nested, keywords: [infantry] },
    { id: "nested-crossed-parameters", effect: nested, keywords: [
      { keyword_id: "anti", parameters: { target_keyword: "VEHICLE", threshold: 3 } },
      { keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 4 } },
    ] },
  ];
  const weapon = ds.weapons.getAny("bolt-rifle");
  const unit = ds.units.getAny("intercessor-squad");
  if (!weapon || !unit) throw new Error("canonical weapon-scope corpus requires bolt-rifle and intercessor-squad");
  return inputs.map((row) => {
    const context: EngineContext = { phase: "shooting", withinHalfRange: true, attackerStationary: false, weaponKeywordRefs: row.keywords };
    const translated = effectToBuffs(row.effect, source, context);
    if (translated.unsupported.length || translated.activatable.length) throw new Error(`canonical weapon-scope ${row.id}: expected unconditional extracted buffs`);
    const result = crunch({ attacker: { weapon: weapon.raw, profileIndex: 0 }, target: { unit: unit.raw, profileIndex: 0 }, modelsFiring: 5, context, buffs: translated.applied }, ds);
    return { filename: `canonical-weapon-scope-${row.id}.json`, value: {
      name: `Canonical weapon scope: ${row.id}`,
      attacker: { weaponId: weapon.id, profileIndex: 0 }, target: { unitId: unit.id, profileIndex: 0 },
      modelsFiring: 5, context, buffs: translated.applied,
      expected: { stages: Object.fromEntries(result.stages.map((stage) => [stage.name, Math.round(stage.expected * 1e4) / 1e4])) },
    } };
  });
}
