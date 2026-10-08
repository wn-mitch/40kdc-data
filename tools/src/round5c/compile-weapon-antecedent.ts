import { ANTECEDENT } from "./antecedent-families.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "that weapon" (`weapon: antecedent`), bound before the record's other folds.
 *
 * - weapon-ability-grant: the weapon the record's one earlier select-weapon bound. The grant takes
 *   that weapon's type and carries `weapon_var` (the bind name), which the effect reads as a
 *   weapon_ref. Refused: no earlier select-weapon, more than one, a select that binds several
 *   weapons, a select without a weapon type, a select on another target, or a stated type that
 *   differs from the bound one.
 * - attack-filter: the attacks made with the weapons the nearest earlier keyword grant gave that
 *   keyword. The filter becomes an attack-is over that keyword, with the grant's weapon type as
 *   attack_type (none when the grant says all). Refused: no earlier keyword grant, or a stated
 *   attack_type that differs.
 *
 * Other families that carry `weapon: antecedent` are left for their own binding.
 */

const SELECT = "select-weapon";
const GRANT = "weapon-ability-grant";
const FILTER = "attack-filter";

export function bindWeaponAntecedents(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => (leaf.family_id === GRANT || leaf.family_id === FILTER) && leaf.parameters.weapon === ANTECEDENT)) return [...list];
  // Bound leaves replace their originals in record order, so a later leaf sees the bound form of an earlier one.
  const bound: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.parameters.weapon !== ANTECEDENT || (leaf.family_id !== GRANT && leaf.family_id !== FILTER)) {
      bound.push(leaf);
    } else if (leaf.family_id === GRANT) {
      bound.push(bindGrant(leaf, bound));
    } else {
      bound.push(bindAttacks(leaf, bound));
    }
  }
  return bound;
}

function bindGrant(leaf: CompileLeaf, earlier: readonly CompileLeaf[]): CompileLeaf {
  const selects = earlier.filter((item) => item.family_id === SELECT);
  if (selects.length === 0) throw new CompileError("\"That weapon\" has no earlier select-weapon to name the weapon it gives the ability to.");
  if (selects.length > 1) throw new CompileError("\"That weapon\" is ambiguous: more than one select-weapon comes before it.");
  const select = selects[0]!;
  const bindAs = select.parameters.bind_as;
  if (typeof bindAs !== "string" || bindAs === "") throw new CompileError("The select-weapon before \"that weapon\" binds no name.");
  if (select.parameters.count !== undefined && select.parameters.count !== 1) throw new CompileError("\"That weapon\" needs a select-weapon that binds exactly one weapon.");
  if (select.parameters.target !== "this-model") throw new CompileError("\"That weapon\" needs a select-weapon on this model: the bound weapon is this model's.");
  if (leaf.parameters.subject !== "this-model") throw new CompileError("A grant to \"that weapon\" takes subject this-model.");
  if (typeof leaf.parameters.keyword !== "string") throw new CompileError("A grant to \"that weapon\" names one keyword.");
  for (const key of ["weapon_name", "weapon_keyword", "incoming"]) {
    if (leaf.parameters[key] !== undefined) throw new CompileError(`A grant to \"that weapon\" cannot also name ${key}.`);
  }
  const bound = select.parameters.weapon_type;
  if (typeof bound !== "string") throw new CompileError("The select-weapon before \"that weapon\" must name the bound weapon's type (melee or ranged).");
  const stated = leaf.parameters.weapon_type;
  if (stated !== undefined && stated !== bound) throw new CompileError(`The grant's weapon_type ${String(stated)} conflicts with the bound ${bound} weapon.`);
  const { weapon: _weapon, ...rest } = leaf.parameters;
  return { ...leaf, parameters: { ...rest, weapon_type: bound, weapon_var: bindAs } };
}

function bindAttacks(leaf: CompileLeaf, earlier: readonly CompileLeaf[]): CompileLeaf {
  if (leaf.parameters.of !== undefined) throw new CompileError("An attack-filter names either those attacks or the weapons a grant gave, not both.");
  const grant = [...earlier].reverse().find((item) => item.family_id === GRANT && typeof item.parameters.keyword === "string");
  if (!grant) throw new CompileError("\"Such a weapon\" has no earlier keyword grant to name the weapons it gave the keyword to.");
  // "Such a weapon" is every weapon the grant gave the keyword to. A grant already narrowed to one
  // bound weapon, or by name, keyword or incoming attacks, gave it to fewer weapons than its type
  // selects, so an attack-is over the type would widen the reference.
  for (const key of ["weapon_var", "weapon_name", "weapon_keyword", "incoming"]) {
    if (grant.parameters[key] !== undefined) throw new CompileError(`"Such a weapon" cannot follow a keyword grant that also names ${key}; the attacks would widen past the granted weapons.`);
  }
  const weaponType = grant.parameters.weapon_type;
  if (typeof weaponType !== "string") throw new CompileError("The keyword grant before \"such a weapon\" names no weapon type.");
  const attackType = weaponType === "all" ? undefined : weaponType;
  const stated = leaf.parameters.attack_type;
  if (stated !== undefined && stated !== attackType) throw new CompileError(`The attack_type ${String(stated)} conflicts with the granted ${weaponType} weapons.`);
  const { weapon: _weapon, attack_type: _stated, ...rest } = leaf.parameters;
  const filter = { ...rest, weapon_keyword: grant.parameters.keyword as string, ...(attackType === undefined ? {} : { attack_type: attackType }) };
  return { ...leaf, parameters: filter };
}

/**
 * Stat adjustments, bound after the weapon scopes fold. A weapon-scoped stat adjustment must name the weapon it changes. "select one of this model's
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

export function bindWeaponStatAntecedents(list: readonly CompileLeaf[]): CompileLeaf[] {
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

/**
 * A weapon-scoped stat or grant (`weapon_type` set) beside a select-weapon must name its weapons
 * some other way. Without this, the compiler widens it to every weapon of that type while the
 * select binds one. Named scopes (weapon_name, weapon_keyword), a bound form (weapon_ref,
 * weapon_var) and the antecedent are the accepted forms. Records with no select-weapon are unchanged.
 */
const NAMED_WEAPON_KEYS = ["weapon_name", "weapon_keyword", "weapon_ref", "weapon_var", "weapon"] as const;
const WEAPON_SCOPED = new Set(["characteristic-modifier", "weapon-ability-grant"]);

export function refuseUnboundWeaponScope(list: readonly CompileLeaf[]): void {
  if (!list.some((leaf) => leaf.family_id === SELECT)) return;
  for (const leaf of list) {
    if (!WEAPON_SCOPED.has(leaf.family_id) || leaf.parameters.weapon_type === undefined) continue;
    if (NAMED_WEAPON_KEYS.some((key) => leaf.parameters[key] !== undefined)) continue;
    throw new CompileError(`A ${leaf.family_id} scoped to ${String(leaf.parameters.weapon_type)} weapons sits beside a select-weapon, which binds one weapon; it must name its weapon (that weapon, or a weapon name or keyword).`);
  }
}
