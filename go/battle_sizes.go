package wh40kdc

// Battle-size → points/detachment caps, in one place. 11e battle sizes set both
// the army points ceiling and the detachment-point budget: incursion = 1000 pts
// / 2 DP, strike-force = 2000 pts / 3 DP. Go mirror of
// tools/src/data/battle-sizes.ts, crates/.../battle_sizes.rs, and
// python/.../data/battle_sizes.py. The second return is false when the size is
// unknown (the TS `null`).

// pointsLimitForBattleSize is the army points ceiling for a battle size; the
// bool is false when the size is unknown.
func pointsLimitForBattleSize(battleSize string) (int, bool) {
	switch battleSize {
	case "strike-force":
		return 2000, true
	case "incursion":
		return 1000, true
	default:
		return 0, false
	}
}

// detachmentCapForBattleSize is the 11e detachment-point budget for a battle
// size; the bool is false when the size is unknown.
func detachmentCapForBattleSize(battleSize string) (int, bool) {
	switch battleSize {
	case "strike-force":
		return 3, true
	case "incursion":
		return 2, true
	default:
		return 0, false
	}
}

// unitLimitForBattleSize is the 11e unit limit per datasheet (incursion 2,
// strike-force 3); BATTLELINE and DEDICATED TRANSPORT double it and every EPIC
// HERO is limited to 1. The bool is false when the size is unknown.
func unitLimitForBattleSize(battleSize string) (int, bool) {
	switch battleSize {
	case "strike-force":
		return 3, true
	case "incursion":
		return 2, true
	default:
		return 0, false
	}
}

// enhancementLimitForBattleSize is the 11e Enhancement limit (incursion 2,
// strike-force 4); the bool is false when the size is unknown.
func enhancementLimitForBattleSize(battleSize string) (int, bool) {
	switch battleSize {
	case "strike-force":
		return 4, true
	case "incursion":
		return 2, true
	default:
		return 0, false
	}
}
