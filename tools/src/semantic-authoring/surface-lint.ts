/**
 * Warnings for a decided spelling whose wording says more than its meaning: a composed leaf
 * that should be split. They are shown beside the spelling, never applied automatically.
 */

/** Families whose own parameters already say melee or ranged. */
const LIMITS_ATTACK_TYPE = new Set(["attack", "weapon-ability-grant"]);

export function surfaceWarnings(text: string, role: string, familyId: string, parameters: Record<string, unknown>): string[] {
  const words = text.toLowerCase();
  const warnings: string[] = [];
  const limited = /\b(melee|ranged)\b/u.exec(words)?.[1];
  const typed = parameters.attack_type ?? parameters.weapon_type;
  if (limited && !(LIMITS_ATTACK_TYPE.has(familyId) && typed === limited)) {
    warnings.push(`Says ${limited}, but this meaning does not limit attacks to ${limited}; split the attack into its own leaf.`);
  }
  if (role === "EFFECT" && /\btargets?\b/u.test(words)) warnings.push("Names what an attack targets; split the target into its own condition leaf.");
  if (role === "EFFECT" && /\b(if|while|unless)\b/u.test(words)) warnings.push("Contains a condition; split it into its own condition leaf.");
  if (familyId !== "regain-wounds" && /\bregains?\b.*\blost wounds?\b/u.test(words)) warnings.push("Reads as regaining lost wounds; move it to the regain lost wounds leaf.");
  if (role !== "COMBINATOR" && /\binstead\b/u.test(words)) warnings.push("Contains \"instead\"; split it into the instead leaf.");
  return warnings;
}
