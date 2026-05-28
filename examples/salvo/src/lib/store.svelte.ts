import {
  Dataset,
  importListForge,
  importNewRecruit,
  type Roster,
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

export interface ContextFlags {
  attackerStationary: boolean;
  withinHalfRange: boolean;
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
];

class SalvoState {
  // Import
  attackerRoster = $state<Roster | null>(null);
  targetRoster = $state<Roster | null>(null);

  // Attacker
  selectedUnitId = $state<string | null>(null);
  selectedFactionId = $state<string | null>(null);
  selectedDetachmentId = $state<string | null>(null);
  attachedLeaderId = $state<string | null>(null);
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
  contextFlags = $state<ContextFlags>({ attackerStationary: false, withinHalfRange: false });

  /** Effective on/off for a lever, honouring any user override of its default. */
  isBuffEnabled(id: string, defaultEnabled: boolean): boolean {
    return this.buffOverrides[id] ?? defaultEnabled;
  }

  /** Record an explicit on/off choice for a lever. */
  setBuffEnabled(id: string, enabled: boolean): void {
    this.buffOverrides = { ...this.buffOverrides, [id]: enabled };
  }

  // Target
  targetMode = $state<TargetMode>("manual");
  manualTarget = $state<ManualTarget>({ ...DEFAULT_TARGET });
  datasetTargetUnitId = $state<string | null>(null);
  rosterTargetUnitIndex = $state<number | null>(null);
}

export const salvo = new SalvoState();

export interface RosterImportResult {
  roster: Roster | null;
  error: string | null;
}

/** JSON-first, then ListForge text/URL. */
export function importRosterText(text: string): RosterImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { roster: null, error: "Paste a list first." };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { roster: importNewRecruit(trimmed, { dataset: ds }), error: null };
    } catch (err) {
      return { roster: null, error: `NewRecruit JSON: ${(err as Error).message}` };
    }
  }
  try {
    return { roster: importListForge(trimmed, { dataset: ds }), error: null };
  } catch (err) {
    return { roster: null, error: `ListForge: ${(err as Error).message}` };
  }
}
