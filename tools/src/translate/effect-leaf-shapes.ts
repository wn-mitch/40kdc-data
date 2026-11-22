/**
 * Single effects added for the phase-4 shapes: a test exemption, a datasheet swap, how a
 * characteristic that differs between models resolves, Firing Deck weapon borrowing and a
 * weapon binding. One lowercase-initial clause, no period; `undefined` for any other type.
 */

import type { Leaf } from "./effect-leaf.js";
import { designationPhrase } from "./condition-refs.js";
import { expiryTrail } from "./expiry.js";
import { diceCase, effectSubject, jstr, statName, testName, titleCase, v, weaponNoun, type Ctx } from "./effect-words.js";

function testExemption(m: Record<string, unknown>, subj: string): string {
  return `${subj} ${v(subj, "does")} not need to take any further ${testName(m.test)} tests this ${jstr(m.window).replace(/-/g, " ")}`;
}

function characteristicResolution(m: Record<string, unknown>, subj: string): string {
  const stat = `${statName(m.stat)} characteristic`;
  const which =
    m.rule === "majority"
      ? `the ${stat} of the majority of its models (if tied, the ${m.tie === "lowest" ? "lowest" : "highest"})`
      : `the ${m.rule === "lowest" ? "lowest" : "highest"} ${stat} among its models`;
  if (m.applies_to === "wound-roll") return `each time an attack targets ${subj}, use ${which} to determine the Wound roll`;
  return `${subj} ${v(subj, "uses")} ${which}`;
}

function borrowWeapons(m: Record<string, unknown>, subj: string, ctx: Ctx): string {
  // Weapons come from models, so a unit filter reads as its models.
  const from = m.from != null ? effectSubject(m.from, ctx).replace(/^all /, "").replace(/\bunits\b/, "models") : "models embarked within it";
  const weapon = weaponNoun(m).replace(/\bweapons\b/, "weapon");
  const until = expiryTrail(m.until);
  return `${subj} can use one ${weapon} from each of up to ${diceCase(m.max_models)} ${from}${until ? ` ${until}` : ""}; those models cannot shoot`;
}

function selectWeapon(m: Record<string, unknown>, subj: string): string {
  const n = Number(m.count ?? 1);
  const weapon = n === 1 ? weaponNoun(m).replace(/\bweapons\b/, "weapon") : weaponNoun(m);
  return `select ${n === 1 ? "one" : jstr(n)} ${weapon} equipped by ${subj}; the effects below refer to ${n === 1 ? "it as the selected weapon" : "them as the selected weapons"}`;
}

/** "PAIN" → "Pain", "BLOOD RITE" → "Blood Rite": an ability tag as the rules print it. */
function abilityTag(keyword: string): string {
  return keyword.toLowerCase().split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * A suppression of every ability with a tag ({rule: {ability_keyword}}). On the units neither carrying a tag nor part of
 * a unit that carries it, it is the two sentences the rules print: "Pain abilities only apply to a unit while it is
 * Empowered. While an Attached unit is Empowered, the Pain abilities of all its Leader and Bodyguard units take effect".
 * `undefined` when the rule names one ability.
 */
export function abilityClassState(target: unknown, m: Record<string, unknown>, subj: string): string | undefined {
  const rule = m.rule as Record<string, unknown> | null | undefined;
  if (rule == null || typeof rule !== "object" || typeof rule.ability_keyword !== "string") return undefined;
  const tag = abilityTag(rule.ability_keyword);
  const t = (target ?? {}) as Record<string, unknown>;
  const mark = typeof t.not_designated === "string" ? t.not_designated : null;
  const excluding = t.excluding as Record<string, unknown> | undefined;
  const memberOf = excluding?.member_of as Record<string, unknown> | undefined;
  const unmarked = mark !== null && Object.keys(t).length === 2 && excluding != null && Object.keys(excluding).length === 1
    && memberOf != null && Object.keys(memberOf).length === 1 && memberOf.designated === mark;
  if (!unmarked) return `${subj} cannot use ${tag} abilities`;
  const state = designationPhrase(mark);
  return `${tag} abilities only apply to a unit while it is ${state}. While an Attached unit is ${state}, the ${tag} abilities of all its Leader and Bodyguard units take effect, with no additional spend`;
}

/** The phase-4 leaves, or undefined for any other type. */
export function describeShapeLeaf(e: Leaf, m: Record<string, unknown>, subj: string, ctx: Ctx): string | undefined {
  switch (e.type) {
    case "test-exemption": return testExemption(m, subj);
    case "datasheet-swap":
      return `${subj} ${v(subj, "uses")} the ${titleCase(jstr(m.datasheet))} datasheet from now on, keeping its lost wounds and its position`;
    case "characteristic-resolution": return characteristicResolution(m, subj);
    case "borrow-weapons": return borrowWeapons(m, subj, ctx);
    case "select-weapon": return selectWeapon(m, subj);
    default: return undefined;
  }
}
