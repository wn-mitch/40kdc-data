import type {
  AbilityDSLCondition,
  AbilityPart,
  EffectNode,
  NamedRegionBranch,
  NamedRegionConsumer,
  NamedRegionProducer,
  NamedRegionRef,
  NamedRegionState,
  NamedRegionStateEffect,
  RegionRef,
  SingleEffect,
  UnitFilter,
  WeaponKeywordSelector,
} from "../generated.js";
import { closed, CompileError, keywordRef, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * `named-region-state` compiles a whole ability from one leaf (see `named-region-family.ts` for
 * why: the DSL shape is mostly a fixed template, with the region, its beneficiaries, and its two
 * branch effects parameterized). `compile.ts` calls `compileNamedRegionState` instead of its
 * ordinary leaf walk whenever a leaf list is exactly one `named-region-state` leaf.
 */

function controlGate(territory: string, fraction: number): AbilityDSLCondition {
  const objectiveTerritory = territory === "no-mans-land" ? "no-mans-land" : "enemy-territory";
  return {
    type: "controls",
    parameters: {
      by: "friendly",
      objective: { territory: objectiveTerritory },
      proportion: { comparison: "gte", fraction },
    },
  };
}

/** The complete producer's canonical regions. Baseline and phase extensions are deliberately data
 * shaped, rather than activation/expiry wrappers: a region is active for its declared duration,
 * and phase control is evaluated once at the trigger. */
function fixedZones(parameters: Node): Pick<NamedRegionProducer, "baseline" | "phase_extensions"> {
  const baselineRegion: RegionRef = parameters.baseline_region === undefined
    ? { territory: "your-deployment-zone" }
    : structuredClone(parameters.baseline_region) as RegionRef;
  const baseline: NamedRegionProducer["baseline"] = [{ region: baselineRegion, duration: "permanent" }];
  const phaseExtensions = parameters.phase_extensions;
  if (Array.isArray(phaseExtensions)) {
    return { baseline, phase_extensions: structuredClone(phaseExtensions) as NamedRegionProducer["phase_extensions"] };
  }
  return {
    baseline,
    phase_extensions: ([
      ["no-mans-land", "no-mans-land"],
      ["opponent-deployment-zone", "enemy-deployment-zone"],
    ] as const).map(([_, territory]) => ({
      region: { territory },
      condition: controlGate(territory, 0.5),
      trigger: { event: "phase-started" },
      duration: "phase",
      evaluation: "snapshot-once",
    })),
  };
}

function branchEffectNode(branch: Record<string, unknown>): EffectNode {
  const modifier: Node = { roll: branch.roll };
  if (branch.kind === "reroll") {
    if (branch.subset === "any") modifier.result_scope = "any-result";
    else modifier.subset = branch.subset;
  } else {
    modifier.operation = branch.operation;
    modifier.value = branch.value;
  }
  if (branch.weapon_keyword !== undefined) {
    const keywordNode = keywordRef(branch.weapon_keyword);
    if (typeof keywordNode.keyword_id !== "string") throw new CompileError("A named-region weapon keyword must resolve to a catalog keyword.");
    const keyword = keywordNode as Node & WeaponKeywordSelector;
    modifier.weapons = { keyword };
  }
  return { type: branch.kind === "reroll" ? "re-roll" : "roll-modifier", target: "attacker", modifier } as SingleEffect;
}

/** A branch is an ability part; its attack context is carried by the enclosing consumer. */
function branch(effectNode: EffectNode, optional: boolean): NamedRegionBranch {
  const effect: AbilityPart = {
    type: "ability-part",
    effect: effectNode,
    optional,
  };
  return { effect };
}

export function compileNamedRegionState(leaf: CompileLeaf): { effect: NamedRegionStateEffect & Node; behavior: string } {
  const p = leaf.parameters;
  const regionRef: NamedRegionRef = { region_id: closed(leaf, "region_id") as string, owner_faction: closed(leaf, "owner_faction") as string };
  const zones = fixedZones(p);

  const additiveExtensions: Node[] = [];
  const proximity = p.proximity_extension as { gate_ref: string; keywords: string[]; radius_inches: number } | undefined;
  if (proximity) {
    additiveExtensions.push({
      kind: "unit-proximity",
      filter: { owner: "friendly", all_of: [...proximity.keywords] },
      range: { inches: proximity.radius_inches },
    });
  }

  const membershipScope = closed(leaf, "membership_scope");
  // "model" membership narrows the qualifying condition to this model, wholly within the
  // region; "whole-unit" membership narrows it to every model of the unit, wholly within.
  const inRegion: Node = {
    type: "in-region",
    parameters: {
      ...(membershipScope === "model" ? { subject: "this-model" } : {}),
      region: { rule_region: structuredClone(regionRef) },
      wholly: true,
      ...(membershipScope === "whole-unit" ? { models: "every" } : {}),
    },
  };
  const qualifiedKeyword = p.qualifies_by_keyword as string | undefined;
  const qualifiedCondition: Node = qualifiedKeyword
    ? { operator: "or", operands: [{ type: "matches", parameters: { subject: "this-unit", filter: { all_of: [qualifiedKeyword] } } }, inRegion] }
    : inRegion;

  const beneficiaryFilter: UnitFilter = {
    owner: "friendly",
    ...(p.beneficiary_operator === "and" ? { all_of: [...(p.beneficiary_keywords as string[])] } : { any_of: [...(p.beneficiary_keywords as string[])] }),
  };

  const consumer: NamedRegionConsumer = {
    state_ref: structuredClone(regionRef),
    beneficiary_filter: beneficiaryFilter,
    membership: { unit_scope: membershipScope as "model" | "whole-unit", relation: "wholly-within" },
    qualified_condition: qualifiedCondition as AbilityDSLCondition,
    default_branch: branch(branchEffectNode(p.default_branch as Record<string, unknown>), Boolean((p.default_branch as Record<string, unknown>).optional)),
    qualified_branch: branch(branchEffectNode(p.qualified_branch as Record<string, unknown>), Boolean((p.qualified_branch as Record<string, unknown>).optional)),
  };
  if (p.melee_or_visible_ranged === true) {
    consumer.attack_condition = {
      operator: "or",
      operands: [
        { type: "attack-is", parameters: { attack_type: "melee" } },
        { operator: "and", operands: [{ type: "attack-is", parameters: { attack_type: "ranged" } }, { type: "matches", parameters: { subject: "defender", filter: { visible: { to: "attacker" } } } }] },
      ],
    };
  }

  const producer: NamedRegionProducer = {
    region_ref: structuredClone(regionRef),
    mode: "complete",
    parent_ref: null,
    baseline: zones.baseline,
    phase_extensions: zones.phase_extensions,
    additive_extensions: additiveExtensions as NamedRegionProducer["additive_extensions"],
  };
  const modifier: NamedRegionState = {
    region_ref: structuredClone(regionRef),
    producer,
    consumer,
    branch_precedence: "qualified-replaces-default",
  };
  if (!leaf.parameters.behavior) throw new CompileError("named-region-state needs a behavior (aura or passive).");
  const effect: NamedRegionStateEffect & Node = { type: "named-region-state", target: { owner: "friendly" }, modifier };
  return { effect, behavior: closed(leaf, "behavior") as string };
}

/**
 * named-region-producer: the region alone, declared for other rules to name (its consumers are
 * ordinary leaves gated by in-region's rule-region). Its zones are the fixed recipe above.
 */
export function compileNamedRegionProducer(leaf: CompileLeaf): Node {
  const regionRef: NamedRegionRef = { region_id: closed(leaf, "region_id") as string, owner_faction: closed(leaf, "owner_faction") as string };
  const producer: NamedRegionProducer = {
    region_ref: structuredClone(regionRef), mode: "complete", parent_ref: null, ...fixedZones({}), additive_extensions: [],
  };
  return { type: "named-region-state", target: { owner: "friendly" }, modifier: { region_ref: regionRef, producer } };
}
