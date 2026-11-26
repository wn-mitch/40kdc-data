/**
 * What-if changes to one datasheet, measured with the same crunch as its features: each weapon
 * change is applied to every weapon line the unit's best stack fires and re-crunched, each
 * durability change to its stat line. The fit turns the measured change into points, which is
 * how the audit answers "what is +1 Toughness worth here" or "Lethal Hits or Sustained Hits".
 *
 * Weapon changes are crunched without ability buffs, so they price the weapon itself.
 *
 * @packageDocumentation
 */
import type { ComparePhase, ResolvedTarget } from "../compare.js";
import { crunch, type Buff, type EngineContext } from "../cruncher/index.js";
import type { Dataset } from "../data/dataset.js";
import type { Unit, Weapon } from "../generated.js";

type Profile = Weapon["profiles"][number];
type KeywordRef = NonNullable<Profile["keywords"]>[number];

/** A weapon change: a new profile, or null when it does not apply to this profile. */
export type WeaponTweak = { id: string; label: string; apply(profile: Profile): Profile | null };

/** `value` raised by one: a number, or a dice expression's flat part. Null when it has no number to raise. */
function plusOne(value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value !== "string") return null;
  const flat = /^(.*)\+(\d+)$/.exec(value);
  if (flat) return `${flat[1]}+${Number(flat[2]) + 1}`;
  return /^\d*D\d+$/i.test(value) ? `${value}+1` : null;
}

function withStat(profile: Profile, stat: string, value: unknown): Profile | null {
  return value === null ? null : { ...profile, stats: { ...profile.stats, [stat]: value } } as Profile;
}

function hasKeyword(profile: Profile, id: string): boolean {
  return (profile.keywords ?? []).some((ref) => ref.keyword_id === id);
}

function addKeyword(id: string, parameters?: KeywordRef["parameters"]): WeaponTweak["apply"] {
  return (profile) => hasKeyword(profile, id) ? null : { ...profile, keywords: [...(profile.keywords ?? []), { keyword_id: id, ...(parameters ? { parameters } : {}) } as KeywordRef] };
}

/** Weapon keywords whose price the audit compares by adding each to every weapon without it. */
export const ADDED_KEYWORDS: readonly { id: string; label: string; parameters?: KeywordRef["parameters"] }[] = [
  { id: "lethal-hits", label: "Lethal Hits" },
  { id: "sustained-hits", label: "Sustained Hits 1", parameters: { value: 1 } as KeywordRef["parameters"] },
  { id: "devastating-wounds", label: "Devastating Wounds" },
  { id: "twin-linked", label: "Twin-linked" },
];

export const WEAPON_TWEAKS: readonly WeaponTweak[] = [
  { id: "A+1", label: "+1 Attacks", apply: (p) => withStat(p, "A", plusOne(p.stats.A)) },
  { id: "S+1", label: "+1 Strength", apply: (p) => withStat(p, "S", plusOne(p.stats.S)) },
  { id: "AP+1", label: "+1 AP (one better)", apply: (p) => typeof p.stats.AP === "number" ? withStat(p, "AP", p.stats.AP - 1) : null },
  { id: "D+1", label: "+1 Damage", apply: (p) => withStat(p, "D", plusOne(p.stats.D)) },
  {
    id: "skill+1",
    label: "+1 BS/WS (one better)",
    apply: (p) => {
      const stat = "BS" in p.stats ? "BS" : "WS" in p.stats ? "WS" : null;
      const value = stat ? (p.stats as Record<string, unknown>)[stat] : null;
      return stat && typeof value === "number" && value > 2 ? withStat(p, stat, value - 1) : null;
    },
  },
  ...ADDED_KEYWORDS.map(({ id, label, parameters }) => ({ id: `add:${id}`, label: `Add ${label}`, apply: addKeyword(id, parameters) })),
];

/** The change that removes keyword `id` from a weapon carrying it: what that keyword is worth on it. */
export function dropKeyword(id: string): WeaponTweak {
  return {
    id: `drop:${id}`,
    label: `Its ${id}`,
    apply: (profile) => hasKeyword(profile, id) ? { ...profile, keywords: (profile.keywords ?? []).filter((ref) => ref.keyword_id !== id) } : null,
  };
}

/** The engine context a weapon line is crunched under: the favourable state the damage matrix assumes. */
export function lineContext(phase: ComparePhase): EngineContext {
  return {
    phase,
    attackerTurn: true,
    targetVisible: true,
    attackerStrength: "full",
    targetStrength: "full",
    withinHalfRange: true,
    distanceInches: 1,
    attackerStationary: phase === "shooting",
    attackerCharged: phase === "fight",
  };
}

/** Expected wounds `count` models deal with `profile` of `weapon`; 0 when it cannot target or crunch. */
export function lineDamage(ds: Dataset, weapon: Weapon, profile: Profile, count: number, target: ResolvedTarget, defence: readonly Buff[], phase: ComparePhase): number {
  const changed = { ...weapon, profiles: [profile] } as Weapon;
  try {
    return crunch({
      attacker: { weapon: changed, profileIndex: 0 },
      target: { unit: target.unitRaw, profileIndex: 0, modelCount: target.modelCount },
      modelsFiring: count,
      buffs: [...defence],
      context: lineContext(phase),
    }, ds).damageDealt;
  } catch {
    return 0;
  }
}

/** A durability change: a new stat line, or extra defensive buffs. */
export type DurabilityTweak = { id: string; label: string; unit?(unit: Unit): Unit | null; buffs?: Buff[] };

function profiles(unit: Unit, change: (profile: Unit["profiles"][number]) => Unit["profiles"][number] | null): Unit | null {
  const changed = (unit.profiles ?? []).map(change);
  return changed.every((profile) => profile !== null) ? { ...unit, profiles: changed as Unit["profiles"] } : null;
}

const manual = (label: string, contribution: Buff["contribution"]): Buff => ({ source: { kind: "manual", label }, contribution });

export const DURABILITY_TWEAKS: readonly DurabilityTweak[] = [
  { id: "T+1", label: "+1 Toughness", unit: (u) => profiles(u, (p) => ({ ...p, T: p.T + 1 })) },
  { id: "W+1", label: "+1 Wound per model", unit: (u) => profiles(u, (p) => typeof p.W === "number" ? { ...p, W: p.W + 1 } : null) },
  { id: "Sv+1", label: "+1 Save (one better)", unit: (u) => profiles(u, (p) => typeof p.Sv === "number" && p.Sv > 2 ? { ...p, Sv: p.Sv - 1 } : null) },
  {
    id: "invuln-4",
    label: "4+ invulnerable save",
    unit: (u) => profiles(u, (p) => typeof p.invuln_sv === "number" && p.invuln_sv <= 4 ? null : { ...p, invuln_sv: 4 }),
  },
  { id: "fnp-5", label: "5+ Feel No Pain", buffs: [manual("fnp-5", { type: "feel-no-pain", threshold: 5 })] },
  { id: "damage-1", label: "-1 Damage", buffs: [manual("damage-1", { type: "damage-reduction", value: 1 })] },
];
