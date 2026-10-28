/**
 * Declared-scenario contexts for the coverage audit. The audit's permissive context declares no
 * scenario facts, so every condition that reads them stays unknown. These contexts declare every
 * scenario fact the engine reads, in two opposite settings, so the audit can tell a condition the
 * engine decides once a scenario is declared from one it cannot evaluate at all.
 */
import type { ActiveRule, EngineContext, ScenarioObjective, ScenarioRegion } from "./cruncher/buffs.js";

/** Every value under one of `keys` anywhere in an effect tree, as strings. */
function collect(node: unknown, keys: ReadonlySet<string>, out: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, keys, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (keys.has(key) && typeof value === "string") out.add(value);
      collect(value, keys, out);
    }
  }
  return out;
}

/** Every `rule-active` rule reference in an effect tree, as an active-rule entry. */
function ruleRefs(node: unknown, out: ActiveRule[] = []): ActiveRule[] {
  if (Array.isArray(node)) {
    for (const item of node) ruleRefs(item, out);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    const params = record.parameters as Record<string, unknown> | undefined;
    if (record.type === "rule-active" && params !== undefined) {
      const rule = params.rule;
      if (typeof rule === "string") out.push(rule);
      else if (typeof rule === "object" && rule !== null && typeof (rule as { ability_id?: unknown }).ability_id === "string") {
        out.push(rule as ActiveRule);
      }
    }
    for (const value of Object.values(record)) ruleRefs(value, out);
  }
  return out;
}

const MOVES = ["normal", "advance", "fall-back", "charge", "remain-stationary", "ingress"];
const TESTS = ["leadership", "battle-shock", "charge"];

/**
 * Two contexts that declare every scenario fact for `effect`, with opposite values: in the first
 * nothing is designated, moved, controlled, nearby or active and every unit is unhurt; in the
 * second all of it holds. Designation tags, rule regions, active rules and model keywords are read
 * from the effect so the second context can satisfy the conditions that name them.
 */
export function declaredScenarios(effect: unknown, faction: string): [Partial<EngineContext>, Partial<EngineContext>] {
  const tags = [...collect(effect, new Set(["designated", "tag"]), new Set())];
  const regionIds = [...collect(effect, new Set(["region_id"]), new Set())];
  const keywords = [...collect(effect, new Set(["keyword"]), new Set())];
  const counts = (count: number) => Object.fromEntries(keywords.map((keyword) => [keyword, count]));
  const applied = (count: number) => Object.fromEntries(tags.map((tag) => [tag, count]));
  const objective = (controller: ScenarioObjective["controller"], side: "attacker" | "target"): ScenarioObjective => ({
    controller, designations: tags, role: "central", homeOf: side, territory: side, name: "objective",
  });
  const regions: ScenarioRegion[] = [
    ...regionIds.map((ruleRegion) => ({ ruleRegion, wholly: true })),
    { terrainArea: true, designations: tags, wholly: true },
    { territory: "attacker", wholly: true },
    { deploymentZone: "attacker", wholly: true },
  ];
  const none: Partial<EngineContext> = {
    battleRound: 1,
    attackerTurn: true,
    attackerStrength: "full",
    targetStrength: "full",
    attackerWounds: { remaining: 10, starting: 10 },
    targetWounds: { remaining: 10, starting: 10 },
    attackerDesignations: [],
    targetDesignations: [],
    attackerStates: [],
    targetStates: [],
    targetClosest: false,
    attackerObjectives: [],
    targetObjectives: [],
    attackerNeighbours: [],
    targetNeighbours: [],
    activeRules: [],
    attackerRegions: [],
    targetRegions: [],
    objectivesControlled: { attacker: 0, target: 0, total: 5 },
    objectives: [],
    attackerDesignationsApplied: {},
    targetDesignationsApplied: {},
    attackerMoves: [],
    targetMoves: [],
    testResults: Object.fromEntries(TESTS.map((roll) => [roll, "success" as const])),
    attackerKeywordModels: counts(0),
    targetKeywordModels: counts(0),
    attackerGuided: false,
    attackerModelCount: 1,
    targetModelCount: 1,
    battleSize: "incursion",
    armyFaction: faction,
    targetArmyFaction: faction,
    distanceInches: 24,
  };
  const all: Partial<EngineContext> = {
    battleRound: 5,
    attackerTurn: false,
    attackerStrength: "below-half",
    targetStrength: "below-half",
    attackerWounds: { remaining: 1, starting: 10 },
    targetWounds: { remaining: 1, starting: 10 },
    attackerDesignations: tags,
    targetDesignations: tags,
    attackerStates: ["engaged", "battle-shocked", "hidden"],
    targetStates: ["engaged", "battle-shocked", "hidden"],
    targetClosest: true,
    attackerObjectives: [objective("attacker", "attacker")],
    targetObjectives: [objective("target", "target")],
    attackerNeighbours: [{ keywords, owner: "friendly", distanceInches: 0 }, { keywords, owner: "enemy", distanceInches: 0 }],
    targetNeighbours: [{ keywords, owner: "friendly", distanceInches: 0 }, { keywords, owner: "enemy", distanceInches: 0 }],
    activeRules: ruleRefs(effect),
    attackerRegions: regions,
    targetRegions: regions,
    objectivesControlled: { attacker: 5, target: 0, total: 5 },
    objectives: [objective("attacker", "attacker"), objective("target", "target")],
    attackerDesignationsApplied: applied(5),
    targetDesignationsApplied: applied(5),
    attackerMoves: MOVES,
    targetMoves: MOVES,
    testResults: Object.fromEntries(TESTS.map((roll) => [roll, "failure" as const])),
    attackerKeywordModels: counts(20),
    targetKeywordModels: counts(20),
    attackerGuided: true,
    attackerModelCount: 20,
    targetModelCount: 20,
    battleSize: "onslaught",
    armyFaction: "",
    targetArmyFaction: "",
    distanceInches: 0,
  };
  return [none, all];
}
