/**
 * Single effects added for the phase-4 shapes: a test exemption, a datasheet swap, how a
 * characteristic that differs between models resolves, Firing Deck weapon borrowing and a
 * weapon binding. One lowercase-initial clause, no period; `undefined` for any other type.
 */

import type { Leaf } from "./effect-leaf.js";
import { expiryTrail } from "./expiry.js";
import { bracketKeyword, diceCase, effectSubject, jstr, statName, testName, titleCase, v, type Ctx } from "./effect-words.js";

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
  const kind = m.weapon_type != null ? `${jstr(m.weapon_type)} ` : "";
  const excl = Array.isArray(m.exclude_weapon_keyword) && m.exclude_weapon_keyword.length
    ? ` (excluding ${(m.exclude_weapon_keyword as unknown[]).map(bracketKeyword).join(" and ")} weapons)`
    : "";
  const until = expiryTrail(m.until);
  return `${subj} can use one ${kind}weapon${excl} from each of up to ${diceCase(m.max_models)} ${from}${until ? ` ${until}` : ""}; those models cannot shoot`;
}

function selectWeapon(m: Record<string, unknown>, subj: string): string {
  const n = Number(m.count ?? 1);
  const kind = m.weapon_type != null ? `${jstr(m.weapon_type)} ` : "";
  const kw = m.weapon_keyword != null ? ` with [${jstr(m.weapon_keyword).toUpperCase()}]` : "";
  return `select ${n === 1 ? "one" : jstr(n)} ${kind}weapon${n === 1 ? "" : "s"}${kw} equipped by ${subj}; the effects below refer to ${n === 1 ? "it as the selected weapon" : "them as the selected weapons"}`;
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
