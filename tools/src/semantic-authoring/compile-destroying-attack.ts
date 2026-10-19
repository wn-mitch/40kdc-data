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

/**
 * "Each time a friendly X unit is destroyed by a Y unit": the unit-filter right after a unit's
 * destruction ("is destroyed by a") names the destroyer. Returns that filter's index, or null when
 * the wording or the leaves are not that shape. Null for a model destruction, for a destruction
 * that already names its destroyer, subject or attacks, and when an attack leaf sits between the
 * moment and the filter (the attack's maker is folded by destroyingAttackBefore instead). Throws
 * when the filter and the "from your army" after it name different sides.
 */
export function trailingDestroyerFilter(leaves: readonly CompileLeaf[], eventIndex: number, sourceText: string | undefined): number | null {
  const event = leaves[eventIndex];
  const filterIndex = eventIndex + 1;
  const filter = leaves[filterIndex];
  if (sourceText === undefined || event === undefined || filter === undefined) return null;
  if (event.family_id !== "event" || event.parameters.kind !== "unit-destroyed") return null;
  if (event.parameters.by !== undefined || event.parameters.destroy_filter !== undefined || event.parameters.subject_filter !== undefined) return null;
  if (filter.family_id !== "unit-filter" || filter.fragment !== event.fragment || filter.parameters.level === "model") return null;
  if (!/\bby\s+an?\s*$/iu.test(exactSpan(sourceText, event.start_byte, filter.start_byte))) return null;
  return destroyerSideOf(leaves, filterIndex) === undefined ? null : filterIndex;
}

/**
 * The side of the unit that destroyed the unit: the filter's own side, or the side of the
 * "from your army" leaf right after it (the filter's side is then any). Undefined when neither
 * names a side. Throws when both name a side and they differ.
 */
export function destroyerSideOf(leaves: readonly CompileLeaf[], filterIndex: number): "friendly" | "enemy" | undefined {
  const filter = leaves[filterIndex]!;
  const owner = leaves[filterIndex + 1];
  const owned = owner?.family_id === "unit-owner" && owner.fragment === filter.fragment ? owner.parameters.owner : undefined;
  const side = filter.parameters.side;
  if (side === "friendly" || side === "enemy") {
    if (owned !== undefined && owned !== side) throw new CompileError(`A destroyer's unit-filter says ${side} and the "from your army" after it says ${String(owned)}.`);
    return side;
  }
  return owned === "friendly" || owned === "enemy" ? owned : undefined;
}

/** The index of the unit-filter that describes what a destruction destroyed (the one before it), or null. */
function leadingObjectFilter(leaves: readonly CompileLeaf[], eventIndex: number): number | null {
  const fragment = leaves[eventIndex]!.fragment;
  let at = eventIndex - 1;
  while (leaves[at]?.family_id === "unit-owner" && leaves[at]!.fragment === fragment) at -= 1;
  const leaf = leaves[at];
  return leaf?.family_id === "unit-filter" && leaf.fragment === fragment ? at : null;
}

/**
 * The unit-filter after a destruction names its destroyer, so the destruction's subject is the
 * destroyer and the wording "that unit" after it is ambiguous between the destroyer and the
 * destroyed unit. Refuses an antecedent whose wording (from the destroyer filter to the
 * antecedent) names the destroyed unit's keywords or side, names no side the destroyer has, or
 * is a bare "that unit". Passes an antecedent that names the destroyer's side or keywords only.
 */
export function refuseDestroyedUnitAntecedent(leaves: readonly CompileLeaf[], eventIndex: number, antecedent: CompileLeaf, sourceText: string | undefined): void {
  const filterIndex = eventIndex + 1;
  const destroyer = leaves[filterIndex]!;
  if (sourceText === undefined || destroyer.end_byte === undefined || antecedent.end_byte === undefined || antecedent.end_byte <= destroyer.end_byte) return;
  const wording = Buffer.from(sourceText, "utf8").subarray(destroyer.end_byte, antecedent.end_byte).toString("utf8").toUpperCase();
  const destroyerSide = destroyerSideOf(leaves, filterIndex);
  const leading = leadingObjectFilter(leaves, eventIndex);
  const object = leading === undefined || leading === null ? undefined : leaves[leading];
  const objectSide = object?.parameters.side;
  const keywords = [...((object?.parameters.keywords as string[] | undefined) ?? [])];
  const refuse = (reason: string): never => {
    throw new CompileError(`${antecedent.family_id} at byte ${antecedent.start_byte} points back to a unit (that unit), but ${reason}. The unit-filter after the destruction names the destroyer.`);
  };
  if (object === undefined) refuse("the destroyed unit is not named by a unit-filter before the destruction");
  if (destroyerSide !== undefined && (objectSide === destroyerSide)) refuse("the destroyed unit and its destroyer are on the same side, so the side cannot tell them apart");
  if (keywords.some((keyword) => wording.includes(keyword.toUpperCase()))) refuse("it names the destroyed unit's keywords");
  if ((objectSide === "friendly" || objectSide === "enemy") && wording.includes(objectSide.toUpperCase())) refuse(`it names the destroyed unit's side (${objectSide})`);
  const destroyerKeywords = [...((destroyer.parameters.keywords as string[] | undefined) ?? [])];
  const namesDestroyer = (destroyerSide !== undefined && wording.includes(destroyerSide.toUpperCase())) || destroyerKeywords.some((keyword) => wording.includes(keyword.toUpperCase()));
  if (!namesDestroyer) refuse("it names neither the destroyer's side nor its keywords");
}

/**
 * Whether `out` ends with the destruction at `eventIndex` of `list`, whose destroyer filter is the
 * leaf after it: the fold's precondition. Compares start bytes, since `out` holds folded copies.
 */
export function destroyedByFilterAfter(out: readonly CompileLeaf[], list: readonly CompileLeaf[], filterIndex: number, sourceText: string | undefined): boolean {
  const eventIndex = filterIndex - 1;
  const event = out.at(-1);
  if (eventIndex < 0 || event === undefined || list[eventIndex] === undefined || event.start_byte !== list[eventIndex]!.start_byte || event.family_id !== "event") return false;
  return trailingDestroyerFilter(list, eventIndex, sourceText) === filterIndex;
}

/**
 * Set the destruction at the end of `out` to take `subject` (the destroyer's unit-filter) as its
 * subject. Refuses a destruction whose subject is already set.
 */
export function foldDestroyedByFilter(out: CompileLeaf[], subject: Record<string, unknown>): void {
  const event = out.at(-1)!;
  if (event.parameters.subject_filter !== undefined) throw new CompileError("A destruction already has a subject; it cannot also take one from a unit-filter after it.");
  out[out.length - 1] = { ...event, parameters: { ...event.parameters, subject_filter: subject } };
}
