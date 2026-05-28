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
import type { Buff, EngineContext } from "../cruncher/buffs.js";

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
   * Every {@link Buff} applicable to the given weapon profiles in this
   * `context`. M1 scope: weapon-profile keywords only (M2 extends this to walk
   * eligible abilities). Returns a flat buff stack the engine can consume
   * straight; callers may concat additional manual / ability buffs onto it.
   */
  buffsFor(
    input: { weaponProfiles?: { weaponId: string; profileIndex: number }[] },
    context: EngineContext,
  ): Buff[] {
    const out: Buff[] = [];
    for (const ref of input.weaponProfiles ?? []) {
      const weapon = this.weapons.get(ref.weaponId);
      if (!weapon) continue;
      out.push(...weapon.profileBuffs(ref.profileIndex, context));
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
