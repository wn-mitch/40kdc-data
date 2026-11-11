/**
 * Warlord eligibility from the per-model Warlord flags on unit-composition
 * rows (`cannot_be_warlord`, `can_be_non_character_warlord`,
 * `is_supreme_commander`). The core rules select a CHARACTER model as
 * Warlord; an army that includes Supreme Commander units must pick one of
 * them; and "cannot be your Warlord" outranks "must be your Warlord".
 */
import type { UnitComposition } from "../generated.js";

type ModelRow = UnitComposition["models"][number];

/** One resolved roster unit, as the Warlord checks see it. */
export interface WarlordUnit {
  unitId: string;
  isWarlord: boolean;
  /** CHARACTER by role, keyword, conditional keyword or roster override. */
  isCharacter: boolean;
  /** The unit composition's model rows; empty when the unit has none. */
  rows: readonly ModelRow[];
}

export type WarlordViolationCode = "cannot-be-warlord" | "warlord-not-character" | "warlord-not-supreme-commander";

export interface WarlordViolation {
  code: WarlordViolationCode;
  id: string;
  message: string;
  unitIndex: number | null;
}

/** True when no model of the unit can be the Warlord. */
const cannotLead = (u: WarlordUnit): boolean => u.rows.length > 0 && u.rows.every((m) => m.cannot_be_warlord === true);

/**
 * Warlord violations for `units` (indexed like the roster; `undefined` for an
 * unresolved unit). `detachmentWarlords` holds the datasheets a selected
 * detachment names for Warlord (mandatory or granted); naming lifts
 * `cannot_be_warlord`, as it lifts an allied rule's Warlord lock.
 */
export function warlordViolations(
  units: readonly (WarlordUnit | undefined)[],
  detachmentWarlords: ReadonlySet<string>,
): WarlordViolation[] {
  const out: WarlordViolation[] = [];
  const barred = (u: WarlordUnit): boolean => cannotLead(u) && !detachmentWarlords.has(u.unitId);
  units.forEach((u, idx) => {
    if (!u?.isWarlord) return;
    if (barred(u))
      out.push({ code: "cannot-be-warlord", id: u.unitId, message: `${u.unitId} cannot be your Warlord`, unitIndex: idx });
    if (!u.isCharacter && !u.rows.some((m) => m.can_be_non_character_warlord === true))
      out.push({ code: "warlord-not-character", id: u.unitId, message: `${u.unitId} is not a Character and cannot be your Warlord`, unitIndex: idx });
  });
  // Checked only when a Warlord is chosen; a missing one is `no-warlord`.
  if (!units.some((u) => u?.isWarlord)) return out;
  const supreme = units.filter(
    (u): u is WarlordUnit =>
      u !== undefined && !barred(u) && u.rows.some((m) => m.is_supreme_commander === true && m.cannot_be_warlord !== true),
  );
  if (supreme.length > 0 && !supreme.some((u) => u.isWarlord)) {
    const ids = [...new Set(supreme.map((u) => u.unitId))].sort();
    out.push({
      code: "warlord-not-supreme-commander",
      id: ids.join("+"),
      message: `the Warlord must be one of: ${ids.join(", ")}`,
      unitIndex: null,
    });
  }
  return out;
}
