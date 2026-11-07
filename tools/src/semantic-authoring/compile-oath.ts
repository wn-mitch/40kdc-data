import type { Compiled } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { CompileError } from "./compile-error.js";
import { ordered, shapeSignature } from "./compile-placement.js";
import { joinSegments } from "./compile-segments.js";
import type { Mechanics } from "./entries.js";
import { normalizeOathParameters } from "./oath-families.js";

type Node = Record<string, unknown>;
type CompilePart = (leaves: readonly CompileLeaf[]) => Compiled;
const SELECTION_KEYS: Record<string, string> = {
  "oath-selection-history": "exclude_previously_selected",
  "oath-duplicate-result": "duplicate_roll",
  "oath-exhaustion": "stop_when",
};
const POLICY_FAMILIES: Record<string, true> = {
  "oath-selection-history": true, "oath-duplicate-result": true, "oath-exhaustion": true,
  "oath-quality-persistence": true, "oath-deed-reward": true, "oath-reward-selection": true,
};

function parameters(leaf: CompileLeaf): Node {
  try {
    const normalized = normalizeOathParameters(leaf.family_id, leaf.parameters);
    if (normalized === null) throw new CompileError(`Unknown Oath family ${leaf.family_id}.`);
    return normalized;
  } catch (error) {
    if (error instanceof TypeError) throw new CompileError(error.message);
    throw error;
  }
}

export function oathCondition(leaf: CompileLeaf): Node | undefined {
  if (leaf.family_id !== "oath-fulfilled") return undefined;
  return { type: "oath-state", parameters: { ability: parameters(leaf).ability, state: "fulfilled" } };
}

/** Resolve the parent's real procedure; its choices and rewards remain owned by that rule. */
export function oathEffect(leaf: CompileLeaf): Node | undefined {
  if (leaf.family_id !== "oath-determine") return undefined;
  const p = parameters(leaf);
  return { type: "ability-activate", target: p.subject, modifier: { ability: p.ability, procedure: "oath" } };
}

function persistence(leaf: CompileLeaf): Node {
  const p = parameters(leaf);
  return {
    type: "oath-modifier",
    target: { owner: p.owner, level: "model", has_ability: [p.recipient_ability] },
    modifier: { ability: p.ability, aspect: "quality-persistence", from: "fulfilled", ...(p.duration === undefined ? {} : { duration: p.duration }) },
  };
}

/**
 * Domain policies are independent of the moment that repeats the procedure. Extract them before
 * ordinary condition/trigger composition, then rejoin as untriggered siblings. Reward content is
 * compiled by the existing compiler: this helper supplies only its reviewed replacement boundary.
 */
export function compileOathRecord(leaves: readonly CompileLeaf[], sourceText: string | undefined, compilePart: CompilePart): Compiled | null {
  if (!leaves.some((leaf) => POLICY_FAMILIES[leaf.family_id])) return null;
  const list = ordered(leaves);
  const signature = shapeSignature(list, sourceText);
  try {
    const remaining: CompileLeaf[] = [];
    const effects: Node[] = [];
    const selections = new Map<string, Node>();
    for (let index = 0; index < list.length; index += 1) {
      const leaf = list[index]!;
      const key = SELECTION_KEYS[leaf.family_id];
      if (key) {
        const p = parameters(leaf);
        const binding = JSON.stringify([p.ability, p.subject, p.domains]);
        let modifier = selections.get(binding);
        if (!modifier) {
          modifier = { ability: p.ability, aspect: "selection", domains: p.domains };
          selections.set(binding, modifier);
          effects.push({ type: "oath-modifier", target: p.subject, modifier });
        }
        if (modifier[key] !== undefined) throw new CompileError(`Duplicate Oath selection policy ${leaf.family_id}.`);
        modifier[key] = key === "exclude_previously_selected" ? true : key === "duplicate_roll" ? "choose-unselected" : "all-domains-exhausted";
        // A separately reviewed trailing replacement word qualifies this duplicate policy,
        // not the earlier procedure activation or the later Deed reward.
        const following = list[index + 1];
        if (leaf.family_id === "oath-duplicate-result" && following?.family_id === "instead"
          && following.parameters.choice !== true && following.fragment === leaf.fragment) {
          if (sourceText !== undefined && (leaf.end_byte === undefined
            || !/^\s*$/u.test(Buffer.from(sourceText, "utf8").subarray(leaf.end_byte, following.start_byte).toString("utf8")))) {
            throw new CompileError("An Oath duplicate-result replacement word must immediately follow its policy.");
          }
          index += 1;
        }
      } else if (leaf.family_id === "oath-quality-persistence") {
        effects.push(persistence(leaf));
      } else if (leaf.family_id === "oath-deed-reward") {
        const p = parameters(leaf);
        const instead = list[index + 1];
        const reward = list[index + 2];
        const method = list[index + 3];
        if (instead?.family_id !== "instead" || instead.parameters.choice === true || reward?.role !== "EFFECT" || method?.family_id !== "oath-reward-selection") {
          throw new CompileError("An Oath deed reward needs an adjacent replacement connective, one reward effect, and a reviewed selection-method qualifier.");
        }
        if ([instead, reward, method].some((item) => item.fragment !== leaf.fragment)) {
          throw new CompileError("An Oath deed reward cannot cross source fragments.");
        }
        const selectionMethod = parameters(method).method;
        const compiled = compilePart([reward]);
        if (!compiled.ok) return { ...compiled, signature };
        const mechanics = compiled.mechanics as unknown as Node;
        if (mechanics.trigger != null || mechanics.usage != null || compiled.core || compiled.checks.length) {
          throw new CompileError("An Oath reward must be an effect, not an independently triggered or core-changing rule.");
        }
        effects.push({
          type: "oath-modifier", target: p.subject,
          modifier: { ability: p.ability, aspect: "deed-reward", applies_to: p.applies_to, operation: "replace", selection_method: selectionMethod, effect: mechanics.effect },
        });
        index += 3;
      } else if (leaf.family_id === "oath-reward-selection") {
        throw new CompileError("An Oath reward selection-method qualifier has no adjacent deed reward.");
      } else {
        remaining.push(leaf);
      }
    }
    const results: Extract<Compiled, { ok: true }>[] = [];
    if (remaining.length) {
      const active = compilePart(remaining);
      if (!active.ok) return { ...active, signature };
      results.push(active);
    }
    for (const effect of effects) {
      results.push({ ok: true, signature, mechanics: { effect, behavior: "passive", trigger: null, scope: { duration: "permanent" } } as unknown as Mechanics, checks: [] });
    }
    const joined = joinSegments(results);
    if (joined.errors.length) return { ok: false, signature, errors: joined.errors };
    return { ok: true, signature, mechanics: joined.mechanics, checks: joined.checks, ...(joined.core ? { core: joined.core } : {}) };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
}
