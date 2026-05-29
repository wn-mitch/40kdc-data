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
];

export const CONTEXT_FLAG_TOGGLES: { id: keyof ContextFlags; label: string }[] = [
  { id: "attackerStationary", label: "Attacker stationary (Heavy +1)" },
  { id: "withinHalfRange", label: "Within half range (Melta / Rapid Fire)" },
  { id: "attackerCharged", label: "Charged this turn (Relentless Rage)" },
];

class SalvoState {
  // Import
  attackerRoster = $state<Roster | null>(null);
  targetRoster = $state<Roster | null>(null);

  // Attacker
  selectedUnitId = $state<string | null>(null);
  selectedFactionId = $state<string | null>(null);
  selectedDetachmentId = $state<string | null>(null);
  /**
   * Other members of the combined unit attached to {@link selectedUnitId} — a
   * leader joined to a bodyguard, or the bodyguard a selected leader joins.
   * A list so 11th's multi-member attachments need no shape change; the UI
   * writes 0 or 1 today.
   */
  attachedUnitIds = $state<string[]>([]);
  phase = $state<PhaseChoice>("shooting");
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
  manualBuffsActive = $state<Set<string>>(new Set());
  contextFlags = $state<ContextFlags>({
    attackerStationary: false,
    withinHalfRange: false,
    attackerCharged: false,
  });

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
  datasetTargetFactionId = $state<string | null>(null);
  datasetTargetUnitId = $state<string | null>(null);
  rosterTargetUnitIndex = $state<number | null>(null);

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
