/**
 * "performs an Agile Manoeuvre that involves rolling a D6, add 1 to the result": a
 * manoeuvre-own-roll condition folds into the used-manoeuvre moment before it as manoeuvre_ids, the
 * manoeuvres of the faction's menus whose own move rolls that die. The trigger then needs one of
 * them (compile-triggers.ts). A roll-modifier with roll manoeuvre is refused unless such a moment
 * sits before it in its own clause, so the change never lands on every manoeuvre.
 */

import { fileURLToPath } from "node:url";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { menuActionsForAbility, type ManoeuvreMenus } from "./named-ability-checks.js";

export type ManoeuvreMenuLookup = (die: string) => ManoeuvreMenus | null;

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../../../data", import.meta.url));

/** The faction's menus for the record's ability (its enrichment file), or null when none holds it. */
export function manoeuvreLookupFor(abilityId: string | undefined, dataRoot = DEFAULT_DATA_ROOT): ManoeuvreMenuLookup {
  return (die) => abilityId === undefined ? null : menuActionsForAbility(dataRoot, abilityId, die as "D6");
}

/** Whether a leaf needs this fold: a manoeuvre-own-roll condition, or a roll-modifier or re-roll of a manoeuvre. */
export function hasManoeuvreRoll(list: readonly CompileLeaf[]): boolean {
  return list.some((leaf) => leaf.family_id === "manoeuvre-own-roll" || ((leaf.family_id === "roll-modifier" || leaf.family_id === "reroll") && leaf.parameters.roll === "manoeuvre"));
}

/**
 * A re-roll of a manoeuvre's own dice needs a manoeuvre moment in its clause: an earlier used-manoeuvre
 * event, or an ability-used of a manoeuvre in progress anywhere in the clause (the in-progress
 * clause may follow the re-roll in its sentence). A plain used-manoeuvre ability-used before the roll
 * is not enough (see checkManoeuvreRollMoments for the roll-modifier).
 */
function reRollHasMoment(list: readonly CompileLeaf[], index: number): boolean {
  const roll = list[index]!;
  const before = list.slice(0, index).some((leaf) => leaf.fragment === roll.fragment && leaf.family_id === "event"
    && leaf.parameters.kind === "used" && leaf.parameters.activity === "manoeuvre");
  const during = list.some((leaf) => leaf.fragment === roll.fragment && leaf.family_id === "ability-used"
    && leaf.parameters.activity === "manoeuvre" && leaf.parameters.window === "now" && leaf.parameters.negated !== true);
  return before || during;
}

/** Each re-roll of a manoeuvre roll has a manoeuvre moment in its clause (reRollHasMoment). */
export function checkManoeuvreRollMoments(list: readonly CompileLeaf[]): void {
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "reroll" || leaf.parameters.roll !== "manoeuvre") return;
    if (!reRollHasMoment(list, index)) throw new CompileError(`re-roll of a manoeuvre roll at byte ${leaf.start_byte} has no manoeuvre moment in its clause.`);
  });
}

/** Folds each manoeuvre-own-roll into its used-manoeuvre moment, then checks each manoeuvre roll has one. */
export function foldManoeuvreOwnRoll(list: readonly CompileLeaf[], lookup: ManoeuvreMenuLookup | undefined): CompileLeaf[] {
  if (!hasManoeuvreRoll(list)) return [...list];
  const out: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.family_id !== "manoeuvre-own-roll") {
      out.push(leaf);
      continue;
    }
    let at = out.length - 1;
    while (at >= 0 && out[at]!.fragment !== leaf.fragment) at -= 1;
    const moment = at >= 0 ? out[at] : undefined;
    if (moment?.family_id !== "event" || moment.parameters.kind !== "used" || moment.parameters.activity !== "manoeuvre") {
      throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} names a manoeuvre, but no used-manoeuvre moment sits before it in its clause.`);
    }
    if (moment.parameters.id !== undefined || moment.parameters.subject !== undefined) {
      throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} names the manoeuvres of a moment that already names one or a subject.`);
    }
    if (lookup === undefined) throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} names the manoeuvres of the faction's menus, and this record has no faction to read them from.`);
    const menus = lookup(String(leaf.parameters.die));
    if (menus === null) throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} needs the faction's resource-action menus, and no faction holds this ability.`);
    if (menus.withDie.length === 0) throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} finds no manoeuvre whose own move rolls ${String(leaf.parameters.die)}.`);
    if (menus.withDie.length === menus.actions.length) throw new CompileError(`manoeuvre-own-roll at byte ${leaf.start_byte} names every manoeuvre of the menus; drop it.`);
    out[at] = { ...moment, parameters: { ...moment.parameters, manoeuvre_ids: [...menus.withDie] } };
  }
  checkManoeuvreRollMoments(out);
  out.forEach((leaf, index) => {
    if (leaf.family_id !== "roll-modifier" || leaf.parameters.roll !== "manoeuvre") return;
    const bound = out.slice(0, index).some((item) => item.fragment === leaf.fragment && item.parameters.manoeuvre_ids !== undefined);
    if (!bound) throw new CompileError(`roll-modifier of a manoeuvre roll at byte ${leaf.start_byte} has no manoeuvre-own-roll moment before it in its clause.`);
  });
  return out;
}
