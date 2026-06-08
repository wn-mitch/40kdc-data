import {
  Dataset,
  tryImportRoster,
  type AdapterTrial,
  type Roster,
  type RosterFormat,
  type Buff,
  type Phase,
} from "@alpaca-software/40kdc-data";

/** The embedded 40kdc dataset — built once and shared by every pane. */
export const ds: Dataset = Dataset.embedded();

export type TargetMode = "manual" | "dataset" | "roster";

export interface ManualTarget {
  T: number;
  Sv: number;
  invuln: number | null;
  W: number;
  modelCount: number;
  fnp: number | null;
  keywords: string[];
}

export const DEFAULT_TARGET: ManualTarget = {
  T: 4,
  Sv: 3,
  invuln: null,
  W: 2,
  modelCount: 5,
  fnp: null,
  keywords: [],
};

export type PhaseChoice = Extract<Phase, "shooting" | "fight">;
export const PHASE_CHOICES: PhaseChoice[] = ["shooting", "fight"];

/** Which weapon type can fire in a given phase: shooting → ranged, fight → melee. */
export function weaponTypeForPhase(p: PhaseChoice): "ranged" | "melee" {
  return p === "fight" ? "melee" : "ranged";
}

export interface ContextFlags {
  attackerStationary: boolean;
  withinHalfRange: boolean;
  attackerCharged: boolean;
}

export interface ManualBuffToggle {
  id: string;
  label: string;
  build: () => Buff;
}

function manualBuff(label: string, contribution: Buff["contribution"]): Buff {
  return {
    source: { kind: "manual", label },
    applicableWhen: {},
    contribution,
  };
}

export const MANUAL_BUFF_TOGGLES: ManualBuffToggle[] = [
  { id: "cover", label: "Target in cover", build: () => manualBuff("Cover", { type: "cover" }) },
  {
    id: "plus-one-hit",
    label: "+1 to hit (manual)",
    build: () => manualBuff("+1 to hit", { type: "hit-mod", value: 1 }),
  },
  {
    id: "plus-one-wound",
    label: "+1 to wound (manual)",
    build: () => manualBuff("+1 to wound", { type: "wound-mod", value: 1 }),
  },
  {
    id: "sustained-hits",
    label: "Sustained Hits 1",
    build: () =>
      manualBuff("Sustained Hits 1", {
        type: "extra-keyword",
        keywordRef: { keyword_id: "sustained-hits", parameters: { value: 1 } },
      }),
  },
  {
    id: "lethal-hits",
    label: "Lethal Hits",
    build: () =>
      manualBuff("Lethal Hits", {
        type: "extra-keyword",
        keywordRef: { keyword_id: "lethal-hits" },
      }),
  },
  {
    // AP is signed against the save (negative = more piercing), so "+1 AP" in
    // player terms is an ap-mod of -1.
    id: "plus-one-ap",
    label: "+1 AP",
    build: () => manualBuff("+1 AP", { type: "ap-mod", value: -1 }),
  },
];

export const CONTEXT_FLAG_TOGGLES: { id: keyof ContextFlags; label: string }[] = [
  { id: "attackerStationary", label: "Attacker stationary (Heavy +1)" },
  { id: "withinHalfRange", label: "Within half range (Melta / Rapid Fire)" },
  { id: "attackerCharged", label: "Charged this turn (Relentless Rage)" },
];

class SalvoState {
  // Top-level view: the per-unit damage calculator, or the fleet-comparison
  // matrix (attacker set × target-profile set).
  appView = $state<"calculator" | "compare">("calculator");

  // Import
  attackerRoster = $state<Roster | null>(null);
  targetRoster = $state<Roster | null>(null);

  // Attacker. Defaults boot into a representative "gold standard" melee comp:
  // a Khorne Berzerkers squad led by Khârn (Berzerker Warband) charging the
  // Nightbringer, with Sustained Hits 1 / Lethal Hits / +1 AP toggled on.
  selectedUnitId = $state<string | null>("khorne-berzerkers");
  selectedFactionId = $state<string | null>("world-eaters");
  selectedDetachmentId = $state<string | null>("berzerker-warband");
  /**
   * Other members of the combined unit attached to {@link selectedUnitId} — a
   * leader joined to a bodyguard, or the bodyguard a selected leader joins.
   * A list so 11th's multi-member attachments need no shape change; the UI
   * writes 0 or 1 today.
   */
  attachedUnitIds = $state<string[]>(["kharn-the-betrayer"]);
  phase = $state<PhaseChoice>("fight");
  selectedWeaponId = $state<string | null>(null);
  selectedProfileIndex = $state<number>(0);
  modelsFiring = $state<number>(5);

  // Abilities / buffs
  /**
   * Per-lever overrides of the defaults `Dataset.stackableBuffsFor` returns
   * (`id → on/off`). Absent ids fall back to the lever's `enabled` default:
   * always-on for intrinsic keywords and unconditional abilities, off for
   * stratagems and activatable gates. This single map subsumes the old
   * opt-in-stratagem / opt-out-ability sets.
   */
  buffOverrides = $state<Record<string, boolean>>({});
  manualBuffsActive = $state<Set<string>>(
    new Set(["sustained-hits", "lethal-hits", "plus-one-ap"]),
  );
  contextFlags = $state<ContextFlags>({
    attackerStationary: false,
    withinHalfRange: false,
    attackerCharged: true,
  });
  /**
   * Distance to the target in inches. Feeds `EngineContext.distanceInches`,
   * which gates range-limited abilities (e.g. Furious Onslaught rerolls within
   * 18"). Null = unset → range gates stay permissive.
   */
  targetDistance = $state<number | null>(null);

  /** Effective on/off for a lever, honouring any user override of its default. */
  isBuffEnabled(id: string, defaultEnabled: boolean): boolean {
    return this.buffOverrides[id] ?? defaultEnabled;
  }

  /** Record an explicit on/off choice for a lever. */
  setBuffEnabled(id: string, enabled: boolean): void {
    this.buffOverrides = { ...this.buffOverrides, [id]: enabled };
  }

  // Target. Default is "dataset" so the picker is useful before any roster
  // has been imported. After a successful roster import we auto-flip to
  // "roster" unless the user has explicitly picked a mode since the last
  // import (tracked via `targetModeUserOverridden`).
  targetMode = $state<TargetMode>("dataset");
  targetModeUserOverridden = $state<boolean>(false);
  manualTarget = $state<ManualTarget>({ ...DEFAULT_TARGET });
  datasetTargetFactionId = $state<string | null>("necrons");
  datasetTargetUnitId = $state<string | null>("ctan-shard-of-the-nightbringer");
  rosterTargetUnitIndex = $state<number | null>(null);
  /**
   * Selected target-profile preset, if any. A preset is just a named
   * (faction, unit, model-count) bookmark, so picking one drives the existing
   * dataset target mode — the dataset prefill effect and defensiveBuffsFor
   * wiring then apply unchanged. Cleared when the user picks a unit/faction by
   * hand so a stale preset's model-count override doesn't linger.
   */
  targetPresetId = $state<string | null>(null);

  // Fleet comparison (the "Compare" view).
  compareFactionId = $state<string | null>("world-eaters");
  /** Selected target-profile ids; empty means "all profiles". */
  compareTargetIds = $state<string[]>([]);
  compareDistance = $state<number>(15);
  comparePhase = $state<PhaseChoice>("shooting");
  /** Compare sub-mode: the unit×target matrix, or per-unit loadout ranking. */
  compareMode = $state<"matrix" | "loadouts">("matrix");
  /** Unit whose loadouts are ranked in "loadouts" sub-mode. */
  compareLoadoutUnitId = $state<string | null>(null);

  /** Apply a target-profile preset: point the dataset target at its unit. */
  applyTargetPreset(profileId: string): void {
    const profile = ds.targetProfiles.get(profileId);
    if (!profile) return;
    this.targetPresetId = profileId;
    this.datasetTargetFactionId = profile.faction_id;
    this.datasetTargetUnitId = profile.unit_id;
    this.selectTargetMode("dataset");
  }

  /** User-initiated mode change. Records the override so a later import
   *  doesn't yank the tab out from under them. */
  selectTargetMode(mode: TargetMode): void {
    this.targetMode = mode;
    this.targetModeUserOverridden = true;
  }

  /** Called by import-pane after a successful target roster import. Flips to
   *  "roster" if the user hasn't overridden since the last import. Resets the
   *  override flag so a subsequent re-import behaves the same way. */
  onTargetRosterImported(): void {
    if (!this.targetModeUserOverridden) {
      this.targetMode = "roster";
    }
    this.targetModeUserOverridden = false;
  }
}

export const salvo = new SalvoState();

export interface RosterImportResult {
  roster: Roster | null;
  format: RosterFormat | null;
  /** Headline error for the `.error` row; null on success. */
  error: string | null;
  /** Per-adapter dispatch trace, present on failure for the expandable details. */
  trials: AdapterTrial[];
}

/** Auto-detect the pasted format and import. Returns a structured result so the
 * UI can surface the headline failure alongside per-format trial details. */
export function importRosterText(text: string): RosterImportResult {
  if (!text.trim()) {
    return { roster: null, format: null, error: "Paste a list first.", trials: [] };
  }
  const result = tryImportRoster(text, { dataset: ds });
  if (result.ok) {
    return { roster: result.roster, format: result.format, error: null, trials: [] };
  }
  return { roster: null, format: null, error: result.message, trials: result.trials };
}
