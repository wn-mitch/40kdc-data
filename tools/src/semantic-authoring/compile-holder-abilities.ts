import { ANTECEDENT } from "./antecedent-families.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "Units with this ability": a unit-has-ability leaf about the unit-filter right before it
 * qualifies that filter, so every claim on the filter (a selection, an engagement's other unit, a
 * moment's subject, a grant's recipients) carries the ability. This runs before anaphors bind;
 * otherwise "with this ability" binds to whatever unit the record names earlier.
 *
 * Holders of the record's own ability are friendly when no owner is printed. A rule about "one or
 * more units with this ability" resolves once for the army, not once per holder: such a holder
 * filter is an existential over the army's holders, and the record gets an army allowance where
 * its window implies a frequency (`holderAllowance`).
 */

type Node = Record<string, unknown>;

/** The ability "this ability" names: the record's own id, or the canonical record a duplicate stands for (own-abilities.ts). */
function ownAbility(leaf: CompileLeaf, abilityId: string | undefined): string {
  if (abilityId === undefined) throw new CompileError(`unit-has-ability at byte ${leaf.start_byte} names this ability, but the compiler was given no record id to bind it to.`);
  return abilityId;
}

/** A has-ability leaf with `own` resolved to an id. */
function resolved(leaf: CompileLeaf, abilityId: string | undefined): CompileLeaf {
  if (leaf.family_id !== "unit-has-ability" || leaf.parameters.own !== true) return leaf;
  const { own: _own, ...rest } = leaf.parameters;
  return { ...leaf, parameters: { ...rest, ability: ownAbility(leaf, abilityId) } };
}

/** Whether the source between two leaves is only spacing and bold markers. */
function connective(sourceText: string | undefined, left: CompileLeaf, right: CompileLeaf): boolean {
  if (sourceText === undefined || left.end_byte === undefined) return true;
  if (right.start_byte < left.end_byte) return false;
  return /^[\s*]*$/u.test(Buffer.from(sourceText, "utf8").subarray(left.end_byte, right.start_byte).toString("utf8"));
}

/** A unit-filter right before another that names the same units with it (a stack or alternatives): same fragment, side and level. */
function sameGroup(before: CompileLeaf, filter: CompileLeaf): boolean {
  const sides = new Set([before.parameters.side, filter.parameters.side].filter((value) => value !== "any"));
  return before.family_id === "unit-filter" && before.fragment === filter.fragment && sides.size <= 1
    && (before.parameters.level ?? "unit") === (filter.parameters.level ?? "unit");
}

const sortedUnion = (left: unknown, right: readonly string[]) => [...new Set([...((left as string[] | undefined) ?? []), ...right])].sort();

/**
 * Fold each "with this ability" (unit-has-ability, subject antecedent) into the unit-filter right
 * before it: same fragment, nothing between but "from your army" leaves and spacing. Positive
 * becomes the filter's compile-internal `abilities` (the DSL's has_ability), negated its
 * `excluded_abilities` (lacks_ability). A has-ability with its own subject, or with no filter
 * right before it, is left to lower as a condition. `own: true` resolves to `abilityId`.
 */
export function foldHolderAbilities(input: readonly CompileLeaf[], sourceText: string | undefined, abilityId: string | undefined): CompileLeaf[] {
  const list = input.map((leaf) => resolved(leaf, abilityId));
  const out: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.family_id !== "unit-has-ability" || leaf.parameters.subject !== ANTECEDENT) { out.push(leaf); continue; }
    let at = out.length - 1;
    while (at >= 0 && out[at]!.family_id === "unit-owner" && out[at]!.fragment === leaf.fragment) at -= 1;
    const filter = out[at];
    const chain = out.slice(at, out.length);
    if (filter?.family_id !== "unit-filter" || filter.fragment !== leaf.fragment
      || ![...chain, leaf].every((item, index, all) => index === 0 || connective(sourceText, all[index - 1]!, item))) {
      out.push(leaf);
      continue;
    }
    const ability = String(leaf.parameters.ability);
    const negated = leaf.parameters.negated === true;
    const own = abilityId !== undefined && ability === abilityId;
    // Holders of this ability with no printed owner are the army's own units.
    const side = !negated && own && filter.parameters.side === "any" ? "friendly" : String(filter.parameters.side);
    const owners = chain.slice(1);
    if (owners.some((owner) => owner.parameters.owner !== side)) {
      throw new CompileError(`A "from your army" names a side other than its unit-filter's (${side}) before "with the ${ability} ability".`);
    }
    // "An ALPHA or BETA unit with this ability", "units (excluding X) with this ability": every
    // filter of the run the leaf ends qualifies, so alternatives keep one requirement in common.
    let first = at;
    while (first > 0 && sameGroup(out[first - 1]!, filter)) first -= 1;
    const key = negated ? "excluded_abilities" : "abilities";
    const other = negated ? "abilities" : "excluded_abilities";
    for (let index = first; index <= at; index += 1) {
      const parameters: Node = { ...out[index]!.parameters };
      if (!negated && own && parameters.side === "any") parameters.side = side;
      if (((parameters[other] as string[] | undefined) ?? []).includes(ability)) throw new CompileError(`A unit-filter both requires and excludes the ${ability} ability.`);
      parameters[key] = sortedUnion(parameters[key], [ability]);
      out[index] = { ...out[index]!, parameters };
    }
    // The leaf itself is folded away; any "from your army" stays after the filter, as after a
    // single filter. With nothing between, the filter's wording runs through "with this ability".
    if (owners.length === 0) out[at] = { ...out[at]!, end_byte: leaf.end_byte };
  }
  return out;
}

/** The DSL unit-filters an existential claim holds: a distance's or engagement's other unit, a presence condition's or a moment's units. */
function existentialFilters(leaf: CompileLeaf): Node[] {
  if (leaf.role !== "CONDITION" && leaf.role !== "EVENT") return [];
  const filters: unknown[] = [leaf.parameters.following_filter];
  // A condition on the units of a bare filter ("if one or more models … are on the battlefield")
  // and the subject of a moment ("after one model from your army with this ability has shot").
  if (leaf.role === "CONDITION" || leaf.family_id === "event") filters.push(leaf.parameters.subject_filter);
  return filters.filter((item): item is Node => item !== null && typeof item === "object");
}

/** Whether a folded leaf list holds the record's own ability holders as an existential over the army. */
export function holdsArmyHolders(list: readonly CompileLeaf[], abilityId: string | undefined): boolean {
  if (abilityId === undefined) return false;
  return list.some((leaf) => existentialFilters(leaf).some((filter) => filter.owner === "friendly"
    && Array.isArray(filter.has_ability) && (filter.has_ability as string[]).includes(abilityId)));
}

/** The once-per frequency a trigger's moment implies, or null when it can recur within its period ("each time …"). */
function triggerFrequency(trigger: Node): string | null {
  switch (trigger.event) {
    case "phase-started": case "phase-ended": return "once-per-phase";
    case "turn-started": case "turn-ended": return "once-per-turn";
    case "round-started": case "round-ended": return "once-per-battle-round";
    default: return null;
  }
}

/**
 * The army allowance for a record about the army's holders of its ability, when its window implies
 * a frequency: its moments (a phase, turn or round boundary), else its phase-window ("In your
 * Command phase"). A record whose moment can recur ("each time …") gets none: the existential
 * filter alone says one test per enemy unit.
 */
export function holderAllowance(list: readonly CompileLeaf[], triggers: readonly Node[]): Node | null {
  const frequencies = new Set<string | null>(triggers.map(triggerFrequency));
  if (triggers.length === 0) {
    const windows = list.filter((leaf) => leaf.family_id === "phase-window" && leaf.parameters.phase !== "any");
    for (const window of windows) frequencies.add(window.parameters.phase === undefined ? "once-per-turn" : "once-per-phase");
  }
  if (frequencies.size !== 1) return null;
  const frequency = [...frequencies][0];
  return frequency ? { frequency, per: "army" } : null;
}

/**
 * A record about the army's holders of its own ability: its usage is per army (a printed "Once
 * per turn" included), and with no printed usage it gets the allowance its window implies.
 */
export function applyHolderAllowance(list: readonly CompileLeaf[], triggers: readonly Node[], abilityId: string | undefined, usages: Node[], scopes: Set<string>): void {
  if (!holdsArmyHolders(list, abilityId)) return;
  if (usages.length === 0) {
    const allowance = holderAllowance(list, triggers);
    if (!allowance) return;
    usages.push(allowance);
  }
  scopes.add("army");
}
