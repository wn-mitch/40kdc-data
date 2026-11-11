package wh40kdc

import (
	"sort"
	"strings"
)

// warlordUnit is one resolved roster unit, as the Warlord checks see it.
// isCharacter covers role, keyword, conditional keyword and roster override;
// rows are the unit composition's model rows (empty when it has none).
type warlordUnit struct {
	unitID      string
	isWarlord   bool
	isCharacter bool
	rows        []any
}

// rowFlag reports whether a composition model row carries a true boolean flag.
func rowFlag(rAny any, field string) bool {
	r, ok := asMap(rAny)
	return ok && r[field] == true
}

// cannotLead reports whether no model of the unit can be the Warlord.
func (u *warlordUnit) cannotLead() bool {
	if len(u.rows) == 0 {
		return false
	}
	for _, r := range u.rows {
		if !rowFlag(r, "cannot_be_warlord") {
			return false
		}
	}
	return true
}

// warlordViolations checks Warlord eligibility from the per-model Warlord
// flags on unit-composition rows. The core rules select a CHARACTER model as
// Warlord; an army that includes Supreme Commander units must pick one of
// them; and "cannot be your Warlord" outranks "must be your Warlord".
// units is indexed like the roster (nil for an unresolved unit);
// detachmentWarlords holds the datasheets a selected detachment names for
// Warlord, and naming lifts cannot_be_warlord. Mirror of TS
// tools/src/data/roster-warlord.ts.
func warlordViolations(units []*warlordUnit, detachmentWarlords map[string]bool, errV func(code, id string, unitIndex int)) {
	barred := func(u *warlordUnit) bool { return u.cannotLead() && !detachmentWarlords[u.unitID] }
	anyWarlord := false
	for idx, u := range units {
		if u == nil || !u.isWarlord {
			continue
		}
		anyWarlord = true
		if barred(u) {
			errV("cannot-be-warlord", u.unitID, idx)
		}
		if !u.isCharacter {
			allowed := false
			for _, r := range u.rows {
				if rowFlag(r, "can_be_non_character_warlord") {
					allowed = true
					break
				}
			}
			if !allowed {
				errV("warlord-not-character", u.unitID, idx)
			}
		}
	}
	// Checked only when a Warlord is chosen; a missing one is no-warlord.
	if !anyWarlord {
		return
	}
	ids := map[string]bool{}
	satisfied := false
	for _, u := range units {
		if u == nil || barred(u) {
			continue
		}
		supreme := false
		for _, r := range u.rows {
			if rowFlag(r, "is_supreme_commander") && !rowFlag(r, "cannot_be_warlord") {
				supreme = true
				break
			}
		}
		if !supreme {
			continue
		}
		ids[u.unitID] = true
		if u.isWarlord {
			satisfied = true
		}
	}
	if len(ids) == 0 || satisfied {
		return
	}
	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)
	errV("warlord-not-supreme-commander", strings.Join(sorted, "+"), -1)
}
