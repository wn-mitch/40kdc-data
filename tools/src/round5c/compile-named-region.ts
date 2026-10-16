import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/**
 * `named-region-state` compiles a whole ability from one leaf (see `named-region-family.ts` for
 * why: the DSL shape is mostly a fixed template, with the region, its beneficiaries, and its two
 * branch effects parameterized). `compile.ts` calls `compileNamedRegionState` instead of its
 * ordinary leaf walk whenever a leaf list is exactly one `named-region-state` leaf.
 */

function controlGate(territory: string, fraction: number): Node {
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
function fixedZones(parameters: Node): { baseline: Node[]; phase_extensions: Node[] } {
  const baselineRegion = parameters.baseline_region as Node | undefined;
  const phaseExtensions = parameters.phase_extensions;
  if (Array.isArray(phaseExtensions)) {
    return {
      baseline: [{ region: structuredClone(baselineRegion ?? { territory: "your-deployment-zone" }), duration: "permanent" }],
      phase_extensions: structuredClone(phaseExtensions) as Node[],
    };
  }
  return {
    baseline: [{ region: { territory: "your-deployment-zone" }, duration: "permanent" }],
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

function branchEffectNode(branch: Record<string, unknown>): Node {
  const modifier: Node = { roll: branch.roll };
  if (branch.kind === "reroll") {
    if (branch.subset === "any") modifier.result_scope = "any-result";
    else modifier.subset = branch.subset;
  } else {
    modifier.operation = branch.operation;
    modifier.value = branch.value;
  }
  if (branch.weapon_keyword !== undefined) modifier.weapons = { keyword: { all_of: [branch.weapon_keyword] } };
  return { type: branch.kind === "reroll" ? "re-roll" : "roll-modifier", target: "attacker", modifier };
}

/** A branch is an ability part; its attack context is carried by the enclosing consumer. */
function branch(effectNode: Node, optional: boolean): Node {
  return {
    type: "ability-part",
    effect: effectNode,
    optional,
  };
}

export function compileNamedRegionState(leaf: CompileLeaf): { effect: Node; behavior: string } {
  const p = leaf.parameters;
  const regionRef: Node = { region_id: closed(leaf, "region_id"), owner_faction: closed(leaf, "owner_faction") };
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

  const beneficiaryFilter: Node = {
    owner: "friendly",
    ...(p.beneficiary_operator === "and" ? { all_of: [...(p.beneficiary_keywords as string[])] } : { any_of: [...(p.beneficiary_keywords as string[])] }),
  };

  const consumer: Node = {
    state_ref: structuredClone(regionRef),
    eligibility: beneficiaryFilter,
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
        { operator: "and", operands: [{ type: "attack-is", parameters: { attack_type: "ranged" } }, { type: "matches", parameters: { subject: "defender", filter: { visible: { to: "attacker" } } } }] },
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
