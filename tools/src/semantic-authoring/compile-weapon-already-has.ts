import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * "If such a weapon already has that ability" (weapon-has-ability): the weapons the nearest earlier
 * keyword grant gave a keyword to, and that keyword, as the weapon prints it. The sentence after it
 * (a critical-hit-threshold) then applies to exactly those weapons: the fold copies the grant's base
 * keyword and weapon type onto it and removes the condition leaf. `granted_rating` is the reviewed
 * answer to what the grant does to a weapon that already prints the ability; `add` sets the grant's
 * if_present, `keep` leaves the grant alone. The fold never picks a reading.
 */

const CONDITION = "weapon-has-ability";
const GRANT = "weapon-ability-grant";
const HOST = "critical-hit-threshold";
/** What narrows a grant to some weapons or to some moment; "such a weapon" would then be a subset the fold cannot name. */
const GRANT_NARROWING = ["weapon_var", "weapon_name", "weapon_names", "weapon_keyword", "weapon_ref", "incoming", "exclude_weapon_name", "exclude_weapon_names", "exclude_weapon_keyword", "gate", "keyword_choice"];
/** A rating after the keyword: "Sustained Hits 1", "Anti-Infantry 5+", "Melta D6", "Rapid Fire 2". */
const RATING = /\s+(?:\d*D\d+(?:\+\d+)?|\d+\+?)$/u;

/** The grant's one keyword with its rating dropped: a weapon that prints "Sustained Hits 2" already has Sustained Hits. */
function baseKeyword(grant: CompileLeaf): string {
  const keywords = Array.isArray(grant.parameters.keywords) ? grant.parameters.keywords as unknown[] : grant.parameters.keyword !== undefined ? [grant.parameters.keyword] : [];
  if (keywords.length !== 1 || typeof keywords[0] !== "string") throw new CompileError("\"Already has that ability\" needs the grant before it to give exactly one keyword.");
  const base = keywords[0].replace(RATING, "").trim();
  if (base === "") throw new CompileError("\"Already has that ability\" has no keyword left once the rating is dropped.");
  return base;
}

/** Fold every weapon-has-ability leaf into the critical-hit-threshold after it and the grant before it. */
export function foldWeaponAlreadyHas(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === CONDITION)) return [...list];
  const result = [...list];
  const claimed = new Set<number>();
  const dropped = new Set<number>();
  for (let at = 0; at < result.length; at += 1) {
    const condition = result[at]!;
    if (condition.family_id !== CONDITION) continue;
    let grantAt = -1;
    for (let back = at - 1; back >= 0; back -= 1) if (result[back]!.family_id === GRANT && !dropped.has(back)) { grantAt = back; break; }
    if (grantAt < 0) throw new CompileError("\"Such a weapon already has that ability\" has no earlier keyword grant to read its weapons and ability from.");
    const grant = result[grantAt]!;
    if (grant.fragment !== condition.fragment) throw new CompileError("\"Such a weapon already has that ability\" reads a grant in its own part of the text.");
    for (const key of GRANT_NARROWING) {
      if (grant.parameters[key] !== undefined) throw new CompileError(`"Such a weapon already has that ability" cannot read a grant narrowed by ${key}.`);
    }
    const keyword = baseKeyword(grant);
    let hostAt = at + 1;
    while (hostAt < result.length && result[hostAt]!.family_id === "duration") hostAt += 1;
    const host = result[hostAt];
    if (host === undefined || host.fragment !== condition.fragment) throw new CompileError("\"Such a weapon already has that ability\" needs the sentence after it to change those weapons.");
    if (host.family_id === CONDITION) throw new CompileError("Two \"already has that ability\" conditions cannot share one sentence.");
    if (host.family_id !== HOST) throw new CompileError(`There is no already-has form for ${host.family_id}; it follows a critical-hit-threshold only.`);
    if (claimed.has(hostAt)) throw new CompileError("Two \"already has that ability\" conditions cannot share one sentence.");
    if (host.parameters.weapon_keyword !== undefined || host.parameters.weapon_type !== undefined) throw new CompileError("The critical-hit-threshold already selects weapons; \"already has that ability\" would select them twice.");
    claimed.add(hostAt);
    const weaponType = grant.parameters.weapon_type;
    result[hostAt] = { ...host, parameters: { ...host.parameters, weapon_keyword: keyword, ...(weaponType === "melee" || weaponType === "ranged" ? { weapon_type: weaponType } : {}) } };
    if (condition.parameters.granted_rating === "add") result[grantAt] = { ...grant, parameters: { ...grant.parameters, if_present: "increment" } };
    dropped.add(at);
  }
  return result.filter((_leaf, index) => !dropped.has(index));
}
