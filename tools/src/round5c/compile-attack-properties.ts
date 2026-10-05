import type { CompileLeaf } from "./compile-fragments.js";
import { currentFamilyVersion } from "./contracts.js";

/**
 * "This unit's ranged attacks that target a unit within 12\" have [SUSTAINED HITS 1]": an attack
 * leaf, the conditions on its target, then properties with no frame of their own. The properties
 * are the attack's: keywords get a weapon-ability-grant frame on the attack, and a stat adjustment
 * with no recipient adjusts the attack, limited to the attack's type.
 */

const KEYWORD = "weapon-ability-keyword";
const isStat = (leaf: CompileLeaf) => leaf.family_id === "characteristic-modifier" && leaf.family_version >= 5 && leaf.parameters.subject === undefined;
const isProperty = (leaf: CompileLeaf) => leaf.family_id === KEYWORD || isStat(leaf);
/** Conditions on the attack's target that sit between it and its properties ("that target a marked unit"). */
const TARGET_CONDITIONS = new Set(["target-is-selected", "designated-filter", "unit-mark", "unit-keyword", "unit-position", "unit-state", "attack-filter"]);

function between(source: Buffer | undefined, left: CompileLeaf, right: CompileLeaf): string {
  return source && left.end_byte !== undefined && right.start_byte > left.end_byte ? source.subarray(left.end_byte, right.start_byte).toString("utf8") : "";
}

/**
 * Whether two leaves sit in one run: no sentence break between them, or only list punctuation
 * before a list item with no recipient of its own ("[IGNORES COVER].[LETHAL HITS]", "+1 BS.[Ignores
 * Cover]"); "+1 A. This unit has +1 Move" is a new sentence.
 */
export function sameRun(source: Buffer | undefined, left: CompileLeaf, right: CompileLeaf): boolean {
  const gap = between(source, left, right);
  return !/[.;]/u.test(gap) || (gap.length <= 8 && !/\p{L}/u.test(gap) && right.parameters.subject === undefined);
}

function onTarget(leaf: CompileLeaf, attack: CompileLeaf): boolean {
  if (leaf.fragment !== attack.fragment) return false;
  // "that target a VEHICLE unit": the filter becomes the attack's target (compile-unit-filters.ts).
  if (leaf.family_id === "unit-filter" || leaf.family_id === "unit-owner") return true;
  if (leaf.role !== "CONDITION" || !TARGET_CONDITIONS.has(leaf.family_id)) return false;
  const subject = leaf.parameters.subject;
  return subject === undefined || subject === "target" || subject === "defender" || leaf.family_id === "attack-filter";
}

export function foldAttackProperties(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "attack") || !list.some(isProperty)) return [...list];
  const source = sourceText === undefined ? undefined : Buffer.from(sourceText, "utf8");
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const attack = list[index]!;
    out.push(attack);
    if (attack.family_id !== "attack" || attack.parameters.direction !== "makes") continue;
    let first = index + 1;
    while (first < list.length && onTarget(list[first]!, attack) && sameRun(source, list[first - 1]!, list[first]!)) first += 1;
    let end = first;
    while (end < list.length && isProperty(list[end]!) && list[end]!.fragment === attack.fragment && sameRun(source, list[end - 1]!, list[end]!)) end += 1;
    if (end === first) continue;
    const weaponType = attack.parameters.attack_type === "any" ? "all" : attack.parameters.attack_type;
    // Each property carries the attack's weapon type, as a property scope's do, so the attack adds
    // no melee/ranged gate of its own (which would also gate the record's later sentences).
    out[out.length - 1] = { ...attack, parameters: { ...attack.parameters, framed: true } };
    out.push(...list.slice(index + 1, first));
    let framed = false;
    for (let at = first; at < end; at += 1) {
      const leaf = list[at]!;
      if (isStat(leaf)) {
        out.push({ ...leaf, parameters: { ...leaf.parameters, subject: "attack", ...(leaf.parameters.weapon_type === undefined ? { weapon_type: weaponType } : {}) } });
        framed = false;
        continue;
      }
      if (!framed) {
        out.push({
          role: "EFFECT", family_id: "weapon-ability-grant", family_version: currentFamilyVersion("weapon-ability-grant"),
          parameters: { subject: "attack", weapon_type: weaponType }, start_byte: leaf.start_byte, end_byte: leaf.start_byte, fragment: leaf.fragment,
        });
        framed = true;
      }
      out.push(leaf);
    }
    index = end - 1;
  }
  return out;
}
