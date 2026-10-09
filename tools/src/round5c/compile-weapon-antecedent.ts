import { ANTECEDENT } from "./antecedent-families.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isContainerOpener } from "./compile-containers.js";
import { targetCondition } from "./compile-weapon-scopes.js";

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
const SCOPE = "weapon-property-scope";

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
  // A weapon scope printed in this record has no grant frame until foldWeaponScopes runs; bindScopeAttacks binds it then.
  if (!grant && earlier.some((item) => item.family_id === SCOPE)) return leaf;
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
 * A weapon-scoped adjustment that names no weapon beside a select-weapon is refused by
 * refuseUnboundWeaponScope below.
 */
// attack-filter is bound by bindScopeAttacks, after the scopes fold; its weapon antecedent is not a stat's.
const isAntecedent = (leaf: CompileLeaf) => leaf.parameters.weapon === "antecedent" && leaf.family_id !== FILTER;

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

/**
 * "such a weapon" that bindAttacks deferred because the record prints a weapon scope. Runs after
 * foldUnitFilters, when the scope has folded into a grant frame: a `weapon-ability-grant` with
 * `keywords` (folded by foldWeaponKeywords) and `subject_filter` (the recipient chain).
 *
 * The frame is the nearest earlier grant that names a keyword. Its keyword is the one it gives, its
 * units are the attackers, and the nearest earlier attack this record makes in the fragment takes
 * those units as `attacker_filter`. The filter becomes an attack-is over that keyword. Refused: no
 * frame, a frame that names a weapon, name, keyword or incoming attacks, a frame with no units or
 * several keywords, a stated attack_type that differs, or an attack that is missing, a backref, or
 * names its attacker other than as "that unit" (`unit`), or with `attacker_filter`.
 */
const isDeferredFilter = (leaf: CompileLeaf) => leaf.family_id === FILTER && leaf.parameters.weapon === ANTECEDENT;

function lastIndexOf(list: readonly CompileLeaf[], test: (leaf: CompileLeaf) => boolean): number {
  for (let index = list.length - 1; index >= 0; index -= 1) if (test(list[index]!)) return index;
  return -1;
}

export function bindScopeAttacks(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some(isDeferredFilter)) return [...list];
  const bound: CompileLeaf[] = [];
  for (const leaf of list) {
    if (!isDeferredFilter(leaf)) {
      bound.push(leaf);
      continue;
    }
    const { filter, attackAt, attack } = scopeAttacks(leaf, bound);
    bound[attackAt] = attack;
    bound.push(filter);
  }
  return bound;
}

function scopeAttacks(leaf: CompileLeaf, earlier: readonly CompileLeaf[]): { filter: CompileLeaf; attackAt: number; attack: CompileLeaf } {
  const frameAt = lastIndexOf(earlier, (item) => item.family_id === GRANT && (Array.isArray(item.parameters.keywords) || typeof item.parameters.keyword === "string"));
  const frame = frameAt < 0 ? undefined : earlier[frameAt];
  if (!frame) throw new CompileError("\"Such a weapon\" has no earlier keyword grant to name the weapons it gave the keyword to.");
  for (const key of ["weapon_var", "weapon_name", "weapon_keyword", "incoming"]) {
    if (frame.parameters[key] !== undefined) throw new CompileError(`"Such a weapon" cannot follow a keyword grant that also names ${key}; the attacks would widen past the granted weapons.`);
  }
  let keyword: string;
  if (typeof frame.parameters.keyword === "string") {
    keyword = frame.parameters.keyword;
  } else {
    const keywords = frame.parameters.keywords as unknown[];
    if (keywords.length !== 1) throw new CompileError("\"Such a weapon\" needs a keyword grant that gives exactly one keyword.");
    keyword = String(keywords[0]);
  }
  const attacker = frame.parameters.subject_filter;
  if (attacker === undefined) throw new CompileError("\"Such a weapon\" follows a keyword grant that names no units, so its attacker is unknown.");
  const weaponType = frame.parameters.weapon_type;
  if (typeof weaponType !== "string") throw new CompileError("The keyword grant before \"such a weapon\" names no weapon type.");
  const attackType = weaponType === "all" ? undefined : weaponType;
  const stated = leaf.parameters.attack_type;
  if (stated !== undefined && stated !== attackType) throw new CompileError(`The attack_type ${String(stated)} conflicts with the granted ${weaponType} weapons.`);
  const attackAt = lastIndexOf(earlier, (item) => item.family_id === "attack" && item.fragment === leaf.fragment && item.parameters.direction === "makes");
  const attack = attackAt < 0 ? undefined : earlier[attackAt];
  if (!attack || attackAt < 0) throw new CompileError("\"Such a weapon\" follows no attack this record makes, so its attacker is unknown.");
  if (attack.parameters.backref === true || attack.parameters.refers !== undefined) throw new CompileError("\"Such a weapon\" follows a backref attack, which does not name its attacker.");
  // The attack family requires a unit on every attack this record makes. "that unit" is the one the
  // labeller prints for an attacker a recipient chain introduced; the grant's units replace it.
  if (attack.parameters.unit !== undefined && attack.parameters.unit !== "that-unit") {
    throw new CompileError(`"Such a weapon" needs the attack to take its attacker from the keyword grant; the attack already names it with unit ${String(attack.parameters.unit)}.`);
  }
  if (attack.parameters.attacker_filter !== undefined) throw new CompileError("\"Such a weapon\" needs the attack to take its attacker from the keyword grant; the attack already names it with attacker_filter.");
  const { weapon: _weapon, attack_type: _stated, ...rest } = leaf.parameters;
  const filter = { ...leaf, parameters: { ...rest, weapon_keyword: keyword, ...(attackType === undefined ? {} : { attack_type: attackType }) } };
  const bound = { ...attack, parameters: { ...attack.parameters, attacker_filter: structuredClone(attacker) } };
  return { filter, attackAt, attack: bound };
}

/**
 * An antecedent frame: a weapon-ability-grant or weapon-property-scope with `frame: "antecedent"`
 * (family-extensions-18-frame-antecedent.ts). It names no recipient or weapon type; the binder takes
 * both from the nearest earlier frame or scope, so the branch it opens shares the sentence's weapons.
 *
 * The source is the nearest earlier grant with no keyword or scope with a subject, bound or not. Refused:
 * no source; a source that names a weapon, weapon name, weapon keyword or incoming attacks (the copy
 * would widen the weapons); a trigger, a container opener, a target condition or a duration between the
 * source and the frame; or a recipient unit-filter or unit-owner in the frame's own fragment. A
 * unit-filter with side any is a qualifier of a keyword, not a recipient, and does not refuse. Sentence
 * breaks are not refused: the "Or:" branch inherits the frame of the sentence before it.
 */
const FRAME_KEY = "frame";
const ANTECEDENT_FRAME = "antecedent";
const NARROWING_KEYS = ["weapon_keyword", "weapon_name", "incoming", "weapon", "weapon_var"] as const;
const isFrameAntecedent = (leaf: CompileLeaf) => (leaf.family_id === GRANT || leaf.family_id === SCOPE) && leaf.parameters[FRAME_KEY] === ANTECEDENT_FRAME;
const isGrantSource = (leaf: CompileLeaf) => leaf.family_id === GRANT && leaf.parameters.keyword === undefined && leaf.parameters.keywords === undefined && leaf.parameters.subject !== undefined;
const isScopeSource = (leaf: CompileLeaf) => leaf.family_id === SCOPE && leaf.parameters.subject !== undefined;
const isRecipient = (leaf: CompileLeaf) => leaf.family_id === "unit-owner" || (leaf.family_id === "unit-filter" && leaf.parameters.side !== "any");

/** A leaf that starts a new moment, which a frame may not inherit across: a trigger or its target. */
const isTriggerLeaf = (leaf: CompileLeaf) => leaf.role === "EVENT" || leaf.family_id === "use-window" || leaf.family_id === "triggering-target";

export function bindFrameAntecedents(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some(isFrameAntecedent)) return [...list];
  const bound: CompileLeaf[] = [];
  for (const leaf of list) {
    bound.push(isFrameAntecedent(leaf) ? bindFrame(leaf, bound, list) : leaf);
  }
  return bound;
}

function bindFrame(leaf: CompileLeaf, earlier: readonly CompileLeaf[], list: readonly CompileLeaf[]): CompileLeaf {
  let at = earlier.length - 1;
  while (at >= 0 && !isGrantSource(earlier[at]!) && !isScopeSource(earlier[at]!)) at -= 1;
  if (at < 0) {
    throw new CompileError(leaf.family_id === GRANT
      ? "A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it."
      : "A weapon-property-scope with no recipient needs an earlier frame to take its recipient from.");
  }
  const source = earlier[at]!;
  for (const key of NARROWING_KEYS) {
    if (source.parameters[key] !== undefined) throw new CompileError(`An antecedent frame cannot copy a source that also names ${key}; the copy would widen its weapons.`);
  }
  for (const between of earlier.slice(at + 1)) {
    if (isTriggerLeaf(between)) throw new CompileError("An antecedent frame cannot inherit its weapons across a trigger; the moment after the trigger is new.");
    if (isContainerOpener(between.family_id)) throw new CompileError("An antecedent frame cannot inherit its weapons across a container option.");
    if (targetCondition(between, source) || (between.fragment === source.fragment && between.role === "DURATION")) {
      throw new CompileError("An antecedent frame cannot inherit a target condition or duration from its source; the copy would drop it.");
    }
  }
  if (list.some((item) => item.fragment === leaf.fragment && isRecipient(item))) {
    throw new CompileError("An antecedent frame that names its own recipient cannot also inherit one.");
  }
  const { [FRAME_KEY]: _frame, ...rest } = leaf.parameters;
  const weaponType = source.parameters.weapon_type;
  return {
    ...leaf,
    parameters: { ...rest, subject: source.parameters.subject, ...(weaponType === undefined ? {} : { weapon_type: weaponType }) },
  };
}
