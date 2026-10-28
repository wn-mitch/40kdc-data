import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isContainerOpener } from "./compile-containers.js";

type Node = Record<string, unknown>;

/**
 * Activating the options of an option-bearing rule (`ability-activate`, families/abilities.ts).
 *
 * "select one Plague. … that enemy unit has the effect of that Plague": the activation names the
 * option picked earlier (`chosen`), and the optionless `choice-open` before it is that pick, not a
 * menu of its own. "make a Blessings of Khorne roll and use the results to activate one Blessing
 * of Khorne. … that Blessing of Khorne is active": an optionless `dice-pool-allocation-open` is a
 * pick by roll the same way. `foldActivationPicks` hands the pick to the activation and drops the
 * opener, so the container planner never sees a menu with no options.
 */

/** The pick an optionless opener makes, held on the activation from here on. */
const PICKED = "picked";

/** ignore_consumed: the pick may take an option a once-per-battle selection already used. */
type Pick = { by: "player" | "roll"; count: number; ignore_consumed?: true };

/** Openers that are an activation's earlier pick when no named option follows them. */
const PICK_OPENERS = new Set(["choice-open", "dice-pool-allocation-open"]);

/** Whether any named option follows the opener at `at`, before the next opener: then it is a menu. */
function hasOptions(list: readonly CompileLeaf[], at: number): boolean {
  for (let cursor = at + 1; cursor < list.length && !isContainerOpener(list[cursor]!.family_id); cursor += 1) {
    if (list[cursor]!.family_id === "named-option") return true;
  }
  return false;
}

/**
 * The index of the optionless opener an activation's pick folds in: the nearest earlier
 * choice-open or dice-pool-allocation-open, with no other opener or activation between them and
 * no named option after it; -1 when none.
 */
function pickBefore(list: readonly CompileLeaf[], index: number): number {
  for (let at = index - 1; at >= 0; at -= 1) {
    const leaf = list[at]!;
    if (PICK_OPENERS.has(leaf.family_id)) return hasOptions(list, at) ? -1 : at;
    if (leaf.family_id === "ability-activate" || isContainerOpener(leaf.family_id)) return -1;
  }
  return -1;
}

/**
 * Who picks and how many: a choice-open's player picks max_choices (equal to min_choices when
 * both are given); a dice pool's roll activates max_activations.
 */
function pickOf(opener: CompileLeaf): Pick {
  if (opener.family_id === "dice-pool-allocation-open") return { by: "roll", count: Number(closed(opener, "max_activations")) };
  const min = opener.parameters.min_choices;
  const max = opener.parameters.max_choices;
  if (min !== undefined && max !== undefined && min !== max) throw new CompileError("An activation's earlier pick must name one number of options (min_choices equal to max_choices).");
  return { by: "player", count: Number(max ?? min ?? 1), ...(opener.parameters.ignore_consumed === true ? { ignore_consumed: true as const } : {}) };
}

/**
 * Fold each `chosen` (or `choose`) activation's earlier optionless opener into it. A `chosen`
 * activation with no such pick before it refuses compilation: it names an option nothing picked.
 * A `choose` activation is the player's own pick, so an opener before it must be a choice-open
 * picking the same number.
 */
export function foldActivationPicks(list: readonly CompileLeaf[]): CompileLeaf[] {
  const dropped = new Set<number>();
  const out = list.map((leaf, index) => {
    if (leaf.family_id !== "ability-activate" || (leaf.parameters.chosen === undefined && leaf.parameters.choose === undefined)) return leaf;
    const at = pickBefore(list, index);
    if (at < 0) {
      if (leaf.parameters.chosen !== undefined) throw new CompileError(NO_PICK);
      return leaf;
    }
    const pick = pickOf(list[at]!);
    const choose = leaf.parameters.choose as { count: number } | undefined;
    if (choose && (pick.by !== "player" || choose.count !== pick.count)) {
      throw new CompileError(`ability-activate choose is the player's pick of ${choose.count} option(s), but the ${list[at]!.family_id} before it picks ${pick.count} by ${pick.by}.`);
    }
    dropped.add(at);
    if (choose && pick.ignore_consumed === undefined) return leaf;
    return { ...leaf, parameters: { ...leaf.parameters, [PICKED]: pick } };
  });
  return out.filter((_leaf, index) => !dropped.has(index));
}

const NO_PICK = "ability-activate chosen names the option picked earlier, but no optionless choice-open or dice-pool-allocation-open before it picks one.";

/**
 * The DSL modifier of an ability-activate leaf. Version 1 is additive unless `exclusive`; later
 * versions replace the unit's active option (`exclusive`) unless `additive`. Every option is then
 * active together (`all_options`) with nothing left to replace.
 */
export function activationModifier(leaf: CompileLeaf): Node {
  const p = leaf.parameters;
  const modifier: Node = { ability: closed(leaf, "ability") };
  if (p.option !== undefined) modifier.option = p.option;
  if (p.options !== undefined) modifier.options = [...(p.options as string[])];
  if (p.all_options === true) modifier.all_options = true;
  const choose = p.choose as { count: number; from?: string[] } | undefined;
  const picked = p[PICKED] as Pick | undefined;
  if (p.chosen === true && picked === undefined) throw new CompileError(NO_PICK);
  const pick: Pick | undefined = choose ? { by: "player", count: choose.count } : picked;
  if (pick) modifier.select = { by: pick.by, ...(pick.count > 1 ? { count: pick.count } : {}), ...(choose?.from ? { from: [...choose.from] } : {}) };
  const hasOptions = p.option !== undefined || p.options !== undefined || pick !== undefined;
  const exclusive = leaf.family_version === 1 ? p.exclusive === true : hasOptions && p.additive !== true;
  if (exclusive) modifier.exclusive = true;
  if (picked?.ignore_consumed === true || p.ignore_consumed === true) modifier.ignore_consumed = true;
  return modifier;
}

/** Keys whose "this-unit" names the unit a menu option is about. */
const UNIT_KEYS = new Set(["target", "member_of"]);

/**
 * "select one of the following rules. Until the end of the phase, that unit has that rule": a
 * menu whose holder is another unit (chosen-option-grant holder bound to it). Everything an option
 * says about "this unit" is then about the holder.
 */
export function retargetMenu(node: unknown, holder: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => retargetMenu(item, holder));
  if (node === null || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  // "Each time a model in this unit makes a ranged attack" lowers to a bare attack-type gate whose
  // attacker is the record's own unit. For units a filter names, the gate names them as the attacker.
  if (typeof holder === "object" && holder !== null && record.type === "attack-is") {
    return { operator: "and", operands: [record, { type: "matches", parameters: { filter: holder, subject: "attacker" } }] };
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    if (UNIT_KEYS.has(key) && value === "this-unit") return [key, holder];
    // A granted definition is the grantee's own ability: its "this unit" is each unit it is granted to, not the holder.
    if (key === "definition") return [key, value];
    // "That Vow is active for friendly K units" + "Friendly INFANTRY units have: …": the option's friendly
    // units are the holders among them, so a keyword-only friendly filter narrows to the holder's keywords too.
    if (UNIT_KEYS.has(key)) {
      const narrowed = holderNarrowing(value, holder);
      if (narrowed !== undefined) return [key, narrowed];
    }
    return [key, retargetMenu(value, holder)];
  }));
}

/** Keys a keyword-only unit filter may hold: no range, designation or relation that names other units. */
const KEYWORD_FILTER_KEYS = new Set(["owner", "all_of", "level"]);

/**
 * A friendly keyword-only filter inside a menu whose holder is a friendly keyword-only filter, joined
 * with it (all_of of both); undefined for anything else, which stays as printed.
 */
function holderNarrowing(value: unknown, holder: unknown): Record<string, unknown> | undefined {
  const keywordOnly = (filter: unknown): filter is { owner: string; all_of?: string[]; level?: string } =>
    filter !== null && typeof filter === "object" && !Array.isArray(filter) && (filter as Record<string, unknown>).owner === "friendly"
    && Object.keys(filter).every((key) => KEYWORD_FILTER_KEYS.has(key));
  if (!keywordOnly(value) || !keywordOnly(holder) || holder.level !== undefined) return undefined;
  const all_of = [...new Set([...(holder.all_of ?? []), ...(value.all_of ?? [])])];
  return { ...value, ...(all_of.length > 0 ? { all_of } : {}) };
}
