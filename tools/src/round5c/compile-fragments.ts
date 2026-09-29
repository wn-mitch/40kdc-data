/**
 * One fixed DSL fragment per leaf family. The composition rules in `compile.ts` decide how the
 * fragments combine; nothing here depends on the other leaves of an ability.
 */

import { boardEffect } from "./compile-board-effects.js";
import { containerEffect } from "./compile-containers.js";
import { testEffect } from "./compile-test-effects.js";

export type CompileLeaf = {
  role: string;
  family_id: string;
  family_version: number;
  parameters: Record<string, unknown>;
  start_byte: number;
  /** Where the leaf's wording ends; with the source text it locates clause breaks. */
  end_byte?: number;
  fragment?: string;
};

export class CompileError extends Error {}

type Node = Record<string, unknown>;

const RESOURCE_POOLS: Record<string, string> = {
  "miracle-dice": "miracle-dice-pool", "fate-dice": "fate-dice-pool", "bloodshed-point": "bloodshed-point",
};

/** Whose models an effect changes. "The bearer" is this-model; leaves still spelling it bearer are on a retired version. */
const SUBJECT_TARGETS: Record<string, string> = { "this-unit": "this-unit", "this-model": "this-model" };

const MORTAL_TARGETS: Record<string, string> = { target: "defender", "that-unit": "selected-unit", "this-unit": "this-unit", "this-model": "this-model" };

const isSource = (value: unknown): boolean => value !== null && typeof value === "object" && "source" in value;

export function closed(leaf: CompileLeaf, name: string): unknown {
  const value = leaf.parameters[name];
  if (isSource(value)) throw new CompileError(`${leaf.family_id} ${name} is quoted source text; give it a listed value before it can compile.`);
  return value;
}

/** Rolls the attacker makes; when an attack targets this unit, modifiers to them belong to the attacker. */
const ATTACKER_ROLLS = new Set(["hit", "wound", "damage"]);

/**
 * One effect. `subject` is who the ability's own subject resolves to: the unit when a leader
 * is attached, else the family's subject parameter. `incoming` marks an effect on attacks that
 * target this unit, where the attacker's rolls are modified.
 */
export function effect(leaf: CompileLeaf, context: { attached: boolean; attacker?: string | null; incoming: boolean }): Node {
  const target = (subject: unknown) => {
    const found = SUBJECT_TARGETS[String(subject)];
    if (!found) throw new CompileError(`${leaf.family_id}@${leaf.family_version} subject ${JSON.stringify(subject)} has no DSL target; move the leaf to its current version.`);
    return context.attached ? "this-unit" : found;
  };
  const rollTarget = (roll: unknown) => context.incoming && ATTACKER_ROLLS.has(String(roll)) ? "attacker" : context.attacker ?? "this-unit";
  switch (leaf.family_id) {
    case "reroll": {
      const roll = closed(leaf, "roll");
      const subset = closed(leaf, "subset");
      const modifier: Node = subset === "ones" ? { roll, subset: "ones" } : subset === "failed" ? { roll, subset: "all-failures" } : { roll, result_scope: "any-result" };
      // Version 1 leaves have neither field; version 2 adds them, weapon_type defaulting to "all".
      const count = leaf.parameters.count === undefined ? undefined : closed(leaf, "count");
      if (count !== undefined) modifier.count = count;
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "re-roll", target: rollTarget(roll), modifier };
    }
    case "ignore-modifiers": {
      const what = closed(leaf, "what");
      const modifier: Node = { what };
      if (what === "characteristics") {
        const stats = leaf.parameters.stats as string[] | undefined;
        if (stats) modifier.stats = stats;
      } else {
        const rolls = leaf.parameters.rolls as string[] | undefined;
        if (rolls) modifier.rolls = rolls;
      }
      const only = leaf.parameters.only === undefined ? undefined : closed(leaf, "only");
      if (only) modifier.only = only;
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "ignore-modifiers", target: target(leaf.parameters.subject), modifier };
    }
    case "roll-auto-result": {
      const roll = closed(leaf, "roll");
      const outcome = closed(leaf, "outcome");
      const modifier: Node = { roll };
      if (outcome === "succeeds-on") modifier.succeeds_on = closed(leaf, "value");
      else if (outcome === "counts-as-6") modifier.result = 6;
      else modifier.result = "pass";
      const weaponType = leaf.parameters.weapon_type === undefined ? undefined : closed(leaf, "weapon_type");
      if (weaponType && weaponType !== "all") modifier.weapon_type = weaponType;
      return { type: "roll-result", target: rollTarget(roll), modifier };
    }
    case "end-attack-sequence":
      return { type: "end-attack-sequence", target: "attacker" };
    case "roll-modifier": {
      const roll = closed(leaf, "roll");
      return { type: "roll-modifier", target: rollTarget(roll), modifier: { roll, operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
    }
    case "critical-hit-threshold": {
      const value = closed(leaf, "value");
      if (typeof value !== "number") throw new CompileError("critical-hit-threshold needs a numeric threshold before it can compile.");
      const roll = leaf.parameters.roll === undefined ? "hit" : closed(leaf, "roll");
      return { type: "roll-result", target: rollTarget(roll), modifier: { roll, critical_on: value } };
    }
    case "resource-action": {
      const resource = closed(leaf, "resource");
      const amount = closed(leaf, "amount");
      if (closed(leaf, "operation") !== "gain") throw new CompileError(`Only resource gains compile; ${String(leaf.parameters.operation)} has no DSL fragment yet.`);
      if (resource === "command-point") return { type: "cp-gain", target: "this-model", modifier: { amount } };
      const pool = RESOURCE_POOLS[String(resource)];
      if (!pool) throw new CompileError(`Resource ${String(resource)} has no DSL pool yet.`);
      return { type: "resource-gain", target: "this-model", modifier: { pool, amount } };
    }
    case "characteristic-set":
      return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: "set", value: closed(leaf, "value") } };
    case "weapon-ability-grant": {
      const weaponType = closed(leaf, "weapon_type");
      const weaponName = leaf.parameters.weapon_name;
      const weaponKeyword = leaf.parameters.weapon_keyword;
      const ifPresent = leaf.parameters.if_present;
      const incoming = leaf.parameters.incoming;
      return {
        type: "weapon-ability-grant", target: target(leaf.parameters.subject),
        modifier: {
          abilities: [closed(leaf, "keyword")],
          ...(weaponType && weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(weaponName !== undefined ? { weapon_name: weaponName } : {}),
          ...(weaponKeyword !== undefined ? { weapon_keyword: weaponKeyword } : {}),
          ...(ifPresent !== undefined ? { if_present: ifPresent } : {}),
          ...(incoming === true ? { incoming: true } : {}),
        },
      };
    }
    case "core-ability-grant": {
      const value = leaf.parameters.value;
      return { type: "ability-grant", target: target(leaf.parameters.subject), modifier: { ability: closed(leaf, "ability"), ...(value !== undefined ? { value } : {}) } };
    }
    case "ability-record-grant": {
      const value = leaf.parameters.value;
      const rulesBundle = leaf.parameters.rules_bundle;
      return {
        type: "ability-grant", target: target(leaf.parameters.subject),
        modifier: { ability: closed(leaf, "ability"), ...(value !== undefined ? { value } : {}), ...(rulesBundle === true ? { rules_bundle: true } : {}) },
      };
    }
    case "keyword-grant": {
      const replaces = leaf.parameters.replaces;
      return { type: "keyword-grant", target: target(leaf.parameters.subject), modifier: { keywords: leaf.parameters.keywords, ...(replaces !== undefined ? { replaces } : {}) } };
    }
    case "weapon-grant": {
      const count = leaf.parameters.count;
      return { type: "weapon-grant", target: target(leaf.parameters.subject), modifier: { weapon_id: closed(leaf, "weapon_id"), ...(count !== undefined ? { count } : {}) } };
    }
    case "ability-modifier": {
      const p = leaf.parameters;
      return {
        type: "ability-modifier", target: target(p.subject),
        modifier: {
          ability: closed(leaf, "ability"), aspect: closed(leaf, "aspect"), operation: closed(leaf, "operation"),
          ...(p.value !== undefined ? { value: p.value } : {}),
          ...(p.cap !== undefined ? { cap: p.cap } : {}),
          ...(p.recipients !== undefined ? { recipients: p.recipients } : {}),
          ...(p.add_option !== undefined ? { add_option: p.add_option } : {}),
          ...(p.cap_per !== undefined ? { cap_per: p.cap_per } : {}),
          ...(p.not_same !== undefined ? { not_same: p.not_same } : {}),
          ...(p.consumes_shared_use !== undefined ? { consumes_shared_use: p.consumes_shared_use } : {}),
        },
      };
    }
    case "ability-activate": {
      const option = leaf.parameters.option;
      const exclusive = leaf.parameters.exclusive;
      return {
        type: "ability-activate", target: target(leaf.parameters.subject),
        modifier: { ability: closed(leaf, "ability"), ...(option !== undefined ? { option } : {}), ...(exclusive === true ? { exclusive: true } : {}) },
      };
    }
    case "feel-no-pain": {
      const against = closed(leaf, "against");
      return { type: "feel-no-pain", target: target(leaf.parameters.subject), modifier: { threshold: closed(leaf, "threshold"), ...(against !== "all" ? { against } : {}) } };
    }
    case "invulnerable-save":
      return { type: "invulnerable-save", target: target(leaf.parameters.subject), modifier: { invuln_sv: closed(leaf, "threshold") } };
    case "fights-first":
      return { type: "ability-grant", target: target(leaf.parameters.subject), modifier: { ability: "fights-first" } };
    case "sticky-objective":
      // Version 1 leaves carry no subject at all, and always meant this-unit.
      return { type: "objective-sticky", target: leaf.parameters.subject !== undefined ? closed(leaf, "subject") : "this-unit" };
    case "no-advance-roll":
      return { type: "move-modifier", target: target(leaf.parameters.subject), modifier: { advance: "fixed-6" } };
    case "mortal-wounds": {
      const count = String(closed(leaf, "count"));
      return { type: "mortal-wounds", target: MORTAL_TARGETS[String(closed(leaf, "recipient"))], modifier: { count: /^\d+$/u.test(count) ? Number(count) : count } };
    }
    case "fight-on-death": {
      const act = leaf.family_version >= 2 ? closed(leaf, "act") : "fight";
      // Shooting is a plain grant with no timing of its own: no resolution, removal, roll, or eligibility.
      if (act === "shoot") return { type: "act-on-death", target: target(leaf.parameters.subject), modifier: { act: "shoot" } };
      // The schema pairs each resolution with its removal; a roll or eligibility is folded in by compile-dice.
      return closed(leaf, "timing") === "when-its-unit-fights"
        ? { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "when-unit-fights", removal: "after-unit-fights-or-phase-end" } }
        : { type: "act-on-death", target: "event-object", modifier: { act: "fight", resolution: "after-attacking-unit-finishes", removal: "after-destroyed-model-fights" } };
    }
    case "act-after-move": {
      // Shooting after Advancing is [ASSAULT] on every ranged weapon (as Devastator Doctrine is
      // written); every other act is a permission after that move.
      const owner = target(leaf.parameters.subject);
      const acts = leaf.parameters.acts as string[];
      const steps: Record<string, unknown>[] = [];
      for (const move of leaf.parameters.moves as string[]) {
        for (const act of acts) {
          steps.push(move === "advance" && act === "shoot"
            ? { type: "weapon-ability-grant", target: owner, modifier: { abilities: ["Assault"], weapon_type: "ranged" } }
            : { type: "permission", target: owner, modifier: { activity: act === "charge" ? "declare-charge" : act, allow: true, after: [move] } });
        }
      }
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "regain-wounds": {
      const amount = String(closed(leaf, "amount"));
      const per = leaf.parameters.per;
      return { type: "heal", target: target(leaf.parameters.subject), modifier: { amount: /^\d+$/u.test(amount) ? Number(amount) : amount, ...(per ? { per } : {}) } };
    }
    case "characteristic-modifier": {
      if (leaf.family_version < 2) {
        return { type: "stat-modifier", target: target(leaf.parameters.subject), modifier: { stat: closed(leaf, "characteristic"), operation: closed(leaf, "operation"), value: closed(leaf, "value") } };
      }
      // The attack being made belongs to whoever attacks: the attacker when it targets this unit.
      const owner = leaf.parameters.subject === "attack" ? (context.incoming ? "attacker" : context.attacker ?? "this-unit") : target(leaf.parameters.subject);
      const weaponType = closed(leaf, "weapon_type");
      const steps = (leaf.parameters.characteristics as string[]).map((stat) => ({
        type: "stat-modifier", target: owner,
        modifier: { stat, operation: closed(leaf, "operation"), value: closed(leaf, "value"), ...(weaponType !== "all" ? { weapon_type: weaponType } : {}) },
      }));
      return steps.length === 1 ? steps[0]! : { type: "sequence", steps };
    }
    case "eligibility-permission": {
      const despite = leaf.parameters.despite as string[] | undefined;
      const asIf = leaf.parameters.as_if;
      const stratagem = leaf.parameters.stratagem;
      return {
        type: "permission", target: target(leaf.parameters.subject),
        modifier: {
          activity: closed(leaf, "activity"), allow: closed(leaf, "allow"),
          ...(despite && despite.length > 0 ? { despite } : {}),
          ...(asIf ? { as_if: asIf } : {}),
          ...(stratagem ? { stratagem } : {}),
        },
      };
    }
    case "targeting-restriction": {
      const subject = closed(leaf, "subject");
      const targetNode = subject === "enemy-units" ? { owner: "enemy" } : target(subject);
      const weaponType = closed(leaf, "weapon_type");
      const range = leaf.parameters.range;
      return {
        type: "targeting", target: targetNode,
        modifier: {
          may: closed(leaf, "may"), kind: closed(leaf, "kind"),
          ...(weaponType !== "all" ? { weapon_type: weaponType } : {}),
          ...(range != null ? { range: { inches: range } } : {}),
        },
      };
    }
    case "counts-as":
      return { type: "counts-as", target: target(leaf.parameters.subject), modifier: { within: { inches: closed(leaf, "within") } } };
    case "rule-state":
      return { type: "rule-state", target: target(leaf.parameters.subject), modifier: { direction: closed(leaf, "direction"), rule_kind: closed(leaf, "rule_kind"), rule: closed(leaf, "rule") } };
    case "damage-reduction": {
      const reductionRaw = String(closed(leaf, "reduction"));
      const reduction = /^\d+$/u.test(reductionRaw) ? Number(reductionRaw) : reductionRaw;
      const weaponType = closed(leaf, "weapon_type");
      return { type: "damage-reduction", target: target(leaf.parameters.subject), modifier: { reduction, ...(weaponType !== "all" ? { weapon_type: weaponType } : {}) } };
    }
    default: {
      const board = boardEffect(leaf, target);
      if (board) return board;
      const container = containerEffect(leaf);
      if (container) return container;
      const test = testEffect(leaf);
      if (test) return test;
      throw new CompileError(`Effect ${leaf.family_id} has no DSL fragment yet.`);
    }
  }
}
