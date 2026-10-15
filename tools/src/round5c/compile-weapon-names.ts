import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { loadWeaponCatalog, type WeaponCatalog, type WeaponRecord } from "./weapon-catalog.js";

/**
 * Named weapons ("weapons that are A, B and C", "of X and Y", "those weapons"). Each name must be a
 * printed weapon of the record's lookup scope, and the leaf must carry the printed spelling: a
 * compiled record names weapons exactly as the weapon records print them.
 *
 * Lookup scope: a unit's own weapons when the subject is this unit or this model and the record is
 * a unit's ability (the datasheets that carry the ability); the faction's weapons otherwise.
 */

export type WeaponNameContext = { faction_id: string; source_type: string; catalog?: WeaponCatalog };

const NAME_LEAVES = new Set(["characteristic-modifier", "weapon-property-scope", "roll-modifier"]);
/** Leaves that may name one weapon (weapon_name) in wording of their own; a stat change's weapon_name is not resolved here. */
const SINGLE_NAME_LEAVES = new Set(["weapon-property-scope", "roll-modifier"]);
const SET_LEAVES = new Set(["characteristic-set", "characteristic-modifier"]);
/** Words a named-weapon span may hold besides the names and their weapon noun. */
const CONNECTIVES = new Set(["and", "or", "the", "a", "an"]);

/** Fold for name comparison: NFKC, lowercase, every dash to "-", curly apostrophes straight, spaces collapsed. */
export function foldName(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—―]/gu, "-").replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** One name as it appears in folded wording: its tokens, with an optional plural on the last. */
function namePattern(folded: string): RegExp {
  const tokens = folded.split(" ").map(escapeRegExp);
  return new RegExp(`(?<![a-z'-])${tokens.join("\\s+")}s?(?![a-z'-])`, "gu");
}

/**
 * The stat phrase before named weapons in a characteristic change ("add 3 to the Attacks
 * characteristic of"), anchored at the start. Its words are the change's, not the weapons'.
 */
const STAT_PREFIX = /^add\s+\d+\s+to\s+the\s+[a-z' ]+?\s+characteristic\s+of\s+/u;

/** How a leaf's wording holds its names: a list in a scope or stat change, one name in a scope, or the weapons a roll is made for. */
export type NameForm = "names" | "scope" | "roll";
/** A roll modifier's own roll, sign and amount, which its wording must repeat. */
export type RollWording = { roll: unknown; operation: unknown; value: unknown };

/** A possessive lead, up to four words ("this unit's", "your unit's:", "that enemy unit's"). */
const POSSESSIVE = /^(?:[a-z'-]+\s+){0,3}?[a-z'-]+'s:?\s+/u;
/** A pronoun lead ("its Bloody Twins weapon"). */
const PRONOUN_LEAD = /^(?:its|their|your|his)\s+/u;
/** The weapon noun after the names, then an optional verb: "weapons", "weapon", "weapon has:", "weapons have". */
const NOUN_TAIL = /\s+weapons?(?:\s+(?:has|have)\s*:?)?$/u;
/** A roll modifier's phrase before its weapons ("+1 to hazard rolls made for its"), with emphasis marks already removed. */
const ROLL_PREFIX = /^(?:(?:has|have|gets?)\s+)?([+-])(\d+)\s+to\s+(?:the\s+)?(hit|wound|damage|hazard)\s+rolls?\s+made\s+(?:for|with)\s+(?:its|their|your|his)\s+/u;

/** The lead a scope's wording may open with: a possessive, else a pronoun. */
const stripLead = (text: string) => POSSESSIVE.test(text) ? text.replace(POSSESSIVE, "") : text.replace(PRONOUN_LEAD, "");

/** What is left of a named-weapon wording once the names (as "§") and the weapon noun are taken out must be connectives only. */
function refuseStray(left: string): void {
  const stray = left.replace(/,/gu, " ").split(" ").filter((word) => word !== "" && !CONNECTIVES.has(word));
  if (stray.length > 0) throw new CompileError(`The wording names words that are not weapons: ${stray.join(", ")}.`);
}

/** The roll phrase of a roll modifier's wording must match the leaf's roll, sign and amount; returns the wording after it. */
function rollRemainder(text: string, roll: RollWording): string {
  const match = ROLL_PREFIX.exec(text);
  if (!match) throw new CompileError("A roll modifier names weapons as \"+N to <roll> rolls made for its <weapons>\"; the wording does not.");
  if (match[3] !== roll.roll) throw new CompileError(`The wording is a ${match[3]} roll, not the leaf's ${String(roll.roll)} roll.`);
  if ((match[1] === "-") !== (roll.operation === "subtract")) throw new CompileError("The wording's sign does not match the leaf's operation.");
  if (match[2] !== String(roll.value)) throw new CompileError("The wording's amount does not match the leaf's value.");
  return text.slice(match[0].length);
}

/**
 * 3e and 3f: every name's words are in the span, and nothing else but connectives, a weapon noun and the scope wording is.
 * `scope` (one name) and `roll` (the weapons a roll is made for) replace the names by a marker first, so a name that
 * holds an apostrophe-s is never read as a possessive, and check the lead and the noun tail exactly.
 */
function checkSpan(names: readonly string[], folded: readonly string[], span: string, statPrefix: boolean, form: NameForm, roll?: RollWording): void {
  const text = foldName(span);
  for (let index = 0; index < names.length; index += 1) {
    for (const token of folded[index]!.split(" ")) {
      if (!text.includes(token)) throw new CompileError(`The wording does not name ${names[index]}: "${token}" is not in it.`);
    }
  }
  const marked = (wording: string) => [...folded].sort((a, b) => b.length - a.length).reduce((left, name) => left.replace(namePattern(name), "§"), wording);
  if (form === "scope") {
    refuseStray(stripLead(marked(text).replace(/^all\s+/u, "")).replace(NOUN_TAIL, "").replaceAll("§", " "));
    return;
  }
  if (form === "roll") {
    if (roll === undefined) throw new CompileError("A roll modifier's named weapons need the roll they are named for.");
    refuseStray(marked(rollRemainder(text.replaceAll("*", ""), roll)).replace(NOUN_TAIL, "").replaceAll("§", " "));
    return;
  }
  const wording = statPrefix ? text.replace(STAT_PREFIX, "") : text;
  let left = stripLead(wording.replace(/^all\s+/u, "")).replace(/\s+weapons?$/u, "")
    .replace(/equipped by models in your unit/gu, " ");
  for (const folded1 of [...folded].sort((a, b) => b.length - a.length)) left = left.replace(namePattern(folded1), " ");
  refuseStray(left);
}

/** The printed spelling of each name in its lookup scope (3b, 3c, 3d). */
export function resolveNames(
  names: readonly string[],
  use: { weapon_type: unknown; subject: unknown; span?: string; authored: boolean; statPrefix?: boolean; form?: NameForm; roll?: RollWording },
  ctx: WeaponNameContext,
  abilityId: string | undefined,
): string[] {
  const folded = names.map(foldName);
  if (new Set(folded).size !== folded.length) throw new CompileError("Two named weapons are the same weapon after folding case and dashes.");
  if (use.authored) {
    if (use.span === undefined) throw new CompileError("Named weapons need the wording they are named in.");
    checkSpan(names, folded, use.span, use.statPrefix === true, use.form ?? "names", use.roll);
  }
  const catalog = ctx.catalog ?? loadWeaponCatalog(ctx.faction_id, abilityId);
  const ownSubject = (use.subject === "this-unit" || use.subject === "this-model") && ctx.source_type === "unit";
  if (ownSubject && catalog.own === undefined) throw new CompileError("No unit datasheet carries this ability, so its named weapons cannot be looked up.");
  const pool: WeaponRecord[] = ownSubject ? catalog.own! : catalog.faction;
  return names.map((name, index) => {
    const matches = pool.filter((weapon) => foldName(weapon.name) === folded[index]);
    if (matches.length === 0) throw new CompileError(`No weapon named ${name} in this lookup scope.`);
    if (use.weapon_type !== "all" && matches.some((weapon) => weapon.type !== use.weapon_type)) {
      throw new CompileError(`${name} is not a ${String(use.weapon_type)} weapon.`);
    }
    const spellings = [...new Set(matches.map((weapon) => weapon.name))];
    if (spellings.length > 1) throw new CompileError(`${name} is printed with ${spellings.length} spellings (${spellings.join(" / ")}); the record cannot choose one.`);
    return spellings[0]!;
  });
}

/** The leaf's wording, when the source text is known. */
function spanOf(leaf: CompileLeaf, sourceText: string | undefined): string | undefined {
  return sourceText === undefined || leaf.end_byte === undefined ? undefined : Buffer.from(sourceText, "utf8").subarray(leaf.start_byte, leaf.end_byte).toString("utf8");
}

/**
 * Resolve every named-weapon leaf the record prints, with its own wording as the span. A scope or a
 * roll modifier may name one weapon (weapon_name) as well as a list; a stat change's weapon_name is
 * not resolved here.
 */
export function resolveAuthoredNames(list: readonly CompileLeaf[], sourceText: string | undefined, ctx: WeaponNameContext | undefined, abilityId: string | undefined): CompileLeaf[] {
  return list.map((leaf) => {
    if (!NAME_LEAVES.has(leaf.family_id)) return leaf;
    const parameters = leaf.parameters;
    const single = SINGLE_NAME_LEAVES.has(leaf.family_id) && parameters.weapon_name !== undefined;
    if (parameters.weapon_names === undefined && !single) return leaf;
    if (ctx === undefined) throw new CompileError("Named weapons need the record's faction to look them up.");
    // A characteristic change names its weapons after the stat phrase ("add 3 to the Attacks characteristic of X and Y").
    const statPrefix = leaf.family_id === "characteristic-modifier";
    const form: NameForm = leaf.family_id === "roll-modifier" ? "roll" : single ? "scope" : "names";
    const names = single ? [String(parameters.weapon_name)] : parameters.weapon_names as string[];
    const roll = form === "roll" ? { roll: parameters.roll, operation: parameters.operation, value: parameters.value } : undefined;
    const printed = resolveNames(names, { weapon_type: parameters.weapon_type ?? "all", subject: parameters.subject, span: spanOf(leaf, sourceText), authored: true, statPrefix, form, roll }, ctx, abilityId);
    return { ...leaf, parameters: { ...parameters, ...(single ? { weapon_name: printed[0] } : { weapon_names: printed }) } };
  });
}

/**
 * "those weapons" (weapon: earlier-named): the weapons the earlier leaves of this ability named with
 * a weapon_name, with the same recipient and weapon type. The binder names the weapons from those
 * leaves, so its names take no span check. One name becomes a weapon_name, several a weapon_names.
 */
export function bindEarlierNamed(list: readonly CompileLeaf[], ctx: WeaponNameContext | undefined, abilityId: string | undefined): CompileLeaf[] {
  if (!list.some((leaf) => leaf.parameters.weapon === "earlier-named")) return [...list];
  const bound: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.parameters.weapon !== "earlier-named") { bound.push(leaf); continue; }
    const { weapon: _weapon, ...rest } = leaf.parameters;
    const binders = bound.filter((item) => SET_LEAVES.has(item.family_id) && item.parameters.weapon_name !== undefined);
    if (binders.length === 0) throw new CompileError("\"Those weapons\" has no earlier named-weapon leaf to name the weapons it changes.");
    const type = binders[0]!.parameters.weapon_type;
    const subject = binders[0]!.parameters.subject;
    if (binders.some((item) => item.parameters.weapon_type !== type || item.parameters.subject !== subject)) {
      throw new CompileError("\"Those weapons\" follows named-weapon leaves with different recipients or weapon types.");
    }
    if (leaf.parameters.weapon_type !== type || leaf.parameters.subject !== subject) {
      throw new CompileError("\"Those weapons\" takes the recipient and weapon type of the earlier named-weapon leaves.");
    }
    if (ctx === undefined) throw new CompileError("Named weapons need the record's faction to look them up.");
    const names = [...new Set(binders.map((item) => String(item.parameters.weapon_name)))];
    const printed = resolveNames(names, { weapon_type: type, subject, authored: false }, ctx, abilityId);
    const named = printed.length === 1 ? { weapon_name: printed[0] } : { weapon_names: printed };
    bound.push({ ...leaf, parameters: { ...rest, ...named } });
  }
  return bound;
}

/** A distance measured by the attack's weapon needs a weapon in the record to measure it with. */
export function refuseDistanceWithoutWeapon(list: readonly CompileLeaf[]): void {
  const distances = list.filter((leaf) => leaf.family_id === "unit-position" && leaf.parameters.distance !== undefined);
  if (distances.length === 0) return;
  const weaponBearing = list.some((leaf) => ["attack", "weapon-property-scope", "weapon-ability-grant", "weapon-ability-keyword"].includes(leaf.family_id)
    || (SET_LEAVES.has(leaf.family_id) && (leaf.parameters.weapon_type !== undefined || leaf.parameters.weapon_name !== undefined || leaf.parameters.weapon_names !== undefined)));
  if (!weaponBearing) throw new CompileError("A distance to half a weapon's range needs a weapon in the same ability to measure it with.");
}
