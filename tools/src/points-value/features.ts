/**
 * What one datasheet brings, measured: the offense the hill climb finds for it (its best legal
 * loadout and datasheet levers, at full strength, against each reference target in each phase),
 * the durability its stat line and datasheet abilities give against reference attacks, and the
 * mobility, board-control and utility rules no damage number captures.
 *
 * Every measure is taken twice. `full` counts the unit's own datasheet abilities; `bare` drops
 * every ability record, so the unit fights with its stat line, weapons and weapon keywords only.
 * Army rules, detachments, Stratagems, other units' auras and Orders are never counted: this
 * prices the datasheet, not the army around it.
 *
 * A Leader or Support unit is priced at its best attachment, as the hill climb would field it:
 * its offense is what attaching it adds to the bodyguard it adds the most to (its own weapons and
 * its buffs to the bodyguard), its durability its own stat line.
 *
 * @packageDocumentation
 */
import { resolveTarget, type ComparePhase, type ResolvedTarget } from "../compare.js";
import { crunch, modifiedWounds, resolveBuffs, type Buff, type EngineContext } from "../cruncher/index.js";
import { baseWargear, targetEquippedBuffs } from "../stack-damage/weapon-grants.js";
import type { Dataset } from "../data/dataset.js";
import type { UnitView } from "../data/entities.js";
import type { Unit, Weapon } from "../generated.js";
import type { MatrixConfig } from "../stack-damage/config.js";
import { fullModelCount, resolveFactionContext, type FactionContext } from "../stack-damage/factions.js";
import type { StackMember, StackResult } from "../stack-damage/model.js";
import { damageScoringSession, emptySpec } from "../stack-damage/search.js";
import { reachesOtherUnits } from "../abilities-resolver/resolver.js";
import { DURABILITY_TWEAKS, WEAPON_TWEAKS, dropKeyword, lineDamage, type WeaponTweak } from "./marginal.js";

export const PHASES: readonly ComparePhase[] = ["shooting", "fight"];

/** The reference targets offense is measured against by default: one per broad archetype. */
export const DEFAULT_TARGET_IDS = [
  "geq-guardsmen",
  "meq-intercessors",
  "teq-terminators",
  "predator",
  "questoris-knight",
  "ctan-shard",
] as const;

/** Targets that count as infantry for the anti-infantry / anti-armour split. */
export const INFANTRY_TARGET_IDS: ReadonlySet<string> = new Set(["geq-guardsmen", "meq-intercessors", "teq-terminators"]);

/** One reference attack that durability is measured against. */
export interface ReferenceAttack {
  id: string;
  label: string;
  phase: ComparePhase;
  weapon: Weapon;
}

function referenceWeapon(id: string, name: string, melee: boolean, stats: Record<string, number | string>): Weapon {
  return {
    id,
    name,
    type: melee ? "melee" : "ranged",
    profiles: [{ name, range: melee ? "Melee" : 24, stats: { A: 1, ...(melee ? { WS: 3 } : { BS: 3 }), ...stats }, keywords: [] }],
    game_version: { edition: "11th", dataslate: "reference" },
  } as unknown as Weapon;
}

/**
 * Single attacks hitting on 3+, from light small arms to anti-tank. Durability against each is
 * the number of them it takes to destroy the whole unit.
 */
export const REFERENCE_ATTACKS: readonly ReferenceAttack[] = [
  { id: "small-arms", label: "S4 AP0 D1", phase: "shooting", weapon: referenceWeapon("ref-small-arms", "Small arms", false, { S: 4, AP: 0, D: 1 }) },
  { id: "plasma", label: "S7 AP-2 D2", phase: "shooting", weapon: referenceWeapon("ref-plasma", "Plasma", false, { S: 7, AP: -2, D: 2 }) },
  { id: "anti-tank", label: "S12 AP-3 D3+3", phase: "shooting", weapon: referenceWeapon("ref-anti-tank", "Anti-tank", false, { S: 12, AP: -3, D: "D3+3" }) },
  { id: "power-fist", label: "S8 AP-2 D2 melee", phase: "fight", weapon: referenceWeapon("ref-power-fist", "Power fist", true, { S: 8, AP: -2, D: 2 }) },
];

/** Core abilities whose value no damage or durability measure captures, flagged by id. */
export const CORE_FLAGS = ["deep-strike", "scouts", "infiltrators", "lone-operative", "fights-first", "stealth", "deadly-demise", "firing-deck", "hover"] as const;

/**
 * Datasheet-ability effect families the crunch does not score, mapped to the utility flag they
 * raise. Damage-path effects (characteristic, re-roll, roll and save modifiers, weapon keyword
 * grants, mortal wounds, Feel No Pain) are already in the offense and durability measures.
 */
const EFFECT_FLAGS: Record<string, string> = {
  move: "mobility",
  "move-modifier": "mobility",
  "set-up": "mobility",
  permission: "mobility",
  "objective-sticky": "objective-control",
  "cost-modifier": "cp-economy",
  heal: "regeneration",
  "return-models": "regeneration",
  "add-unit": "regeneration",
  test: "control",
  designate: "control",
  targeting: "control",
  "state-change": "control",
  aura: "aura",
};

export const UTILITY_FLAGS: readonly string[] = [...new Set(Object.values(EFFECT_FLAGS))].sort();

/** Keywords that set a unit's chassis, each its own price term. */
export const TYPE_KEYWORDS = ["Vehicle", "Monster", "Mounted", "Character", "Epic Hero", "Battleline", "Fly", "Titanic"] as const;

export interface Measures {
  /** Expected wounds dealt, by phase then target profile id. */
  offense: Record<string, Record<string, number>>;
  /** Reference attacks it takes to destroy the unit, by reference attack id. */
  durability: Record<string, number>;
}

/** The selected weapons of the winning stack: one row per profile fired, for what-if pricing. */
export interface SelectedLine {
  phase: ComparePhase;
  targetId: string;
  weaponId: string;
  profileIndex: number;
  count: number;
}

export interface UnitFeatures {
  unitId: string;
  unitName: string;
  factionId: string;
  role: "unit" | "leader" | "support";
  /** The bodyguard a Leader or Support unit is priced attached to; absent when it has none. */
  attachedTo?: string;
  /** First-copy points at {@link modelCount}; null for an unpriced (custom) datasheet. */
  points: number | null;
  modelCount: number;
  wounds: number;
  M: number;
  OC: number;
  Ld: number;
  keywords: string[];
  flags: string[];
  full: Measures;
  bare: Measures;
  /** The weapon lines the full stack fires, by phase and target. */
  lines: SelectedLine[];
  /**
   * Each what-if change's effect on the measures ({@link WEAPON_TWEAKS}, {@link DURABILITY_TWEAKS},
   * and `drop:<keyword>` for each keyword its fired weapons carry), by tweak id. Only the measures
   * a change moves are present.
   */
  tweaks: Record<string, Partial<Measures>>;
  /**
   * What the unit's rules add to each other friendly unit they reach when it is nearby (auras,
   * selections of friendly units), by that unit: its extra wounds dealt and the extra reference
   * attacks it takes to destroy. Only neighbours it adds anything to are listed; the fit prices the
   * unit at the neighbour its rules are worth the most points on.
   */
  auras: AuraGain[];
  /** Resources the unit's datasheet rules generate, counted per rule: Command points, and any other pool. */
  resources: { cp: number; other: number };
}

export interface AuraGain {
  neighbourId: string;
  delta: Partial<Measures>;
}

/** The points a unit costs at `models` models as an army's first copy of it, or null when unpriced. */
export function firstCopyPoints(unit: Unit, models: number): number | null {
  const first = (unit.points ?? []).filter((entry) => (entry.unit_count_min ?? 1) <= 1);
  const exact = first.find((entry) => entry.models === models);
  if (exact) return exact.cost;
  const largest = [...first].sort((left, right) => right.models - left.models)[0];
  return largest?.cost ?? null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function abilityIds(unit: Unit): string[] {
  return (unit.ability_ids ?? []).map((ref) => typeof ref === "string" ? ref : String((ref as { id: unknown }).id));
}

/** A gain's printed amount: its number, else one (a dice amount, or one gained per event). */
function amountOf(value: unknown): number {
  return typeof value === "number" && value > 0 ? value : 1;
}

/**
 * The resources a unit's own datasheet rules generate, each rule's amount once: Command points
 * (`cp-gain`), and dice, tokens or points of any other pool (`resource-gain`, or a `resource-die`
 * that adds dice). How often a rule fires is not modelled; the fit prices a rule's typical yield.
 */
export function resourcesOf(ds: Dataset, unit: Unit): { cp: number; other: number } {
  const out = { cp: 0, other: 0 };
  for (const id of abilityIds(unit)) {
    const ability = ds.abilities.getInFaction(id, unit.faction_id) ?? ds.abilities.getAny(id);
    if (!ability || ability.raw.ability_type !== "unit") continue;
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      const modifier = (typeof record.modifier === "object" && record.modifier !== null ? record.modifier : {}) as Record<string, unknown>;
      if (record.type === "cp-gain") out.cp += amountOf(modifier.amount);
      else if (record.type === "resource-gain") out.other += amountOf(modifier.amount);
      else if (record.type === "resource-die" && modifier.operation === "add") out.other += amountOf(modifier.value);
      Object.values(record).forEach(visit);
    };
    visit(ability.raw.effect);
  }
  return out;
}

/** The utility flags a unit's datasheet raises: core abilities by id, its own abilities by effect family. */
export function utilityFlags(ds: Dataset, unit: Unit): string[] {
  const flags = new Set<string>();
  for (const id of abilityIds(unit)) {
    if ((CORE_FLAGS as readonly string[]).includes(id)) {
      flags.add(id);
      continue;
    }
    const ability = ds.abilities.getInFaction(id, unit.faction_id) ?? ds.abilities.getAny(id);
    if (!ability || ability.raw.ability_type !== "unit") continue;
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      const flag = typeof record.type === "string" ? EFFECT_FLAGS[record.type] : undefined;
      if (flag && ("modifier" in record || "target" in record)) flags.add(flag);
      if (record.type === "stat-modifier") {
        const stat = (record.modifier as { stat?: unknown } | undefined)?.stat;
        if (stat === "OC") flags.add("objective-control");
        if (stat === "M") flags.add("mobility");
      }
      Object.values(record).forEach(visit);
    };
    visit(ability.raw.effect);
  }
  return [...flags].sort();
}

function matrixConfig(factionId: string, dropped: string[]): MatrixConfig {
  return {
    factionIds: [factionId],
    targetIds: [],
    phases: [],
    outputPath: "",
    bodyguardLimit: Infinity,
    attachmentLimit: Infinity,
    finalistLimit: 1,
    perUnitFinalists: null,
    detail: false,
    perFiveSensitivity: false,
    droppedArmyRules: dropped,
    dpBudget: 0,
    maxDetachments: 0,
    workers: 1,
    // A unit a rule reaches is priced with the rule's provider nearby, within its range.
    scenario: { providersInRange: true },
  };
}

/** The unit's datasheet abilities that defend it, as always-on buffs; none when `bare`. */
function defensiveBuffs(ds: Dataset, unit: Unit, context: EngineContext, bare: boolean): Buff[] {
  if (bare) return [];
  return ds.defensiveBuffsFor({ unitId: unit.id, factionId: unit.faction_id }, context)
    .filter((buff) => buff.source.kind !== "ability" || buff.source.abilityKind === "unit");
}

/** Reference attacks it takes to destroy `unit` at `modelCount` models, by reference attack id. */
export function durabilityOf(ds: Dataset, unit: Unit, modelCount: number, bare: boolean, extra: readonly Buff[] = []): Record<string, number> {
  // The unit's printed rules for wargear its out-of-the-box loadout leaves out do not apply.
  const carried = new Map(Object.entries(baseWargear(ds, unit, modelCount)));
  const out: Record<string, number> = {};
  for (const attack of REFERENCE_ATTACKS) {
    const context: EngineContext = { phase: attack.phase, withinHalfRange: false, attackerTurn: true, targetVisible: true, targetWargear: Object.fromEntries(carried) };
    try {
      const buffs = [...targetEquippedBuffs(ds, unit, carried, modelCount, defensiveBuffs(ds, unit, context, bare)), ...extra];
      const wounds = modifiedWounds(num(unit.profiles?.[0]?.W), resolveBuffs(buffs, context)) * modelCount;
      const dealt = crunch({
        attacker: { weapon: attack.weapon, profileIndex: 0 },
        target: { unit, profileIndex: 0, modelCount },
        modelsFiring: 1,
        buffs,
        context,
      }, ds).damageDealt;
      out[attack.id] = dealt > 0 ? wounds / dealt : 0;
    } catch {
      out[attack.id] = 0;
    }
  }
  return out;
}

/** The faction's own army-rule ability ids (its lineage's), which datasheet pricing never counts. */
function armyRuleIds(ds: Dataset, faction: FactionContext): string[] {
  return faction.lineage.flatMap((id) => ds.abilities.byFaction(id)).filter((ability) => ability.raw.ability_type === "faction").map((ability) => ability.id);
}

/** The matrix config that scores a faction's datasheets alone: its army rules dropped, no detachment. */
export function datasheetConfig(ds: Dataset, factionId: string): MatrixConfig {
  return matrixConfig(factionId, armyRuleIds(ds, resolveFactionContext(ds, factionId)));
}

/** Units priced in `factionId`'s own datasheet list: its own, current, priced, matched-play records. */
export function pricedUnits(ds: Dataset, faction: FactionContext): UnitView[] {
  return faction.units.filter((unit) =>
    unit.raw.faction_id === faction.id && unit.raw.is_legend !== true &&
    firstCopyPoints(unit.raw, fullModelCount(ds, unit.raw)) !== null);
}

export interface FeatureOptions {
  targetIds: readonly string[];
  /** Measure only these units of the faction (priced or not); every priced unit when omitted. */
  unitIds?: readonly string[];
  log?: (line: string) => void;
}

type Cell = { phase: ComparePhase; targetId: string; target: ResolvedTarget };

/**
 * Every priced unit of one faction, measured. Sessions run with no faction units in them, so no
 * other unit's aura or Orders reaches a stack; `bare` sessions drop every ability record.
 */
export function factionFeatures(ds: Dataset, factionId: string, options: FeatureOptions): UnitFeatures[] {
  const { targetIds, log = () => {} } = options;
  const faction = resolveFactionContext(ds, factionId);
  // No support providers or Officers: only the stack's own datasheets count.
  const isolated: FactionContext = { ...faction, units: [] };
  const units = options.unitIds
    ? options.unitIds.map((id) => {
      const unit = faction.units.find((candidate) => candidate.id === id);
      if (!unit) throw new Error(`unit ${id} is not in ${factionId}'s datasheets`);
      return unit;
    })
    : pricedUnits(ds, faction);
  const allAbilityIds = ds.abilities.all.map((ability) => ability.id);
  const configs = { full: matrixConfig(factionId, armyRuleIds(ds, faction)), bare: matrixConfig(factionId, allAbilityIds) };
  const cells: Cell[] = PHASES.flatMap((phase) => targetIds.map((targetId) => {
    const profile = ds.targetProfiles.get(targetId);
    const target = profile ? resolveTarget(ds, profile) : null;
    if (!target) throw new Error(`unknown target profile ${targetId}`);
    return { phase, targetId, target };
  }));

  const hosts = (unit: UnitView): UnitView[] => ds.bodyguardsAttachableFrom(unit.id, factionId)
    .flatMap((host) => {
      const resolved = faction.units.find((candidate) => candidate.id === host.id);
      return resolved && !resolved.raw.attachment_role ? [resolved] : [];
    });

  // offense[mode][unitId][hostId|""][cellIndex] = wounds dealt; lines from the full mode.
  type Scores = Map<string, Map<string, number[]>>;
  const scores: Record<"full" | "bare", Scores> = { full: new Map(), bare: new Map() };
  const lines = new Map<string, Map<string, SelectedLine[]>>();
  for (const mode of ["full", "bare"] as const) {
    cells.forEach((cell, index) => {
      const session = damageScoringSession({ dataset: ds, config: configs[mode], faction: isolated, target: cell.target, phase: cell.phase });
      const alone = new Map<string, StackResult>();
      const run = (members: StackMember[]): StackResult => session.optimiseLevers(emptySpec(factionId, members));
      const record = (unitId: string, hostId: string, value: number, result?: StackResult) => {
        const byHost = scores[mode].get(unitId) ?? new Map<string, number[]>();
        const values = byHost.get(hostId) ?? [];
        values[index] = value;
        byHost.set(hostId, values);
        scores[mode].set(unitId, byHost);
        if (mode === "full" && result) {
          const unitLines = lines.get(unitId) ?? new Map<string, SelectedLine[]>();
          const hostLines = unitLines.get(hostId) ?? [];
          for (const member of result.members) {
            if (hostId !== "" && member.member.unit.id === hostId) continue;
            for (const weapon of member.loadout.selectedWeapons) {
              hostLines.push({ phase: cell.phase, targetId: cell.targetId, weaponId: weapon.weaponId, profileIndex: weapon.profileIndex, count: weapon.count });
            }
          }
          unitLines.set(hostId, hostLines);
          lines.set(unitId, unitLines);
        }
      };
      const hostAlone = (host: UnitView): StackResult => {
        let result = alone.get(host.id);
        if (!result) alone.set(host.id, result = run([{ unit: host, role: "bodyguard" }]));
        return result;
      };
      for (const unit of units) {
        const role = unit.raw.attachment_role;
        const candidates = role ? hosts(unit) : [];
        if (candidates.length === 0) {
          const result = run([{ unit, role: "bodyguard" }]);
          record(unit.id, "", result.total, result);
          continue;
        }
        for (const host of candidates) {
          const stack = run([{ unit: host, role: "bodyguard" }, { unit, role: role === "support" ? "support" : "leader" }]);
          record(unit.id, host.id, stack.total - hostAlone(host).total, stack);
        }
      }
      log(`${factionId} ${mode} ${cell.phase} ${cell.targetId}`);
    });
  }
  const auras = auraGains(ds, faction, isolated, units, configs.full, cells);
  log(`${factionId} auras`);

  return units.map((unit) => {
    const raw = unit.raw;
    const modelCount = fullModelCount(ds, raw);
    const profile = raw.profiles?.[0];
    const full = scores.full.get(unit.id) ?? new Map<string, number[]>();
    // The attachment the hill climb would field: the host whose full stack gains the most, summed over cells.
    const hostIds = [...full.keys()];
    const gain = (hostId: string) => (full.get(hostId) ?? []).reduce((sum, value) => sum + (value ?? 0), 0);
    const hostId = hostIds.sort((left, right) => gain(right) - gain(left) || left.localeCompare(right))[0] ?? "";
    const measures = (mode: "full" | "bare"): Measures => {
      const values = scores[mode].get(unit.id)?.get(hostId) ?? [];
      const offense: Record<string, Record<string, number>> = {};
      cells.forEach((cell, index) => {
        (offense[cell.phase] ??= {})[cell.targetId] = Math.max(0, values[index] ?? 0);
      });
      return { offense, durability: durabilityOf(ds, raw, modelCount, mode === "bare") };
    };
    const role: UnitFeatures["role"] = raw.attachment_role === "leader" ? "leader" : raw.attachment_role === "support" ? "support" : "unit";
    const features: UnitFeatures = {
      unitId: unit.id,
      unitName: unit.name,
      factionId,
      role,
      ...(hostId ? { attachedTo: hostId } : {}),
      points: firstCopyPoints(raw, modelCount),
      modelCount,
      wounds: num(profile?.W) * modelCount,
      M: num(profile?.M),
      OC: num(profile?.OC) * modelCount,
      Ld: num(profile?.Ld),
      keywords: [...(raw.keywords ?? [])],
      flags: utilityFlags(ds, raw),
      full: measures("full"),
      bare: measures("bare"),
      lines: lines.get(unit.id)?.get(hostId) ?? [],
      tweaks: {},
      auras: auras.get(unit.id) ?? [],
      resources: resourcesOf(ds, raw),
    };
    return features;
  }).map((features) => ({ ...features, tweaks: tweaksOf(ds, features, cells) }));
}

/** {@link UnitFeatures.tweaks} for a measured unit. */
function tweaksOf(ds: Dataset, features: UnitFeatures, cells: readonly Cell[]): Record<string, Partial<Measures>> {
  const out: Record<string, Partial<Measures>> = {};
  const defence = cells.map((cell) => ds.defensiveBuffsFor({ unitId: cell.target.unitRaw.id, factionId: cell.target.unitRaw.faction_id }, { phase: cell.phase, withinHalfRange: true }));
  const weapons = new Map<string, Weapon>();
  const weaponOf = (id: string) => {
    if (!weapons.has(id)) {
      const view = ds.weapons.getInFaction(id, features.factionId) ?? ds.weapons.getAny(id);
      if (view) weapons.set(id, view.raw);
    }
    return weapons.get(id);
  };
  const carried = new Set<string>();
  for (const line of features.lines) {
    for (const ref of weaponOf(line.weaponId)?.profiles[line.profileIndex]?.keywords ?? []) carried.add(ref.keyword_id);
  }
  const tweaks: WeaponTweak[] = [...WEAPON_TWEAKS, ...[...carried].sort().map(dropKeyword)];
  for (const tweak of tweaks) {
    const offense: Record<string, Record<string, number>> = {};
    let moved = false;
    cells.forEach((cell, index) => {
      let delta = 0;
      for (const line of features.lines) {
        if (line.phase !== cell.phase || line.targetId !== cell.targetId) continue;
        const weapon = weaponOf(line.weaponId);
        const profile = weapon?.profiles[line.profileIndex];
        const changed = profile ? tweak.apply(profile) : null;
        if (!weapon || !profile || !changed) continue;
        delta += lineDamage(ds, weapon, changed, line.count, cell.target, defence[index], cell.phase)
          - lineDamage(ds, weapon, profile, line.count, cell.target, defence[index], cell.phase);
      }
      if (Math.abs(delta) > 1e-9) moved = true;
      (offense[cell.phase] ??= {})[cell.targetId] = delta;
    });
    if (moved) out[tweak.id] = { offense };
  }
  const unit = ds.units.getInFaction(features.unitId, features.factionId)?.raw;
  if (!unit) return out;
  for (const tweak of DURABILITY_TWEAKS) {
    const changed = tweak.unit ? tweak.unit(unit) : unit;
    if (!changed) continue;
    const after = durabilityOf(ds, changed, features.modelCount, false, tweak.buffs ?? []);
    const durability = Object.fromEntries(Object.entries(after).map(([id, value]) => [id, value - (features.full.durability[id] ?? 0)]));
    if (Object.values(durability).some((value) => Math.abs(value) > 1e-9)) out[tweak.id] = { durability };
  }
  return out;
}

/** Whether a unit's own datasheet rules reach other friendly units in some phase it attacks in. */
function providesToOthers(unit: UnitView): boolean {
  return unit.abilities.some((ability) => ability.raw.ability_type === "unit" && reachesOtherUnits(ability.raw.effect));
}

/**
 * {@link UnitFeatures.auras} for each of `units` whose rules reach other units: each other unit of
 * the faction without an attachment role, crunched with the provider nearby (its rules reaching
 * that unit as a support provider's do) against crunched alone. A neighbour none of whose levers
 * the provider supplies is skipped unscored.
 */
function auraGains(ds: Dataset, faction: FactionContext, isolated: FactionContext, units: readonly UnitView[], config: MatrixConfig, cells: readonly Cell[]): Map<string, AuraGain[]> {
  const out = new Map<string, AuraGain[]>();
  const providers = units.filter(providesToOthers);
  if (providers.length === 0) return out;
  const neighbours = pricedUnits(ds, faction).filter((unit) => !unit.raw.attachment_role);
  const alone = cells.map((cell) => {
    const session = damageScoringSession({ dataset: ds, config, faction: isolated, target: cell.target, phase: cell.phase });
    const cache = new Map<string, number>();
    return (unit: UnitView) => {
      let total = cache.get(unit.id);
      if (total === undefined) cache.set(unit.id, total = session.optimiseLevers(emptySpec(faction.id, [{ unit, role: "bodyguard" }])).total);
      return total;
    };
  });
  for (const provider of providers) {
    const nearby: FactionContext = { ...faction, units: [provider] };
    const gains = new Map<string, Partial<Measures>>();
    cells.forEach((cell, index) => {
      const session = damageScoringSession({ dataset: ds, config, faction: nearby, target: cell.target, phase: cell.phase });
      for (const neighbour of neighbours) {
        if (neighbour.id === provider.id) continue;
        const spec = emptySpec(faction.id, [{ unit: neighbour, role: "bodyguard" }]);
        const supplied = session.pool(spec).levers.some((lever) => lever.source.kind === "ability" && lever.source.sourceUnitId === provider.id);
        if (!supplied) continue;
        const delta = session.optimiseLevers(spec).total - alone[index](neighbour);
        if (delta <= 1e-9) continue;
        const gain = gains.get(neighbour.id) ?? {};
        ((gain.offense ??= {})[cell.phase] ??= {})[cell.targetId] = delta;
        gains.set(neighbour.id, gain);
      }
    });
    for (const neighbour of neighbours) {
      if (neighbour.id === provider.id) continue;
      const context: EngineContext = { phase: "shooting", withinHalfRange: false, attackerTurn: true, targetVisible: true, providersInRange: true };
      const supplied = ds.defensiveBuffsFor({ unitId: neighbour.id, factionId: faction.id, supportingUnitIds: [provider.id] }, context)
        .filter((buff) => buff.source.kind === "ability" && buff.source.abilityKind === "support" && buff.source.sourceUnitId === provider.id);
      if (supplied.length === 0) continue;
      const count = fullModelCount(ds, neighbour.raw);
      const before = durabilityOf(ds, neighbour.raw, count, false);
      const after = durabilityOf(ds, neighbour.raw, count, false, supplied);
      const durability = Object.fromEntries(Object.entries(after).map(([id, value]) => [id, value - (before[id] ?? 0)]));
      if (!Object.values(durability).some((value) => value > 1e-9)) continue;
      gains.set(neighbour.id, { ...(gains.get(neighbour.id) ?? {}), durability });
    }
    out.set(provider.id, [...gains].sort(([a], [b]) => a.localeCompare(b)).map(([neighbourId, delta]) => ({ neighbourId, delta })));
  }
  return out;
}
