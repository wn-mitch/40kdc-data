/**
 * {@link Dataset} ties the embedded records together: it owns every
 * {@link Collection}, builds the cross-entity indexes once, and is the `this`
 * the linked views resolve against.
 *
 * @packageDocumentation
 */
import type {
  DeploymentPattern,
  Detachment,
  Enhancement,
  ForceDisposition,
  GameVersion,
  InteractionFlag,
  LeaderAttachment,
  Mission,
  MissionMatchup,
  Phase,
  ResourcePool,
  SecondaryCard,
  Stratagem,
  TimingFlag,
  Unit,
  UnitComposition,
  WargearOption,
  WeaponKeyword,
} from "../generated.js";
import { Collection } from "./collection.js";
import {
  AbilityView,
  FactionView,
  UnitView,
  WeaponKeywordView,
  WeaponView,
} from "./entities.js";
import { emptyRawData, type RawData } from "./types.js";
import { RAW_DATA } from "./bundle.generated.js";
import type { Buff, BuffSource, EngineContext } from "../cruncher/buffs.js";
import {
  resolveEligibleAbilities,
  type EligibilityInput,
  type EligibleAbility,
} from "../abilities-resolver/index.js";

/**
 * One toggleable buff lever for damage analysis: the contributions it adds and
 * whether it's on by default. `enabled` is `true` for buffs that always apply
 * (intrinsic keywords, unconditional abilities) and `false` for player
 * decisions — stratagems (CP cost) and activatable gates (dice-pool options,
 * `choice` branches, timing-gated activations). A consumer flips `enabled`,
 * then crunches the enabled subset; an optimizer searches it.
 *
 * @see {@link Dataset.stackableBuffsFor}
 */
export type StackableBuff = {
  /** Stable toggle id (stable across re-enumeration of the same input). */
  id: string;
  /** Human label for the lever. */
  label: string;
  /** Contributions this lever adds when enabled (≥1). */
  buffs: Buff[];
  /** Default selection state. */
  enabled: boolean;
  /** Where the lever came from. */
  source: BuffSource;
  /** Id of the mutually-limited {@link StackableBuffGroup} this belongs to, if any. */
  group?: string;
};

/** A pool of {@link StackableBuff} levers limited to `maxActivations` at once. */
export type StackableBuffGroup = {
  id: string;
  label: string;
  maxActivations: number;
};

/** The whole dataset, with linked accessors over every entity collection. */
export class Dataset {
  // Richly-linked collections.
  readonly units: Collection<Unit, UnitView>;
  readonly weapons: Collection<RawData["weapons"][number], WeaponView>;
  readonly weaponKeywords: Collection<WeaponKeyword, WeaponKeywordView>;
  readonly factions: Collection<RawData["factions"][number], FactionView>;
  readonly abilities: Collection<RawData["abilities"][number], AbilityView>;

  // Id-bearing collections without bespoke views (records returned as-is).
  readonly detachments: Collection<Detachment, Detachment>;
  readonly enhancements: Collection<Enhancement, Enhancement>;
  readonly stratagems: Collection<Stratagem, Stratagem>;
  readonly wargearOptions: Collection<WargearOption, WargearOption>;
  readonly missions: Collection<Mission, Mission>;
  readonly missionMatchups: Collection<MissionMatchup, MissionMatchup>;
  readonly secondaryCards: Collection<SecondaryCard, SecondaryCard>;
  readonly deploymentPatterns: Collection<DeploymentPattern, DeploymentPattern>;
  readonly forceDispositions: Collection<ForceDisposition, ForceDisposition>;
  readonly resourcePools: Collection<ResourcePool, ResourcePool>;

  // Id-less collections, exposed as plain arrays.
  readonly leaderAttachments: readonly LeaderAttachment[];
  readonly unitCompositions: readonly UnitComposition[];
  readonly gameVersions: readonly GameVersion[];
  readonly timingFlags: readonly TimingFlag[];
  readonly interactionFlags: readonly InteractionFlag[];
  readonly phaseMappings: readonly RawData["phaseMappings"][number][];

  /** `source_type:source_id` → unioned phases. */
  private readonly phaseIndex = new Map<string, Phase[]>();
  /** ability id → units that list it. */
  private readonly unitsByAbility = new Map<string, Unit[]>();
  /** weapon id → units that list it. */
  private readonly unitsByWeapon = new Map<string, Unit[]>();
  /** weapon-keyword id → weapons whose profiles reference it. */
  private readonly weaponsByKeyword = new Map<string, RawData["weapons"][number][]>();

  constructor(raw: RawData = emptyRawData()) {
    this.units = new Collection({
      items: raw.units,
      idOf: (u) => u.id,
      // The same unit id is shared across factions (e.g. ministorum-priest);
      // keep each faction's copy, collapse only true within-faction duplicates.
      dedupeKeyOf: (u) => `${u.faction_id}::${u.id}`,
      nameOf: (u) => u.name,
      factionOf: (u) => u.faction_id,
      wrap: (u) => new UnitView(u, this),
    });
    this.weapons = new Collection({
      items: raw.weapons,
      idOf: (w) => w.id,
      nameOf: (w) => w.name,
      wrap: (w) => new WeaponView(w, this),
    });
    this.weaponKeywords = new Collection({
      items: raw.weaponKeywords,
      idOf: (k) => k.id,
      nameOf: (k) => k.name,
      wrap: (k) => new WeaponKeywordView(k, this),
    });
    this.factions = new Collection({
      items: raw.factions,
      idOf: (f) => f.id,
      nameOf: (f) => f.name,
      wrap: (f) => new FactionView(f, this),
    });
    this.abilities = new Collection({
      items: raw.abilities,
      idOf: (a) => a.ability_id,
      nameOf: (a) => a.name,
      factionOf: (a) => a.faction_id,
      wrap: (a) => new AbilityView(a, this),
    });

    this.detachments = idCollection(raw.detachments, (d) => d.faction_id);
    this.enhancements = idCollection(raw.enhancements);
    this.stratagems = idCollection(raw.stratagems);
    this.wargearOptions = idCollection(raw.wargearOptions);
    this.missions = idCollection(raw.missions);
    this.missionMatchups = idCollection(raw.missionMatchups);
    this.secondaryCards = idCollection(raw.secondaryCards);
    this.deploymentPatterns = idCollection(raw.deploymentPatterns);
    this.forceDispositions = idCollection(raw.forceDispositions);
    this.resourcePools = idCollection(raw.resourcePools);

    this.leaderAttachments = raw.leaderAttachments;
    this.unitCompositions = raw.unitCompositions;
    this.gameVersions = raw.gameVersions;
    this.timingFlags = raw.timingFlags;
    this.interactionFlags = raw.interactionFlags;
    this.phaseMappings = raw.phaseMappings;

    this.buildIndexes(raw);
  }

  /** The dataset built from the package's embedded data. */
  static embedded(): Dataset {
    return new Dataset(RAW_DATA);
  }

  /** Phases a source acts in, unioned across its phase-mappings. */
  phasesFor(sourceType: string, sourceId: string): Phase[] {
    return this.phaseIndex.get(`${sourceType}:${sourceId}`) ?? [];
  }

  /** Units that list the given ability id. */
  unitsWithAbility(abilityId: string): UnitView[] {
    return (this.unitsByAbility.get(abilityId) ?? []).map((u) => new UnitView(u, this));
  }

  /** Units that list the given weapon id. */
  unitsWithWeapon(weaponId: string): UnitView[] {
    return (this.unitsByWeapon.get(weaponId) ?? []).map((u) => new UnitView(u, this));
  }

  /** Weapons whose profiles reference the given weapon-keyword id. */
  weaponsWithKeyword(keywordId: string): WeaponView[] {
    return (this.weaponsByKeyword.get(keywordId) ?? []).map((w) => new WeaponView(w, this));
  }

  /**
   * Enumerate every ability that could apply to the given unit in `phase`,
   * grouped by source. The SPA uses this to render the abilities pane.
   */
  eligibleAbilities(input: EligibilityInput, phase: Phase): EligibleAbility[] {
    return resolveEligibleAbilities(this, input, phase);
  }

  /**
   * Attacker-perspective {@link Buff} stack for a (unit, phase) combination:
   * intrinsic weapon-profile keywords plus every eligible ability whose DSL
   * effect translates to an attacker-side buff (army, detachment, unit,
   * leader, support, plus any stratagems the caller has opted into).
   *
   * The result includes only buffs the buff layer can express today — the
   * `unsupported` half of the DSL→Buff translation is dropped here so callers
   * who just want the stack don't need to thread diagnostics through. Use
   * {@link AbilityView.describeBuffs} when you need the diagnostics for an
   * individual ability. Symmetric to {@link defensiveBuffsFor}, which walks
   * the same eligibility set under target perspective.
   */
  buffsFor(
    input: EligibilityInput & {
      weaponProfiles?: { weaponId: string; profileIndex: number }[];
      /** Stratagem ids the caller has opted into spending CP on. */
      optedInStratagemIds?: string[];
    },
    context: EngineContext,
  ): Buff[] {
    return this.collectBuffs(input, context, "attacker");
  }

  /**
   * Defender-perspective buff stack for the chosen unit: walks the same
   * eligible-abilities set as {@link buffsFor} but translates each ability's
   * DSL effect as defensive (FNP, save mods from `stat-modifier Sv`,
   * toughness mods from `stat-modifier T`, save rerolls, incoming hit
   * penalties from `bs-modifier`). Use this when the chosen unit is being
   * crunched as the *target* — the engine reads `feelNoPain`/`saveMod`/
   * `toughnessMod` out of `resolveBuffs` so wiring the result into `crunch`
   * just means concatenating onto the existing `buffs` array.
   *
   * `weaponProfiles` are ignored under target perspective — weapon-keyword
   * effects ride with the firing weapon, not the receiving unit.
   */
  defensiveBuffsFor(
    input: EligibilityInput & { optedInStratagemIds?: string[] },
    context: EngineContext,
  ): Buff[] {
    return this.collectBuffs(input, context, "target");
  }

  /**
   * Enumerate every attacker-side buff a unit could stack in `context` as a
   * list of toggleable levers, plus the activation groups that limit them.
   *
   * Unlike {@link buffsFor} — which returns only the buffs that auto-apply —
   * this surfaces the *player decisions* too: stratagems, and the activatable
   * gates the DSL models as dice-pool options, `choice` branches, or
   * timing-gated activations (e.g. Blessings of Khorne's three keyword grants).
   * Each lever carries `enabled` (its default state) and, where it's part of a
   * limited pool, a `group` id whose {@link StackableBuffGroup} caps how many
   * can fire at once. The intended loop:
   *
   * ```ts
   * const { buffs } = ds.stackableBuffsFor(input, ctx);
   * const chosen = buffs.filter(b => b.enabled).flatMap(b => b.buffs);
   * crunch({ ...profiles, buffs: chosen, context: ctx }, ds);
   * ```
   *
   * Target/phase conditions a lever still carries (e.g. "vs Infantry") ride on
   * each buff's `applicableWhen`, so toggling it on is always safe — the
   * resolver gates it per-target.
   */
  stackableBuffsFor(
    input: EligibilityInput & {
      weaponProfiles?: { weaponId: string; profileIndex: number }[];
    },
    context: EngineContext,
  ): { buffs: StackableBuff[]; groups: StackableBuffGroup[] } {
    const buffs: StackableBuff[] = [];
    const groups = new Map<string, StackableBuffGroup>();

    // Intrinsic weapon-profile keywords — always on.
    for (const ref of input.weaponProfiles ?? []) {
      const weapon = this.weapons.get(ref.weaponId);
      if (!weapon) continue;
      const wk = weapon.profileBuffs(ref.profileIndex, context);
      if (wk.length === 0) continue;
      buffs.push({
        id: `weapon:${ref.weaponId}:${ref.profileIndex}`,
        label: `${weapon.name} keywords`,
        buffs: wk,
        enabled: true,
        source: wk[0].source,
      });
    }

    for (const entry of this.eligibleAbilities(input, context.phase)) {
      const source = bufferSourceFromEligible(entry);
      const { applied, activatable } = entry.ability.describeBuffs(source, context, "attacker");
      // Stratagems cost CP — opt-in, not on by default.
      const isStratagem = entry.source.kind === "detachment-stratagem";

      if (applied.length > 0) {
        buffs.push({
          id: `${entry.source.kind}:${entry.ability.id}`,
          label: entry.ability.name,
          buffs: applied,
          enabled: !isStratagem,
          source,
        });
      }

      for (const act of activatable) {
        let groupId: string | undefined;
        if (act.group) {
          groupId = act.group.id;
          if (!groups.has(groupId)) {
            groups.set(groupId, {
              id: groupId,
              label: entry.ability.name,
              maxActivations: act.group.maxActivations,
            });
          }
        }
        buffs.push({
          id: act.id,
          label: `${entry.ability.name} — ${act.label}`,
          buffs: act.buffs,
          enabled: false,
          source,
          group: groupId,
        });
      }
    }

    return { buffs, groups: [...groups.values()] };
  }

  /** Shared implementation for buffsFor / defensiveBuffsFor. */
  private collectBuffs(
    input: EligibilityInput & {
      weaponProfiles?: { weaponId: string; profileIndex: number }[];
      optedInStratagemIds?: string[];
    },
    context: EngineContext,
    perspective: "attacker" | "target",
  ): Buff[] {
    const out: Buff[] = [];

    // Weapon-profile keywords are attacker-only.
    if (perspective === "attacker") {
      for (const ref of input.weaponProfiles ?? []) {
        const weapon = this.weapons.get(ref.weaponId);
        if (!weapon) continue;
        out.push(...weapon.profileBuffs(ref.profileIndex, context));
      }
    }

    const optedIn = new Set(input.optedInStratagemIds ?? []);
    for (const entry of this.eligibleAbilities(input, context.phase)) {
      if (entry.source.kind === "detachment-stratagem" && !optedIn.has(entry.source.stratagemId)) {
        continue;
      }
      const source = bufferSourceFromEligible(entry);
      out.push(...entry.ability.getBuffs(source, context, perspective));
    }

    return out;
  }

  private buildIndexes(raw: RawData): void {
    for (const pm of raw.phaseMappings) {
      const key = `${pm.source_type}:${pm.source_id}`;
      const existing = this.phaseIndex.get(key) ?? [];
      for (const phase of pm.phases) {
        if (!existing.includes(phase)) existing.push(phase);
      }
      this.phaseIndex.set(key, existing);
    }
    for (const unit of raw.units) {
      for (const abilityId of unit.ability_ids ?? []) push(this.unitsByAbility, abilityId, unit);
      for (const weaponId of unit.weapon_ids ?? []) push(this.unitsByWeapon, weaponId, unit);
    }
    const seenByKeyword = new Map<string, Set<string>>();
    for (const weapon of raw.weapons) {
      for (const profile of weapon.profiles) {
        for (const ref of profile.keywords ?? []) {
          let seen = seenByKeyword.get(ref.keyword_id);
          if (!seen) {
            seen = new Set();
            seenByKeyword.set(ref.keyword_id, seen);
          }
          if (seen.has(weapon.id)) continue;
          seen.add(weapon.id);
          push(this.weaponsByKeyword, ref.keyword_id, weapon);
        }
      }
    }
  }
}

/** Build a passthrough collection for an id-bearing record type. */
function idCollection<T extends { id: string }>(
  items: T[],
  factionOf?: (item: T) => string | null | undefined,
): Collection<T, T> {
  return new Collection<T, T>({
    items,
    idOf: (i) => i.id,
    nameOf: (i) => (i as { name?: string }).name,
    factionOf,
    wrap: (i) => i,
  });
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** Map an EligibleAbility back to the BuffSource the translator expects. */
function bufferSourceFromEligible(entry: EligibleAbility): BuffSource {
  const abilityId = entry.ability.id;
  switch (entry.source.kind) {
    case "army":
      return { kind: "ability", abilityId, abilityKind: "army" };
    case "detachment":
      return { kind: "ability", abilityId, abilityKind: "detachment" };
    case "detachment-stratagem":
      return { kind: "ability", abilityId, abilityKind: "detachment-stratagem" };
    case "unit":
      return { kind: "ability", abilityId, abilityKind: "unit" };
    case "leader":
      return { kind: "ability", abilityId, abilityKind: "leader" };
    case "support":
      return { kind: "ability", abilityId, abilityKind: "support" };
  }
}
