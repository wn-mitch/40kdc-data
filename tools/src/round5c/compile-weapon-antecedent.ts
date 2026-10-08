import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A weapon-scoped stat adjustment must name the weapon it changes. "select one of this model's
 * Plasma rifle weapons ... That weapon's attacks have: +2 S" binds the weapon with select-weapon,
 * and the adjustment carries `weapon: antecedent`, resolved here to the bind name as `weapon_var`.
 *
 * A record with a select-weapon refuses any weapon-scoped adjustment that names no weapon: the
 * compiler would otherwise apply it to every weapon of that type while the select binds one.
 */
const isAntecedent = (leaf: CompileLeaf) => leaf.parameters.weapon === "antecedent";

function nearestBinder(earlier: readonly CompileLeaf[]): CompileLeaf | undefined {
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    if (earlier[index]!.family_id === "select-weapon") return earlier[index];
  }
  return undefined;
}

export function bindWeaponAntecedents(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "select-weapon")) {
    if (list.some(isAntecedent)) throw new CompileError("weapon: antecedent has no select-weapon in this ability to bind.");
    return [...list];
  }
  const bound = new Set<string>();
  const result: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.family_id === "select-weapon") {
      const name = String(leaf.parameters.bind_as);
      if (bound.has(name)) throw new CompileError(`select-weapon binds ${name} more than once in this ability.`);
      bound.add(name);
      result.push(leaf);
      continue;
    }
    if (!isAntecedent(leaf)) {
      result.push(leaf);
      continue;
    }
    const binder = nearestBinder(result);
    if (!binder) throw new CompileError("weapon: antecedent has no earlier select-weapon to bind.");
    if (binder.parameters.count !== undefined && binder.parameters.count !== 1) {
      throw new CompileError("weapon: antecedent refers to one selected weapon; the select-weapon binds several.");
    }
    const { weapon: _weapon, ...parameters } = leaf.parameters;
    result.push({ ...leaf, parameters: { ...parameters, weapon_var: String(binder.parameters.bind_as) } });
  }
  for (const leaf of result) {
    if (leaf.family_id !== "characteristic-modifier" || leaf.parameters.weapon_var !== undefined) continue;
    const weaponType = leaf.parameters.weapon_type;
    const named = leaf.parameters.weapon_name !== undefined || leaf.parameters.weapon_keyword !== undefined;
    if (weaponType !== undefined && weaponType !== "all" && !named) {
      throw new CompileError("A weapon-scoped stat adjustment in a record that selects a weapon must name that weapon with weapon: antecedent.");
    }
  }
  return result;
}
