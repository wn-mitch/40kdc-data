import type { Dataset } from "./data/dataset.js";
import { crunch, type Buff, type BuffSource, type EngineContext, type RecipientSnapshot, type WeaponKeywordRef } from "./cruncher/index.js";
import { effectToBuffs, type ActivatableBuff } from "./cruncher/from-dsl.js";
import type { Trigger, UnitSelector } from "./generated.js";

export const RECIPIENT_CASE_PREFIX = "canonical/recipient-snapshot/";
export const HALF_WEAPON_RANGE_CASE_PREFIX = "canonical/half-weapon-range/";
export const SCENARIO_CASE_PREFIX = "canonical/scenario/";

export interface DslInput {
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
        ...stanceOptionFields(lever),
        buffs: lever.buffs.map((buff) => buff.contribution),
      })),
    } };
  });
}

/** A lever's stance-option gate, projected only when it has one so ungated goldens keep their shape. */
export function stanceOptionFields(lever: ActivatableBuff): Pick<ActivatableBuff, "requiresOption" | "excludesOption"> {
  return {
    ...(lever.requiresOption ? { requiresOption: lever.requiresOption } : {}),
    ...(lever.excludesOption ? { excludesOption: lever.excludesOption } : {}),
  };
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
        ...stanceOptionFields(lever),
        buffs: lever.buffs.map((applied) => applied.contribution),
      })),
    } };
  });
}

/** The from-dsl row's expectation: contributions, reasons and levers, as every port projects them. */
export function dslExpectation(row: DslInput) {
  const result = effectToBuffs(row.effect, row.source, row.context, row.perspective);
  return { ...row, expected: {
    applied: result.applied.map((applied) => applied.contribution),
    unsupportedReasons: result.unsupported.map((item) => item.reason),
    activatable: result.activatable.map((lever) => ({
      id: lever.id, label: lever.label, group: lever.group ?? null,
      requires: lever.requires ?? null, capRaise: lever.capRaise ?? null,
        ...stanceOptionFields(lever),
      buffs: lever.buffs.map((applied) => applied.contribution),
    })),
  } };
}

/**
 * Fabricated conditional buffs gated on declared scenario state: active rules, regions, objective
 * control, combined-unit members, nearby units, and conjunctions that mix unit and attack predicates.
 */
export function canonicalScenarioCases() {
  const source = { kind: "ability", abilityId: "fabricated-scenario", abilityKind: "unit" } as const;
  const attached = { kind: "ability", abilityId: "fabricated-scenario", abilityKind: "attached", sourceUnitId: "leader" } as const;
  const gated = (condition: unknown) => ({
    type: "conditional", condition,
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } },
  });
  const defensive = (condition: unknown) => ({
    type: "conditional", condition,
    effect: { type: "roll-modifier", target: "attacker", modifier: { roll: "hit", operation: "subtract", value: 1 } },
  });
  const doctrine = { type: "rule-active", parameters: { rule: { ability_id: "example-doctrines", option_id: "assault" } } };
  const ruleId = { type: "rule-active", parameters: { rule: "example-rule" } };
  const notDoctrine = { operator: "not", operands: [doctrine] };
  const fabricatedId = "fabricated-scenario";
  const readyHolders = { type: "designate", target: { owner: "friendly", has_ability: [fabricatedId] }, modifier: { tag: "readied" } };
  const readied = { type: "matches", parameters: { subject: "this-unit", filter: { designated: "readied" } } };
  const shooting = { type: "phase-is", parameters: { phase: "shooting" } };
  const hitPlus = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
  const woundPlus = { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } };
  const apImprove = { type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", operation: "improve", value: 1 } };
  const region = { type: "in-region", parameters: { subject: "this-unit", region: { rule_region: { owner_faction: "example", region_id: "example-region" } } } };
  const whollyTerrain = { type: "in-region", parameters: { subject: "this-unit", models: "every", region: { terrain_area: {} } } };
  const yourTerritory = { type: "in-region", parameters: { region: { territory: "your-territory" } } };
  const half = { type: "controls", parameters: { by: "friendly", proportion: { comparison: "gte", fraction: 0.5 } } };
  const more = { type: "controls", parameters: { compare: { owner: "enemy", comparison: "gt" } } };
  const leadingWith = { type: "attachment", parameters: { role: "leading", subject: "this-model", with: { all_of: ["EXAMPLE SQUAD"] } } };
  const ledBy = { type: "attachment", parameters: { role: "led", with: { all_of: ["CHARACTER"] } } };
  const near = { type: "matches", parameters: { filter: { within: { of: { all_of: ["BATTLELINE"], owner: "friendly" }, range: { inches: 6 } } } } };
  const ranged = { type: "attack-is", parameters: { weapons: { type: "ranged" } } };
  const sAboveT = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "gt", right: { of: "defender", stat: "T" } } };
  const attacksAbove = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "A" }, comparison: "gt", right: { value: 3 } } };
  const woundGated = (condition: unknown) => ({
    type: "conditional", condition,
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
  });
  // Slayer of Tyrants: melee attacks against a unit with a higher Toughness than this unit's.
  const tougherTarget = { operator: "and", operands: [
    { type: "attack-is", parameters: { attack_type: "melee" } },
    { type: "attack-compare", parameters: { left: { of: "defender", stat: "T" }, comparison: "gt", right: { of: "attacker", stat: "T" } } },
  ] };
  // A defender's rule naming the attacker's Toughness: the translation cannot know it.
  const enemyWeaker = { type: "attack-compare", parameters: { left: { of: "attacker", stat: "T" }, comparison: "lt", right: { of: "defender", stat: "T" } } };
  const members = (bodyguard: string[]) => [
    { unitId: "leader", role: "leader" as const, keywords: ["CHARACTER"] },
    { unitId: "squad", role: "bodyguard" as const, keywords: bodyguard },
  ];
  const neighbour = { keywords: ["BATTLELINE", "INFANTRY"], owner: "friendly" as const, distanceInches: 5 };
  const guided = { type: "guided", parameters: {} };
  const defenderWounds = { type: "wounds", parameters: { subject: "defender", remaining_max: 3 } };
  const championCount = { type: "model-count", parameters: { subject: "this-unit", keyword: "EXAMPLE CHAMPION", min: 1 } };
  const noChampion = { type: "model-count", parameters: { subject: "this-unit", keyword: "EXAMPLE CHAMPION", max: 0 } };
  const marksApplied = { type: "designated", parameters: { tag: "example-mark", by: "this-unit", count: { min: 2 } } };
  const markedObjective = { type: "designated", parameters: { subject: { objective: { role: "central" } }, tag: "example-mark" } };
  const holdsOutlying = { type: "controls", parameters: { objective: { role: "non-home" }, count: { min: 2 } } };
  const markedTerrain = { type: "in-region", parameters: { subject: "this-unit", region: { terrain_area: { designated: "example-ruin" } } } };
  const advanced = { type: "happened", parameters: { event: "move-ended", filter: { move_types: ["advance", "fall-back"] }, window: "turn" } };
  const defenderCharged = { type: "happened", parameters: { subject: "defender", event: "move-ended", filter: { move_types: ["charge"] }, window: "turn" } };
  const testFailed = { type: "roll-result", parameters: { roll: "leadership", result: "failure" } };
  const criticalWound = { type: "roll-result", parameters: { roll: "wound", result: "critical" } };
  const modelLed = (filter: Record<string, unknown>) => ({ type: "attachment", parameters: { role: "leading", subject: "this-model", with: { level: "model", ...filter } } });
  const phaseEvent = (parameters: Record<string, unknown>) => ({ type: "happened", parameters: { window: "phase", ...parameters } });
  const selectedToFight = phaseEvent({ event: "selected", filter: { to: "fight" } });
  const killedModel = (by: string) => phaseEvent({ event: "model-destroyed", object: { owner: "enemy", level: "model" }, filter: { by } });
  const killedUnits = phaseEvent({ event: "destroyed", object: { owner: "enemy" }, filter: { by: "this-unit" }, count: { min: 2 } });
  const lostThisModel = phaseEvent({ event: "model-destroyed", object: "this-model", count: { min: 1 } });
  const lostModel = phaseEvent({ event: "model-destroyed", object: "model-in-this-unit" });
  const pactPassed = phaseEvent({ event: "after-roll", filter: { roll: "dark-pact", result: "success" } });
  const hitByRanged = phaseEvent({ event: "after-roll", object: "defender", filter: { roll: "hit", result: "success", attack_type: "ranged" } });
  const hitDefender = phaseEvent({ event: "after-roll", object: "defender", filter: { roll: "hit", result: "success" } });
  const outlying = (controller: "attacker" | "target" | undefined) => controller === undefined ? { role: "non-home" as const } : { role: "non-home" as const, controller };
  const inputs: Array<{ id: string; effect: unknown; context: Partial<EngineContext>; source?: DslInput["source"]; perspective?: DslInput["perspective"] }> = [
    { id: "rule-active-option", effect: gated(doctrine), context: { activeRules: [{ ability_id: "example-doctrines", option_id: "assault" }] } },
    { id: "rule-active-other-option", effect: gated(doctrine), context: { activeRules: [{ ability_id: "example-doctrines", option_id: "tactical" }] } },
    { id: "rule-active-id-by-option", effect: gated(ruleId), context: { activeRules: [{ ability_id: "example-rule", definition_id: "one" }] } },
    { id: "rule-active-undeclared", effect: gated(ruleId), context: {} },
    { id: "rule-active-option-lever", effect: gated(doctrine), context: {} },
    { id: "rule-active-option-with-condition", effect: gated({ operator: "and", operands: [doctrine, shooting] }), context: {} },
    { id: "rule-active-option-with-failed-condition", effect: gated({ operator: "and", operands: [doctrine, { type: "phase-is", parameters: { phase: "fight" } }] }), context: {} },
    { id: "rule-active-option-shared-lever", effect: { type: "sequence", steps: [gated(doctrine), woundGated(doctrine)] }, context: {} },
    { id: "rule-active-option-in-choice", effect: { type: "choice", options: [hitPlus, { type: "sequence", steps: [gated(doctrine), { type: "conditional", condition: doctrine, effect: apImprove }] }] }, context: {} },
    { id: "rule-active-option-mixed-choice", effect: { type: "choice", options: [{ type: "sequence", steps: [woundPlus, gated(doctrine)] }] }, context: {} },
    { id: "rule-active-option-negated", effect: gated(notDoctrine), context: {} },
    { id: "self-designation-gate", effect: { type: "sequence", steps: [readyHolders, gated(readied)] }, context: {} },
    { id: "self-designation-other-tag", effect: { type: "sequence", steps: [readyHolders, gated({ ...readied, parameters: { ...readied.parameters, filter: { designated: "marked" } } })] }, context: {} },
    { id: "self-designation-declared", effect: { type: "sequence", steps: [readyHolders, gated(readied)] }, context: { attackerDesignations: [] } },
    { id: "rule-active-option-both-sides", effect: { type: "sequence", steps: [gated({ operator: "and", operands: [notDoctrine, shooting] }), woundGated(doctrine)] }, context: {} },
    { id: "in-region-rule-region", effect: gated(region), context: { attackerRegions: [{ ruleRegion: "example-region" }] } },
    { id: "in-region-elsewhere", effect: gated(region), context: { attackerRegions: [{ ruleRegion: "other-region" }] } },
    { id: "in-region-not-wholly", effect: gated(whollyTerrain), context: { attackerRegions: [{ terrainArea: true }] } },
    { id: "in-region-wholly", effect: gated(whollyTerrain), context: { attackerRegions: [{ terrainArea: true, wholly: true }] } },
    { id: "in-region-defender-territory", effect: defensive(yourTerritory), context: { targetRegions: [{ territory: "target" }] }, perspective: "target" },
    { id: "controls-half", effect: gated(half), context: { objectivesControlled: { attacker: 3, target: 1, total: 6 } } },
    { id: "controls-below-half", effect: gated(half), context: { objectivesControlled: { attacker: 2, target: 1, total: 6 } } },
    { id: "controls-tied", effect: gated(more), context: { objectivesControlled: { attacker: 2, target: 2, total: 5 } } },
    { id: "controls-defender-side", effect: defensive(half), context: { objectivesControlled: { attacker: 3, target: 1, total: 6 } }, perspective: "target" },
    { id: "attachment-leading-with", effect: gated(leadingWith), context: { attackerMembers: members(["EXAMPLE SQUAD"]) }, source: attached },
    { id: "attachment-leading-other", effect: gated(leadingWith), context: { attackerMembers: members(["OTHER SQUAD"]) }, source: attached },
    { id: "attachment-with-flags-only", effect: gated(leadingWith), context: { attackerAttached: true, attachmentRoles: { leader: "leader" } }, source: attached },
    { id: "attachment-led-by", effect: gated(ledBy), context: { attackerUnitId: "squad", attackerMembers: members([]) } },
    { id: "neighbour-in-range", effect: gated(near), context: { attackerNeighbours: [neighbour] } },
    { id: "neighbour-out-of-range", effect: gated(near), context: { attackerNeighbours: [{ ...neighbour, distanceInches: 7 }] } },
    { id: "neighbour-undeclared", effect: gated(near), context: {} },
    { id: "split-unit-and-weapon", effect: gated({ operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, ranged] }), context: {} },
    { id: "split-unit-false", effect: gated({ operator: "and", operands: [{ type: "phase-is", parameters: { phase: "fight" } }, ranged] }), context: {} },
    { id: "split-nested-compare", effect: gated({ operator: "and", operands: [{ operator: "and", operands: [ruleId, sAboveT] }] }), context: { activeRules: ["example-rule"] } },
    { id: "split-unknown-rest", effect: gated({ operator: "and", operands: [ruleId, sAboveT] }), context: {} },
    { id: "attack-compare-unsupported-stat", effect: gated(attacksAbove), context: {} },
    { id: "own-toughness-bound", effect: woundGated(tougherTarget), context: { phase: "fight", attackerToughness: 7 } },
    { id: "own-toughness-unbound", effect: woundGated(tougherTarget), context: { phase: "fight" } },
    { id: "own-toughness-defender-unbound", effect: defensive(enemyWeaker), context: { attackerToughness: 7 }, perspective: "target" },
    { id: "guided-true", effect: gated(guided), context: { attackerGuided: true } },
    { id: "guided-false", effect: gated(guided), context: { attackerGuided: false } },
    { id: "guided-undeclared", effect: gated(guided), context: {} },
    { id: "wounds-defender-remaining", effect: gated(defenderWounds), context: { targetWounds: { remaining: 2, starting: 6 } } },
    { id: "wounds-defender-unhurt", effect: gated(defenderWounds), context: { targetWounds: { remaining: 6, starting: 6 } } },
    { id: "model-count-keyword-declared", effect: gated(championCount), context: { attackerKeywordModels: { "example champion": 1 } } },
    { id: "model-count-keyword-declared-none", effect: gated(championCount), context: { attackerKeywordModels: { "EXAMPLE CHAMPION": 0 } } },
    { id: "model-count-keyword-every-model", effect: gated(noChampion), context: { attackerModelKeywords: ["EXAMPLE CHAMPION"], attackerModelCount: 3 } },
    { id: "model-count-keyword-unit-only", effect: gated(championCount), context: { attackerKeywords: ["INFANTRY"], attackerModelCount: 3 } },
    { id: "designated-applied-count", effect: gated(marksApplied), context: { attackerDesignationsApplied: { "example-mark": 2 } } },
    { id: "designated-applied-below", effect: gated(marksApplied), context: { attackerDesignationsApplied: { "example-mark": 1, "other-mark": 3 } } },
    { id: "designated-applied-undeclared", effect: gated(marksApplied), context: {} },
    { id: "designated-applied-defender", effect: defensive(marksApplied), context: { attackerDesignationsApplied: { "example-mark": 2 }, targetDesignationsApplied: {} }, perspective: "target" },
    { id: "designated-objective", effect: gated(markedObjective), context: { objectives: [{ role: "central", designations: ["EXAMPLE-MARK"] }, { role: "home" }] } },
    { id: "designated-objective-unmarked", effect: gated(markedObjective), context: { objectives: [{ role: "central", designations: [] }] } },
    { id: "designated-objective-unknown", effect: gated(markedObjective), context: { objectives: [{ role: "central" }] } },
    { id: "controls-objective-filter", effect: gated(holdsOutlying), context: { objectives: [outlying("attacker"), outlying("attacker"), { role: "home", controller: "attacker" }] } },
    { id: "controls-objective-filter-short", effect: gated(holdsOutlying), context: { objectives: [outlying("attacker"), outlying("target"), { role: "home", controller: "attacker" }] } },
    { id: "controls-objective-filter-uncontrolled-unknown", effect: gated(holdsOutlying), context: { objectives: [outlying("attacker"), outlying(undefined)] } },
    { id: "controls-objective-filter-defender", effect: defensive(holdsOutlying), context: { objectives: [outlying("target"), outlying("target"), outlying("attacker")] }, perspective: "target" },
    { id: "controls-from-objectives", effect: gated(half), context: { objectives: [outlying("attacker"), outlying("target")] } },
    { id: "in-region-designated-terrain", effect: gated(markedTerrain), context: { attackerRegions: [{ terrainArea: true, designations: ["example-ruin"] }] } },
    { id: "in-region-designated-other", effect: gated(markedTerrain), context: { attackerRegions: [{ terrainArea: true, designations: ["other-ruin"] }, { ruleRegion: "example-region" }] } },
    { id: "in-region-designated-unknown", effect: gated(markedTerrain), context: { attackerRegions: [{ terrainArea: true }] } },
    { id: "happened-own-move", effect: gated(advanced), context: { attackerMoves: ["fall-back"] } },
    { id: "happened-own-other-move", effect: gated(advanced), context: { attackerMoves: ["normal"] } },
    { id: "happened-own-move-undeclared", effect: gated(advanced), context: {} },
    { id: "happened-defender-charged", effect: gated(defenderCharged), context: { targetMoves: ["charge"], attackerMoves: [] } },
    { id: "happened-defender-not-charged", effect: gated(defenderCharged), context: { targetMoves: ["normal"], attackerCharged: true } },
    { id: "roll-result-declared", effect: gated(testFailed), context: { testResults: { leadership: "failure" } } },
    { id: "roll-result-other", effect: gated(testFailed), context: { testResults: { leadership: "success", "battle-shock": "failure" } } },
    { id: "roll-result-undeclared", effect: gated(testFailed), context: {} },
    { id: "attachment-with-model-keyword", effect: gated(modelLed({ all_of: ["EXAMPLE SQUAD"] })), context: { attackerMembers: members(["EXAMPLE SQUAD"]) }, source: attached },
    { id: "attachment-with-model-name-unknown", effect: gated(modelLed({ all_of: ["EXAMPLE SERGEANT"] })), context: { attackerMembers: members(["EXAMPLE SQUAD"]) }, source: attached },
    { id: "attachment-with-model-excluded", effect: gated(modelLed({ none_of: ["EXAMPLE SQUAD"] })), context: { attackerMembers: members(["EXAMPLE SQUAD"]) }, source: attached },
    { id: "attachment-with-model-level-unit", effect: gated({ type: "attachment", parameters: { role: "leading", subject: "this-model", with: { level: "unit", all_of: ["OTHER SQUAD"] } } }), context: { attackerMembers: members(["EXAMPLE SQUAD"]) }, source: attached },
    { id: "happened-selected-to-fight", effect: gated(selectedToFight), context: { phase: "fight", attackerSelected: ["fight"] } },
    { id: "happened-selected-other", effect: gated(selectedToFight), context: { phase: "fight", attackerSelected: ["shoot"] } },
    { id: "happened-selected-undeclared", effect: gated(selectedToFight), context: { phase: "fight" } },
    { id: "happened-selected-event-subject", effect: gated(phaseEvent({ subject: "event-subject", event: "selected", filter: { to: "fight" } })), context: { phase: "fight", attackerSelected: ["fight"] } },
    { id: "happened-selected-defender", effect: defensive(selectedToFight), context: { phase: "fight", attackerSelected: [], targetSelected: ["fight"] }, perspective: "target" },
    { id: "happened-killed-model", effect: gated(killedModel("this-unit")), context: { attackerKills: { models: 2, units: 0 } } },
    { id: "happened-killed-none", effect: gated(killedModel("this-unit")), context: { attackerKills: { models: 0, units: 0 } } },
    { id: "happened-killed-by-model-unknown", effect: gated(killedModel("this-model")), context: { attackerKills: { models: 3, units: 1 } } },
    { id: "happened-killed-by-model-none", effect: gated(killedModel("this-model")), context: { attackerKills: { models: 0, units: 0 } } },
    { id: "happened-killed-units-short", effect: gated(killedUnits), context: { attackerKills: { models: 9, units: 1 } } },
    { id: "happened-killed-units", effect: gated(killedUnits), context: { attackerKills: { models: 9, units: 2 } } },
    { id: "happened-killed-undeclared", effect: gated(killedUnits), context: {} },
    { id: "happened-lost-this-model-none", effect: gated(lostThisModel), context: { attackerLosses: 0 } },
    { id: "happened-lost-this-model-unknown", effect: gated(lostThisModel), context: { attackerLosses: 2 } },
    { id: "happened-lost-model", effect: gated(lostModel), context: { attackerLosses: 2 } },
    { id: "happened-rolled-critical-success", effect: gated(pactPassed), context: { attackerRolls: [{ roll: "dark-pact", result: "critical" }] } },
    { id: "happened-rolled-failure", effect: gated(pactPassed), context: { attackerRolls: [{ roll: "dark-pact", result: "failure" }, { roll: "hit", result: "success" }] } },
    { id: "happened-rolled-undeclared", effect: gated(pactPassed), context: {} },
    { id: "happened-rolled-against", effect: gated(hitDefender), context: { targetRolledAgainst: [{ roll: "hit", result: "success" }], attackerRolledAgainst: [] } },
    { id: "happened-rolled-against-narrowed", effect: gated(hitByRanged), context: { targetRolledAgainst: [{ roll: "hit", result: "success" }] } },
    { id: "happened-rolled-against-none", effect: gated(hitByRanged), context: { targetRolledAgainst: [] } },
    { id: "roll-result-critical-wound-gate", effect: gated(criticalWound), context: { testResults: { leadership: "failure" } } },
    { id: "roll-result-critical-hit-unknown", effect: gated({ type: "roll-result", parameters: { roll: "hit", result: "critical" } }), context: {} },
    { id: "roll-result-critical-wound-defender-unknown", effect: defensive(criticalWound), context: {}, perspective: "target" },
  ];
  return inputs.map((input) => withGates(dslExpectation({
    caseId: `${SCENARIO_CASE_PREFIX}${input.id}`,
    abilityId: source.abilityId,
    source: input.source ?? source,
    effect: input.effect,
    context: { phase: input.context.phase ?? "shooting", ...input.context },
    perspective: input.perspective ?? "attacker",
  })));
}

/** Pin each applied buff's gate as well: these rows exist to fix how a condition becomes a gate. */
function withGates<T extends DslInput & { expected: Record<string, unknown> }>(row: T): T {
  const result = effectToBuffs(row.effect, row.source, row.context, row.perspective);
  return { ...row, expected: { ...row.expected, applicableWhen: result.applied.map((buff) => buff.applicableWhen ?? null) } };
}

/**
 * Pin the attack-comparison gate in the damage path: the attack's modified Strength against the
 * target's Toughness, read after the Strength and Toughness the other buffs give.
 */
export function canonicalAttackCompareCases(ds: Dataset) {
  const source = { kind: "ability", abilityId: "fabricated-attack-compare", abilityKind: "unit" } as const;
  const woundBonus = (comparison: string, right: Record<string, unknown>) => ({
    type: "conditional",
    condition: { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison, right } },
    effect: { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } },
  });
  const above = woundBonus("gt", { of: "defender", stat: "T" });
  const gatedStrength = {
    type: "conditional",
    condition: { type: "attack-compare", parameters: { left: { of: "attacker", stat: "S" }, comparison: "gte", right: { of: "defender", stat: "T" } } },
    effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } },
  };
  const strength = { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } };
  const inputs: { id: string; effects: unknown[] }[] = [
    { id: "s-equals-t-no-bonus", effects: [above] },
    { id: "s-lifted-above-t", effects: [strength, above] },
    { id: "s-below-value", effects: [woundBonus("lt", { value: 5 })] },
    { id: "gated-strength-feeds-no-comparison", effects: [gatedStrength, above] },
  ];
  const weapon = ds.weapons.getAny("bolt-rifle");
  const unit = ds.units.getAny("intercessor-squad");
  if (!weapon || !unit) throw new Error("canonical attack-compare corpus requires bolt-rifle and intercessor-squad");
  return inputs.map((row) => {
    const context: EngineContext = { phase: "shooting", withinHalfRange: true, attackerStationary: false };
    const buffs = row.effects.flatMap((effect) => {
      const translated = effectToBuffs(effect, source, context);
      if (translated.unsupported.length || translated.activatable.length) throw new Error(`canonical attack-compare ${row.id}: expected extracted buffs`);
      return translated.applied;
    });
    const result = crunch({ attacker: { weapon: weapon.raw, profileIndex: 0 }, target: { unit: unit.raw, profileIndex: 0 }, modelsFiring: 5, context, buffs }, ds);
    return { filename: `canonical-attack-compare-${row.id}.json`, value: {
      name: `Canonical attack comparison: ${row.id}`,
      attacker: { weaponId: weapon.id, profileIndex: 0 }, target: { unitId: unit.id, profileIndex: 0 },
      modelsFiring: 5, context, buffs,
      expected: { stages: Object.fromEntries(result.stages.map((stage) => [stage.name, Math.round(stage.expected * 1e4) / 1e4])) },
    } };
  });
}

/**
 * Pin buffs that apply only on a critical wound in the damage path: those wounds take their save at
 * their own AP and deal their own Damage, including as Devastating Wounds' mortal wounds.
 */
export function canonicalCriticalWoundCases(ds: Dataset) {
  const source = { kind: "ability", abilityId: "fabricated-critical-wound", abilityKind: "unit" } as const;
  const onCritical = (effect: unknown) => ({ type: "conditional", condition: { type: "roll-result", parameters: { roll: "wound", result: "critical" } }, effect });
  const apImprove = onCritical({ type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", operation: "improve", value: 2 } });
  const damageAdd = onCritical({ type: "stat-modifier", target: "this-unit", modifier: { stat: "D", operation: "add", value: 1 } });
  const devastating = { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "devastating-wounds" }] } };
  const defender: Buff = { source: { kind: "ability", abilityId: "fabricated-defender", abilityKind: "unit" }, contribution: { type: "reroll-one", roll: "save" } };
  const inputs: { id: string; effects: unknown[]; extra?: Buff[] }[] = [
    { id: "ap", effects: [apImprove] },
    { id: "damage", effects: [damageAdd] },
    { id: "ap-and-damage", effects: [apImprove, damageAdd] },
    { id: "devastating-damage", effects: [devastating, damageAdd] },
    { id: "ap-with-save-reroll-one", effects: [apImprove], extra: [defender] },
  ];
  const weapon = ds.weapons.getAny("bolt-rifle");
  const unit = ds.units.getAny("intercessor-squad");
  if (!weapon || !unit) throw new Error("canonical critical-wound corpus requires bolt-rifle and intercessor-squad");
  return inputs.map((row) => {
    const context: EngineContext = { phase: "shooting", withinHalfRange: true, attackerStationary: false };
    const buffs = [...row.effects.flatMap((effect) => {
      const translated = effectToBuffs(effect, source, context);
      if (translated.unsupported.length || translated.activatable.length) throw new Error(`canonical critical-wound ${row.id}: expected extracted buffs`);
      return translated.applied;
    }), ...(row.extra ?? [])];
    const result = crunch({ attacker: { weapon: weapon.raw, profileIndex: 0 }, target: { unit: unit.raw, profileIndex: 0 }, modelsFiring: 5, context, buffs }, ds);
    return { filename: `canonical-critical-wound-${row.id}.json`, value: {
      name: `Canonical critical wound: ${row.id}`,
      attacker: { weaponId: weapon.id, profileIndex: 0 }, target: { unitId: unit.id, profileIndex: 0 },
      modelsFiring: 5, context, buffs,
      expected: { stages: Object.fromEntries(result.stages.map((stage) => [stage.name, Math.round(stage.expected * 1e4) / 1e4])) },
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
