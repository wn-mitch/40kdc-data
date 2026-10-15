/**
 * Battle-size → points/detachment caps, in one place.
 *
 * 11e battle sizes set both the army points ceiling and the detachment-point
 * budget: `incursion` = 1000 pts / 2 DP, `strike-force` = 2000 pts / 3 DP. This
 * mapping was previously hardcoded in several spots (import resolution, export
 * defaults); centralise it so the roster-legality checker and the importers
 * agree on a single source of truth.
 *
 * Mirrors the constants in `crates/wh40kdc/src/data/battle_sizes.rs`,
 * `python/src/wh40kdc/data/battle_sizes.py`, and `go/battle_sizes.go`.
 *
 * @packageDocumentation
 */
import type { BattleSize } from "../import/types.js";

/** Army points ceiling for a battle size; null when the size is unknown. */
export function pointsLimitForBattleSize(battleSize: BattleSize | null): number | null {
  switch (battleSize) {
    case "strike-force":
      return 2000;
    case "incursion":
      return 1000;
    default:
      return null;
  }
}

/** 11e detachment-point budget for a battle size; null when the size is unknown. */
export function detachmentCapForBattleSize(battleSize: BattleSize | null): number | null {
  switch (battleSize) {
    case "strike-force":
      return 3;
    case "incursion":
      return 2;
    default:
      return null;
  }
}

/**
 * 11e unit limit: how many units with the same datasheet an army may include
 * (`incursion` 2, `strike-force` 3). BATTLELINE and DEDICATED TRANSPORT units
 * double it; every EPIC HERO is limited to 1 regardless. Null when unknown.
 */
export function unitLimitForBattleSize(battleSize: BattleSize | null): number | null {
  switch (battleSize) {
    case "strike-force":
      return 3;
    case "incursion":
      return 2;
    default:
      return null;
  }
}

/** 11e Enhancement limit for a battle size (`incursion` 2, `strike-force` 4); null when unknown. */
export function enhancementLimitForBattleSize(battleSize: BattleSize | null): number | null {
  switch (battleSize) {
    case "strike-force":
      return 4;
    case "incursion":
      return 2;
    default:
      return null;
  }
}
