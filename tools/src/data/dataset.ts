/**
 * {@link Dataset} ties the embedded records together: it owns every
 * {@link Collection}, builds the cross-entity indexes once, and is the `this`
 * the linked views resolve against.
 *
 * @packageDocumentation
 */
import { unitAbilityIds } from "./ability-refs.js";
import type {
  AlliedRule,
  DeploymentPattern,
  Detachment,
  Enhancement,
  ForceDisposition,
  GameEvent,
  GameVersion,
  HullShape,
  InteractionFlag,
  LeaderAttachment,
  Mission,
  MissionMatchup,
  Phase,
  ResourcePool,
  SecondaryCard,
  Stratagem,
  TargetProfile,
  TerrainLayout,
  TerrainTemplate,
  Unit,
  UnitComposition,
  Wargear,
  WargearOption,
  WeaponKeyword,
  UnitKeyword,
} from "../generated.js";
import {
  assertGameModeView,
  Collection,
  DEFAULT_GAME_MODE,
  inGameMode,
  type GameModeView,
} from "./collection.js";
import {
  AbilityView,
  FactionView,
  UnitView,
  WeaponKeywordView,
  WeaponView,
} from "./entities.js";
import { emptyRawData, type RawData } from "./types.js";
import { collectBuffs, stackableBuffsFor } from "./dataset-buffs.js";
import * as attachments from "./dataset-attachments.js";
import { reactiveTriggersOf, triggerIndexOf } from "./dataset-triggers.js";
import { RAW_DATA } from "./bundle.generated.js";
// Renamed-id map (old id → current id) so id lookups of a since-renamed entity
// (e.g. an enhancement id normalized to the RAW GW form) still resolve — the
// same authored rename map the share codec applies on decode.
import { SHARE_REGISTRY } from "../share/registry.generated.js";
import { resolveLayout, type ResolvedPiece } from "../terrain/resolve.js";
import type { Buff, EngineContext } from "../cruncher/buffs.js";
import type { AbilityNeed } from "./lever-providers.js";
import {
  resolveEligibleAbilities,
  type EligibilityInput,
  type EligibleAbility,
} from "../abilities-resolver/index.js";

export type {
  BuffInput,
  StackableBuff,
  StackableBuffGroup,
} from "./dataset-buffs.js";
import type {
  BuffInput,
  StackableBuff,
  StackableBuffGroup,
} from "./dataset-buffs.js";

export type { ReactiveTrigger } from "./dataset-triggers.js";
import type { ReactiveTrigger } from "./dataset-triggers.js";

/**
 * Record types that carry `game_modes` and whose collections a game-mode view
 * filters. Every other collection lists all of its records in every view.
 */
type ModeScoped = { game_modes?: readonly string[] | null };

/**
 * The whole dataset, with linked accessors over every entity collection.
 *
 * A dataset is a **game-mode view**: {@link gameMode} is the mode its listings
 * show. `Dataset.embedded()` and `new Dataset(raw)` are the matched-play view;
 * {@link forGameMode} returns another view over the same records and indexes.
 * In a view, listings of mode-scoped records (units, weapons, detachments,
 * enhancements, stratagems, wargear options, unit compositions) skip those whose
 * effective `game_modes` (absent → matched play) lack the mode — collection
 * `all`/iteration/`size`/`byFaction`/`find`/`findAll`, the `unitCompositions`
 * array, and the reverse listings ({@link unitsWithKeyword} and kin). Id lookups
 * (`get`, `getAny`, `getInFaction`, `has`, `byExternalRef`) and per-record links
 * ({@link wargearOptionsOf}, {@link unitCompositionOf}, a unit's weapons and
 * abilities) resolve every record in every view, so share tokens, saved rosters
 * and references keep resolving. `"all"` lists everything.
 */
export class Dataset {
  /** The game mode this view lists (`"all"` lists every record). */
  readonly gameMode: GameModeView;
  /** Views of the same data by mode, shared by every view of one dataset. */
  private readonly views: Map<GameModeView, Dataset>;

  // Richly-linked collections.
  readonly units: Collection<Unit, UnitView>;
  readonly weapons: Collection<RawData["weapons"][number], WeaponView>;
  readonly weaponKeywords: Collection<WeaponKeyword, WeaponKeywordView>;
  readonly factions: Collection<RawData["factions"][number], FactionView>;
  readonly abilities: Collection<RawData["abilities"][number], AbilityView>;

  // Id-bearing collections without bespoke views (records returned as-is).
  readonly unitKeywords: Collection<UnitKeyword, UnitKeyword>;
  readonly targetProfiles: Collection<TargetProfile, TargetProfile>;
  readonly detachments: Collection<Detachment, Detachment>;
  readonly alliedRules: Collection<AlliedRule, AlliedRule>;
  readonly enhancements: Collection<Enhancement, Enhancement>;
  readonly stratagems: Collection<Stratagem, Stratagem>;
  readonly wargearOptions: Collection<WargearOption, WargearOption>;
  readonly wargear: Collection<Wargear, Wargear>;
  readonly missions: Collection<Mission, Mission>;
  readonly missionMatchups: Collection<MissionMatchup, MissionMatchup>;
  readonly missionCards: Collection<SecondaryCard, SecondaryCard>;
  readonly deploymentPatterns: Collection<DeploymentPattern, DeploymentPattern>;
  readonly forceDispositions: Collection<ForceDisposition, ForceDisposition>;
  readonly terrainTemplates: Collection<TerrainTemplate, TerrainTemplate>;
  readonly terrainLayouts: Collection<TerrainLayout, TerrainLayout>;
  readonly hullShapes: Collection<HullShape, HullShape>;
  readonly resourcePools: Collection<ResourcePool, ResourcePool>;

  // Id-less collections, exposed as plain arrays.
  readonly leaderAttachments: readonly LeaderAttachment[];
  readonly unitCompositions: readonly UnitComposition[];
  readonly gameVersions: readonly GameVersion[];
  readonly interactionFlags: readonly InteractionFlag[];
  readonly phaseMappings: readonly RawData["phaseMappings"][number][];

  /** `source_type:source_id` → unioned phases. */
  private readonly phaseIndex = new Map<string, Phase[]>();
  /** ability id → units that list it. */
  private readonly unitsByAbility = new Map<string, Unit[]>();
  /** weapon id → units that list it. */
  private readonly unitsByWeapon = new Map<string, Unit[]>();
  /** weapon-keyword id → weapons whose profiles reference it. */
  private readonly weaponsByKeyword = new Map<
    string,
    RawData["weapons"][number][]
  >();
  /** lowercased keyword → units carrying it (in `keywords` or `faction_keywords`). */
  private readonly unitsByKeyword = new Map<string, Unit[]>();
  /** `faction_id::unit_id` → wargear options authored for it (declared order preserved). */
  private readonly wargearOptionsByUnit = new Map<string, WargearOption[]>();
  /** Every unit composition, whatever the mode; {@link unitCompositions} filters it. */
  private readonly everyUnitComposition: readonly UnitComposition[];
  /** `faction_id::unit_id` → the unit-composition authored for it. */
  private readonly compositionByUnit = new Map<string, UnitComposition>();

  constructor(
    raw: RawData = emptyRawData(),
    gameMode: GameModeView = DEFAULT_GAME_MODE,
  ) {
    assertGameModeView(gameMode);
    this.gameMode = gameMode;
    this.views = new Map([[gameMode, this]]);
    const modesOf = (r: ModeScoped) => r.game_modes;
    this.units = new Collection({
      gameMode,
      gameModesOf: modesOf,
      items: raw.units,
      idOf: (u) => u.id,
      externalRefsOf: (u) => u.external_refs,
      // The same unit id is shared across factions (e.g. ministorum-priest);
      // keep each faction's copy, collapse only true within-faction duplicates.
      dedupeKeyOf: (u) => `${u.faction_id}::${u.id}`,
      nameOf: (u) => u.name,
      aliasesOf: (u) => u.aliases,
      factionOf: (u) => u.faction_id,
      // Per-faction copies of a shared chassis genuinely diverge (points,
      // keywords, profiles), so a faction-less get() of a shared id is a bug.
      guardUnscoped: true,
      entityLabel: "unit",
      wrap: (u) => new UnitView(u, this),
    });
    this.weapons = new Collection({
      gameMode,
      gameModesOf: modesOf,
      items: raw.weapons,
      idOf: (w) => w.id,
      externalRefsOf: (w) => w.external_refs,
      // A bare weapon id is shared across factions with divergent stats (each
      // faction file defines its own e.g. "close-combat-weapon"); key on
      // (faction_id, id) so every faction's copy is retained and a unit resolves
      // its own faction's weapon (issue #59), not whichever bundled first.
      dedupeKeyOf: (w) => `${w.faction_id ?? ""}::${w.id}`,
      nameOf: (w) => w.name,
      factionOf: (w) => w.faction_id,
      // Per-faction copies diverge (stats), so a faction-less get() of a
      // shared id is a bug — catalog/import callsites that genuinely lack
      // faction context opt out via getAny.
      guardUnscoped: true,
      entityLabel: "weapon",
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
      externalRefsOf: (f) => f.external_refs,
      nameOf: (f) => f.name,
      // Factions answer to alternate names ("Space Marines" for Adeptus
      // Astartes) as exact matches, ahead of the substring fallback.
      aliasesOf: (f) => f.aliases,
      idAliases: SHARE_REGISTRY.aliases,
      wrap: (f) => new FactionView(f, this),
    });
    this.abilities = new Collection({
      items: raw.abilities,
      // Ability ids are unique across the dataset (`<name>-<faction>`; core rules bare),
      // so a plain get() is exact. An old bare faction id resolves to nothing.
      idOf: (a) => a.ability_id,
      nameOf: (a) => a.name,
      factionOf: (a) => a.faction_id,
      entityLabel: "ability",
      wrap: (a) => new AbilityView(a, this),
    });

    this.unitKeywords = idCollection(raw.unitKeywords);
    this.targetProfiles = idCollection(raw.targetProfiles, (p) => p.faction_id);
    // A detachment id is shared across factions: the generic Codex Space Marine
    // detachments are replicated into every Codex-compatible chapter/supplement
    // (each as its own faction view), so keep each faction's copy and collapse
    // only true within-faction duplicates — mirroring the unit collection. Use
    // {@link Collection.getInFaction} / {@link Collection.byFaction} when a
    // faction context is known; bare {@link Collection.get} returns whichever
    // copy was registered first.
    this.detachments = new Collection({
      gameMode,
      gameModesOf: modesOf,
      items: raw.detachments,
      idOf: (d) => d.id,
      externalRefsOf: (d) => d.external_refs,
      nameOf: (d) => d.name,
      dedupeKeyOf: (d) => `${d.faction_id}::${d.id}`,
      factionOf: (d) => d.faction_id,
      idAliases: SHARE_REGISTRY.aliases,
      // Shared Space Marine detachments diverge per chapter (detachment_rule_id,
      // stratagem_ids, enhancement_ids, detachment_points), so a faction-less
      // get() of a shared id is a bug — same guard as the units collection.
      guardUnscoped: true,
      entityLabel: "detachment",
      wrap: (d) => d,
    });
    // Allied rules aren't owned by one faction (Daemonic Pact is shared by
    // Chaos Knights and CSM); `alliesFor` matches on `army_keywords_any` instead.
    this.alliedRules = idCollection(raw.alliedRules);
    this.enhancements = idCollection(raw.enhancements, undefined, gameMode);
    this.stratagems = idCollection(raw.stratagems, undefined, gameMode);
    this.wargearOptions = idCollection(raw.wargearOptions, undefined, gameMode);
    this.wargear = idCollection(raw.wargear);
    this.missions = idCollection(raw.missions);
    this.missionMatchups = idCollection(raw.missionMatchups);
    this.missionCards = idCollection(raw.missionCards);
    this.deploymentPatterns = idCollection(raw.deploymentPatterns);
    this.forceDispositions = idCollection(raw.forceDispositions);
    this.terrainTemplates = idCollection(raw.terrainTemplates);
    this.terrainLayouts = idCollection(raw.terrainLayouts);
    this.hullShapes = idCollection(raw.hullShapes);
    this.resourcePools = idCollection(raw.resourcePools);

    this.leaderAttachments = raw.leaderAttachments;
    this.everyUnitComposition = raw.unitCompositions;
    this.unitCompositions = raw.unitCompositions.filter((c) =>
      inGameMode(c.game_modes, gameMode),
    );
    this.gameVersions = raw.gameVersions;
    this.interactionFlags = raw.interactionFlags;
    this.phaseMappings = raw.phaseMappings;

    this.buildIndexes(raw);
  }

  /** The dataset built from the package's embedded data: the matched-play view. */
  static embedded(): Dataset {
    return new Dataset(RAW_DATA);
  }

  /**
   * This dataset's view listing `mode` (a game-mode id, or `"all"` for every
   * record). The view shares this dataset's records and indexes; views are
   * cached, so repeated calls return the same object. Throws on an unknown mode.
   */
  forGameMode(mode: GameModeView): Dataset {
    assertGameModeView(mode);
    const cached = this.views.get(mode);
    if (cached) return cached;
    const view = Object.create(Dataset.prototype) as Dataset;
    Object.assign(view, this);
    const v = view as unknown as Record<string, unknown>;
    v.gameMode = mode;
    // Linked views wrap against the view, so `unit.faction.units` lists in it.
    v.units = this.units.withGameMode(mode, (u) => new UnitView(u, view));
    v.weapons = this.weapons.withGameMode(mode, (w) => new WeaponView(w, view));
    v.weaponKeywords = this.weaponKeywords.withGameMode(
      mode,
      (k) => new WeaponKeywordView(k, view),
    );
    v.factions = this.factions.withGameMode(
      mode,
      (f) => new FactionView(f, view),
    );
    v.abilities = this.abilities.withGameMode(
      mode,
      (a) => new AbilityView(a, view),
    );
    v.detachments = this.detachments.withGameMode(mode);
    v.enhancements = this.enhancements.withGameMode(mode);
    v.stratagems = this.stratagems.withGameMode(mode);
    v.wargearOptions = this.wargearOptions.withGameMode(mode);
    v.unitCompositions = this.everyUnitComposition.filter((c) =>
      inGameMode(c.game_modes, mode),
    );
    this.views.set(mode, view);
    return view;
  }


  /** Whether this view lists a mode-scoped record. */
  private listsMode(record: ModeScoped): boolean {
    return inGameMode(record.game_modes, this.gameMode);
  }

  /** Phases a source acts in, unioned across its phase-mappings. */
  phasesFor(sourceType: string, sourceId: string): Phase[] {
    return this.phaseIndex.get(`${sourceType}:${sourceId}`) ?? [];
  }

  /**
   * Resolve a terrain layout to absolute board-space vertices using this
   * dataset's embedded terrain-template catalog — the layout-id →
   * renderable-geometry hop. Mirror of Rust `Dataset::resolve_terrain`; the
   * geometry is pinned by the `terrain-resolver` conformance corpus.
   */
  resolveTerrain(layout: TerrainLayout): ResolvedPiece[] {
    // The resolver takes its own structurally-identical input types, decoupled
    // from the generated `anyOf`/newtype shapes; the underlying JSON is the same.
    return resolveLayout(layout as never, this.terrainTemplates.all as never);
  }

  /**
   * The terrain layouts a deployment pattern recommends, in declared order,
   * skipping any ids absent from the dataset.
   */
  recommendedTerrainLayouts(pattern: DeploymentPattern): TerrainLayout[] {
    return (pattern.recommended_terrain_layout_ids ?? [])
      .map((id) => this.terrainLayouts.get(id))
      .filter((l): l is TerrainLayout => l !== undefined);
  }

  /** Units that list the given ability id. */
  unitsWithAbility(abilityId: string): UnitView[] {
    return (this.unitsByAbility.get(abilityId) ?? [])
      .filter((u) => this.listsMode(u))
      .map((u) => new UnitView(u, this));
  }

  /**
   * Every ability carrying a reactive event trigger, sorted by ability
   * id. Each entry names the units that list the ability (sorted; empty for
   * faction/detachment-rule abilities no unit references directly).
   */
  reactiveTriggers(): ReactiveTrigger[] {
    return reactiveTriggersOf(this.abilities.all, this.unitsByAbility);
  }


  /**
   * Dispatch index for event-driven consumers: {@link GameEvent} → the reactive
   * triggers firing on it. Keys are iterated in event order and each bucket is
   * sorted by ability id, so the structure is deterministic across runs.
   */
  triggerIndex(): Map<GameEvent, ReactiveTrigger[]> {
    return triggerIndexOf(this.reactiveTriggers());
  }


  /** Units that list the given weapon id. */
  unitsWithWeapon(weaponId: string): UnitView[] {
    return (this.unitsByWeapon.get(weaponId) ?? [])
      .filter((u) => this.listsMode(u))
      .map((u) => new UnitView(u, this));
  }

  /** Weapons whose profiles reference the given weapon-keyword id. */
  weaponsWithKeyword(keywordId: string): WeaponView[] {
    return (this.weaponsByKeyword.get(keywordId) ?? [])
      .filter((w) => this.listsMode(w))
      .map((w) => new WeaponView(w, this));
  }

  /**
   * Units carrying the given keyword, matched case-insensitively against the
   * union of each unit's `keywords` and `faction_keywords`. Powers a list
   * builder's keyword search bar (type "Khorne" to find every Khorne unit),
   * across the whole dataset — so it also surfaces cross-faction ally pools.
   * Returns each faction's copy of a shared unit id separately.
   */
  unitsWithKeyword(keyword: string): UnitView[] {
    return (this.unitsByKeyword.get(keyword.toLowerCase()) ?? [])
      .filter((u) => this.listsMode(u))
      .map((u) => new UnitView(u, this));
  }

  /**
   * The allied-rules **offered** for an army of `factionId` running the given
   * detachments. A rule applies when both its gates pass: the **army gate**
   * (`army_keywords_any` empty, or intersecting the faction's keywords) and the
   * **detachment gate** (`detachment_ids` empty, or any listed id among `detachmentIds`). Order
   * follows the allied-rules data file. The strict "every *model* carries an
   * army keyword" check (for soup lists) is a builder/validation concern — this
   * offers the candidate rules a faction qualifies for. Mirror of Rust
   * `Dataset::allies_for`; pinned by the `allies_for` conformance query.
   */
  alliesFor(factionId: string, detachmentIds: string[] = []): AlliedRule[] {
    return attachments.alliesFor(this, factionId, detachmentIds);
  }

  /**
   * The unit pool an allied-rule grants, sorted by name. Starts from the rule's
   * `source_faction_id` (if set, to keep that faction's copy of shared ids) or
   * the whole dataset, then ANDs every filter the rule sets: `source_datasheet_ids`
   * (an explicit id allowlist — the primary selector for generated pools), any
   * `source_keywords`, `required_keywords` (all present), `excluded_keywords`
   * (none present), and `roles`. Empty for an unknown rule id or a pool that
   * resolves to nothing. Mirror of Rust `Dataset::ally_units_for`; pinned by the
   * `ally_units_for` conformance query.
   */
  allyUnitsFor(ruleId: string): UnitView[] {
    return attachments.allyUnitsFor(this, ruleId);
  }

  /**
   * Wargear options authored for the given unit, in declared order. Scoped to
   * the unit's own faction: a chassis shared across factions (e.g.
   * `chaos-terminators` in World Eaters *and* Emperors Children) reuses the same
   * option ids for different swaps, so the lookup keys on `(faction_id, unit_id)`
   * — never the union across factions. Mirror of Rust `Dataset::wargear_options_of`.
   * Empty for a unit with no options.
   */
  wargearOptionsOf(unit: Unit): WargearOption[] {
    return (
      this.wargearOptionsByUnit.get(`${unit.faction_id}::${unit.id}`) ?? []
    );
  }

  /**
   * The unit-composition authored for the given unit, faction-scoped exactly
   * like {@link wargearOptionsOf}: shared chassis carry a distinct composition
   * per faction under one `unit_id`, so the lookup keys on `(faction_id,
   * unit_id)` rather than the faction-blind `unitCompositions.find(...)`.
   * `undefined` when the unit has no composition.
   */
  unitCompositionOf(unit: Unit): UnitComposition | undefined {
    return this.compositionByUnit.get(`${unit.faction_id}::${unit.id}`);
  }

  /**
   * Leaders eligible for `bodyguardUnitId`, sorted by name. Without roster
   * context this includes every possible conditional group; with a roster set
   * it includes only groups whose required units are present and excluded
   * units absent. Unconditional id and keyword eligibility always applies.
   */
  leadersAttachableTo(bodyguardUnitId: string, rosterUnitIds?: ReadonlySet<string>): UnitView[] {
    return attachments.leadersAttachableTo(this, bodyguardUnitId, rosterUnitIds);
  }

  /**
   * Bodyguards eligible for `leaderUnitId`, deduped by id and sorted by name.
   * Without roster context this includes every possible conditional group;
   * with a roster set it applies each group's required/excluded unit conditions.
   * `factionId` scopes the resolved bodyguard views when provided.
   */
  bodyguardsAttachableFrom(
    leaderUnitId: string,
    factionId?: string,
    rosterUnitIds?: ReadonlySet<string>,
  ): UnitView[] {
    return attachments.bodyguardsAttachableFrom(this, leaderUnitId, factionId, rosterUnitIds);
  }

  /** Conditional roster groups override the flat role; leader wins on overlap. */
  conditionalAttachmentRole(leaderUnitId: string, rosterUnitIds: ReadonlySet<string>): "leader" | "support" | undefined {
    let supportApplies = false;
    for (const attachment of this.leaderAttachments) {
      if (attachment.leader_id !== leaderUnitId) continue;
      for (const group of attachment.conditional_groups ?? []) {
        if (!attachments.attachmentGroupApplies(group, rosterUnitIds)) continue;
        if (group.role === "leader") return "leader";
        supportApplies = true;
      }
    }
    return supportApplies ? "support" : undefined;
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
   * attached members, support, plus any stratagems the caller has opted into).
   *
   * The result includes only buffs the buff layer can express today — the
   * `unsupported` half of the DSL→Buff translation is dropped here so callers
   * who just want the stack don't need to thread diagnostics through. Use
   * {@link AbilityView.describeBuffs} when you need the diagnostics for an
   * individual ability. Symmetric to {@link defensiveBuffsFor}, which walks
   * the same eligibility set under target perspective.
   *
   * Persistent recipient effects after an attachment changes are resolved only
   * from caller-attested `context.recipientSnapshots` captured at activation
   * time. The caller supplies live event-time evidence and asserts
   * activation/equipment; this dataset has no internal history or clock.
   * Discovery accepts an intrinsic source or an eligible enhancement with the
   * matching detachment; legality alone does not prove that a source was
   * equipped. Missing, mismatched, or conflicting snapshots are unsupported,
   * `selected: false` produces no effect, and a named parent trigger remains
   * distinct from unrelated effect guards.
   */
  buffsFor(
    input: BuffInput & {
      weaponProfiles?: { weaponId: string; profileIndex: number }[];
      /** Stratagem ids the caller has opted into spending CP on. */
      optedInStratagemIds?: string[];
    },
    context: EngineContext,
  ): Buff[] {
    return collectBuffs(this, input, context, "attacker");
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
   *
   * Abilities pooled in from `attachedUnitIds` obey core rule 19.04: an effect
   * targeting a single model (DSL `this-model`, e.g. an attached character's
   * personal invulnerable save) is *not* returned as a buff on the combined
   * unit — it stays on its own model and surfaces in
   * {@link AbilityView.describeBuffs}'s `unsupported` list instead. Effects
   * targeting the unit (`this-unit`) do reach the whole unit.
   */
  defensiveBuffsFor(
    input: EligibilityInput & { optedInStratagemIds?: string[] },
    context: EngineContext,
  ): Buff[] {
    return collectBuffs(this, input, context, "target");
  }

  /**
   * The leaf conditions {@link defensiveBuffsFor} leaves undecided for the
   * defending unit, each with the ability that raised it. Answering one in
   * `context.conditionFacts` under its `key` decides it.
   */
  defensiveNeedsFor(
    input: EligibilityInput & { optedInStratagemIds?: string[] },
    context: EngineContext,
  ): AbilityNeed[] {
    const needs: AbilityNeed[] = [];
    collectBuffs(this, input, context, "target", needs);
    return needs;
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
   *
   * `needs` lists the leaf conditions the context leaves undecided, each with
   * the ability that raised it. Answering one in `context.conditionFacts` under
   * its `key` decides it on the next call.
   */
  stackableBuffsFor(
    input: BuffInput & {
      weaponProfiles?: { weaponId: string; profileIndex: number }[];
    },
    context: EngineContext,
  ): { buffs: StackableBuff[]; groups: StackableBuffGroup[]; needs: AbilityNeed[] } {
    return stackableBuffsFor(this, input, context);
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
      for (const abilityId of unitAbilityIds(unit.ability_ids))
        push(this.unitsByAbility, abilityId, unit);
      for (const weaponId of unit.weapon_ids ?? [])
        push(this.unitsByWeapon, weaponId, unit);
      // Index every keyword the unit carries (unit keywords ∪ faction keywords),
      // lowercased, deduped per-unit so an overlap doesn't list the unit twice.
      const seenKw = new Set<string>();
      for (const kw of [
        ...(unit.keywords ?? []),
        ...(unit.faction_keywords ?? []),
      ]) {
        const key = kw.toLowerCase();
        if (seenKw.has(key)) continue;
        seenKw.add(key);
        push(this.unitsByKeyword, key, unit);
      }
    }
    for (const option of raw.wargearOptions) {
      push(
        this.wargearOptionsByUnit,
        `${option.faction_id}::${option.unit_id}`,
        option,
      );
    }
    for (const comp of raw.unitCompositions) {
      // A unit has at most one composition per faction; keep the first if the
      // data ever doubles (integrity flags within-faction duplicates).
      const key = `${comp.faction_id}::${comp.unit_id}`;
      if (!this.compositionByUnit.has(key))
        this.compositionByUnit.set(key, comp);
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
  gameMode?: GameModeView,
): Collection<T, T> {
  return new Collection<T, T>({
    items,
    // Passing a mode marks the record type as mode-scoped (it carries
    // `game_modes`); collections built without one list every record.
    ...(gameMode !== undefined
      ? { gameMode, gameModesOf: (i: T) => (i as ModeScoped).game_modes }
      : {}),
    idOf: (i) => i.id,
    nameOf: (i) => (i as { name?: string }).name,
    externalRefsOf: (i) =>
      (i as { external_refs?: readonly { namespace: string; id: string }[] })
        .external_refs,
    factionOf,
    // Resolve a persisted reference to a renamed id (harmless for record types
    // absent from the registry — their ids are never alias keys).
    idAliases: SHARE_REGISTRY.aliases,
    wrap: (i) => i,
  });
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
