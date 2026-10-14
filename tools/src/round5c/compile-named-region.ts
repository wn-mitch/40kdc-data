import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * `named-region-state` compiles a whole ability from one leaf (see `named-region-family.ts` for
 * why: the DSL shape is mostly a fixed template, with the region, its beneficiaries, and its two
 * branch effects parameterized). `compile.ts` calls `compileNamedRegionState` instead of its
 * ordinary leaf walk whenever a leaf list is exactly one `named-region-state` leaf.
 */

const CONTROL_GATE: Node = { marker_scope: "markers-in-zone", controlled_by: "owner-army", threshold: { comparison: "at-least", fraction: 0.5 } };

/** The producer's baseline (own deployment zone, always active) and its two phase extensions (no-man's-land, the opponent's deployment zone, each snapshotting majority control at phase start) never vary across the authored corpus. */
function fixedZones(): { baseline: Node[]; phase_extensions: Node[] } {
  return {
    baseline: [{ kind: "fixed-zone", zone: "own-deployment-zone", activation: { event: "always-active" }, expiry: { event: "never" } }],
    phase_extensions: (["no-mans-land", "opponent-deployment-zone"] as const).map((zone) => ({
      kind: "objective-majority-zone", zone,
      control_gate: structuredClone(CONTROL_GATE),
      activation: { event: "phase-start", evaluation: "snapshot-once", canonical_condition_ids: ["controls"] },
      expiry: { event: "phase-end" },
    })),
  };
}

function branchEffectNode(branch: Record<string, unknown>): Node {
  const modifier: Node = { roll: branch.roll };
  if (branch.kind === "reroll") {
    if (branch.subset === "any") modifier.result_scope = "any-result";
    else modifier.subset = branch.subset;
  } else {
    modifier.operation = branch.operation;
    modifier.value = branch.value;
  }
  if (branch.weapon_keyword !== undefined) modifier.weapon_keyword = branch.weapon_keyword;
  return { type: branch.kind === "reroll" ? "re-roll" : "roll-modifier", target: "attacker", modifier };
}

/** One `default_branch`/`qualified_branch`: identical shape across the authored corpus but for its effect and whether the player may decline it. */
function branch(effectNode: Node, optional: boolean): Node {
  return {
    source: { role: "eligible-source", gate_ref: "beneficiary_gate" },
    beneficiary: { role: "eligible-beneficiary", gate_ref: "beneficiary_gate" },
    target: "attacker",
    timing: { event: "each-attack" },
    duration: "attack-resolution",
    effect: effectNode,
    optional,
  };
}

export function compileNamedRegionState(leaf: CompileLeaf): { effect: Node; behavior: string } {
  const p = leaf.parameters;
  const regionRef: Node = { region_id: closed(leaf, "region_id"), owner_faction: closed(leaf, "owner_faction") };
  const zones = fixedZones();

  const additiveExtensions: Node[] = [];
  const proximity = p.proximity_extension as { gate_ref: string; keywords: string[]; radius_inches: number } | undefined;
  if (proximity) {
    additiveExtensions.push({
      kind: "unit-proximity",
      source_gate: { gate_ref: proximity.gate_ref, owner: "owner-army", unit_predicate: { faction: regionRef.owner_faction, keywords: proximity.keywords } },
      radius_inches: proximity.radius_inches,
      activation: { event: "continuous" },
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
    ? { operator: "or", operands: [{ type: "has-keyword", parameters: { all_of: [qualifiedKeyword] } }, inRegion] }
    : inRegion;

  const beneficiaryGate: Node = {
    owner: "owner-army",
    ...(p.beneficiary_faction !== undefined ? { faction: closed(leaf, "beneficiary_faction") } : {}),
    operator: closed(leaf, "beneficiary_operator"),
    keywords: p.beneficiary_keywords,
  };

  const consumer: Node = {
    state_ref: structuredClone(regionRef),
    beneficiary_gate: beneficiaryGate,
    membership: { unit_scope: membershipScope, relation: "wholly-within" },
    qualified_condition: qualifiedCondition,
    default_branch: branch(branchEffectNode(p.default_branch as Record<string, unknown>), Boolean((p.default_branch as Record<string, unknown>).optional)),
    qualified_branch: branch(branchEffectNode(p.qualified_branch as Record<string, unknown>), Boolean((p.qualified_branch as Record<string, unknown>).optional)),
  };
  if (p.melee_or_visible_ranged === true) {
    consumer.attack_condition = {
      operator: "or",
      operands: [
        { type: "attack-is", parameters: { attack_type: "melee" } },
        { operator: "and", operands: [{ type: "attack-is", parameters: { attack_type: "ranged" } }, { type: "visible", parameters: { subject: "defender", to: "attacker" } }] },
      ],
    };
  }

  const modifier: Node = {
    region_ref: structuredClone(regionRef),
    producer: {
      region_ref: structuredClone(regionRef),
      mode: "complete",
      parent_ref: null,
      baseline: zones.baseline,
      phase_extensions: zones.phase_extensions,
      additive_extensions: additiveExtensions,
    },
    consumer,
    branch_precedence: "qualified-replaces-default",
  };
  if (!leaf.parameters.behavior) throw new CompileError("named-region-state needs a behavior (aura or passive).");
  return { effect: { type: "named-region-state", target: { owner: "friendly" }, modifier }, behavior: closed(leaf, "behavior") as string };
}
