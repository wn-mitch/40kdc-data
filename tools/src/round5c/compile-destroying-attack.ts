import { exactSpan } from "./contracts.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { isBackref } from "./compile-attack-backref.js";

/** Attack parameters a destroying attack may carry; folding it into the destruction keeps only its maker. */
const FOLDABLE_ATTACK_KEYS = ["direction", "unit", "attack_type"];

const DESTRUCTIONS = new Set(["unit-destroyed", "model-destroyed"]);

/**
 * "Each time a friendly X unit is destroyed by an attack made by an enemy unit that can FLY": the
 * unit-filter after the attack names the attack's maker, which is the destruction's destroyer.
 * True when the last two leaves in `out` are that destruction and its attack, the attack's own
 * wording reads "by … made by", and the filter's side is the attack's side. A this-unit attack is
 * not folded (its maker needs membership, which the attacker branch handles).
 */
export function destroyingAttackBefore(out: readonly CompileLeaf[], filter: CompileLeaf, sourceText: string | undefined): boolean {
  const attack = out.at(-1);
  const event = out.at(-2);
  if (sourceText === undefined || attack === undefined || event === undefined) return false;
  if (event.family_id !== "event" || !DESTRUCTIONS.has(String(event.parameters.kind))) return false;
  if (event.fragment !== attack.fragment || attack.fragment !== filter.fragment) return false;
  if (attack.family_id !== "attack" || attack.parameters.direction !== "makes" || isBackref(attack) || attack.parameters.attacker_filter !== undefined) return false;
  const side = attack.parameters.unit === "friendly-unit" ? "friendly" : attack.parameters.unit === "enemy-unit" ? "enemy" : undefined;
  if (side === undefined || filter.parameters.side !== side || filter.start_byte <= attack.start_byte) return false;
  const bytes = Buffer.from(sourceText, "utf8");
  // "is destroyed" + " " + "by an attack made by a" + filter: only whitespace between the moment and its attack.
  if (!/^\s*$/u.test(bytes.subarray(event.end_byte, attack.start_byte).toString("utf8"))) return false;
  if (bytes.subarray(attack.start_byte, attack.start_byte + 2).toString("utf8") !== "by") return false;
  return /\bmade by\b/iu.test(exactSpan(sourceText, attack.start_byte, filter.start_byte));
}

/**
 * Replace the destruction and its attack at the end of `out` with the destruction carrying `subject`
 * (the filter's DSL unit-filter) as its subject. Refuses what the destruction already names, and
 * what the attack carries beyond its maker: that would be lost with the attack leaf.
 */
export function foldDestroyingAttack(out: CompileLeaf[], subject: Record<string, unknown>): void {
  const attack = out.at(-1)!;
  const event = out.at(-2)!;
  if (event.parameters.by !== undefined) throw new CompileError("A destruction that names its destroyer cannot also take that destroyer from a unit-filter after its attack.");
  if (event.parameters.destroy_filter !== undefined) throw new CompileError("A destruction whose attacks are named cannot also take its destroyer from a unit-filter after its attack.");
  if (event.parameters.subject_filter !== undefined) throw new CompileError("A destruction already has a subject; it cannot also take one from a unit-filter after its attack.");
  if (Object.keys(attack.parameters).some((key) => !FOLDABLE_ATTACK_KEYS.includes(key)) || (attack.parameters.attack_type !== undefined && attack.parameters.attack_type !== "any")) {
    throw new CompileError("A destroying attack with a weapon, target or attack type cannot fold its maker into the destruction.");
  }
  out.splice(out.length - 2, 2, { ...event, parameters: { ...event.parameters, subject_filter: subject } });
}
