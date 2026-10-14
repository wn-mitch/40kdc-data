package wh40kdc

import "strings"

// Single effects added for the phase-4 shapes -- a test exemption, a datasheet
// swap, how a characteristic that differs between models resolves, Firing Deck
// weapon borrowing and a weapon binding -- plus ability-activate. One
// lowercase-initial clause, no period. Mirror of
// tools/src/translate/effect-leaf-shapes.ts (and effect-leaf.ts abilityActivate).

// describeShapeLeaf renders a phase-4 leaf, or ("", false) for any other type.
func describeShapeLeaf(e, m map[string]any, subj string, ctx effCtx) (string, bool) {
	switch e["type"] {
	case "test-exemption":
		return subj + " " + ev(subj, "does") + " not need to take any further " + testName(m["test"]) + " tests this " +
			strings.ReplaceAll(ejstr(m["window"]), "-", " "), true
	case "datasheet-swap":
		return subj + " " + ev(subj, "uses") + " the " + titleCase(ejstr(m["datasheet"])) +
			" datasheet from now on, keeping its lost wounds and its position", true
	case "characteristic-resolution":
		return characteristicResolutionLeaf(m, subj), true
	case "borrow-weapons":
		return borrowWeaponsLeaf(m, subj, ctx), true
	case "select-weapon":
		return selectWeaponLeaf(m, subj), true
	}
	return "", false
}

func characteristicResolutionLeaf(m map[string]any, subj string) string {
	stat := statName(m["stat"]) + " characteristic"
	var which string
	if m["rule"] == "majority" {
		tie := "highest"
		if m["tie"] == "lowest" {
			tie = "lowest"
		}
		which = "the " + stat + " of the majority of its models (if tied, the " + tie + ")"
	} else {
		rule := "highest"
		if m["rule"] == "lowest" {
			rule = "lowest"
		}
		which = "the " + rule + " " + stat + " among its models"
	}
	if m["applies_to"] == "wound-roll" {
		return "each time an attack targets " + subj + ", use " + which + " to determine the Wound roll"
	}
	return subj + " " + ev(subj, "uses") + " " + which
}

func borrowWeaponsLeaf(m map[string]any, subj string, ctx effCtx) string {
	// Weapons come from models, so a unit filter reads as its models.
	from := "models embarked within it"
	if m["from"] != nil {
		from = replaceFirst(unitsWholeWordRe, strings.TrimPrefix(effectSubject(m["from"], ctx), "all "), "models")
	}
	kind := ""
	if m["weapon_type"] != nil {
		kind = ejstr(m["weapon_type"]) + " "
	}
	excl := ""
	if l, ok := asList(m["exclude_weapon_keyword"]); ok && len(l) > 0 {
		kws := make([]string, len(l))
		for i, k := range l {
			kws[i] = bracketKeyword(k)
		}
		excl = " (excluding " + strings.Join(kws, " and ") + " weapons)"
	}
	until := expiryTrail(m["until"])
	if until != "" {
		until = " " + until
	}
	return subj + " can use one " + kind + "weapon" + excl + " from each of up to " + diceCase(m["max_models"]) + " " + from + until + "; those models cannot shoot"
}

func selectWeaponLeaf(m map[string]any, subj string) string {
	countV := m["count"]
	if countV == nil {
		countV = 1.0
	}
	n := jsNumber(countV)
	kind := ""
	if m["weapon_type"] != nil {
		kind = ejstr(m["weapon_type"]) + " "
	}
	kw := ""
	if m["weapon_keyword"] != nil {
		kw = " with [" + strings.ToUpper(ejstr(m["weapon_keyword"])) + "]"
	}
	if n == 1 {
		return "select one " + kind + "weapon" + kw + " equipped by " + subj + "; the effects below refer to it as the selected weapon"
	}
	return "select " + ejstr(n) + " " + kind + "weapons" + kw + " equipped by " + subj + "; the effects below refer to them as the selected weapons"
}

func abilityActivateLeaf(m map[string]any, subj string) string {
	label := abilityLabel(m["ability"])
	consumed := ""
	if m["ignore_consumed"] == true {
		consumed = ", even if it has already been selected this battle"
	}
	if sel, ok := asMap(m["select"]); ok && sel != nil {
		how := "select one option of " + label
		if sel["by"] == "roll" {
			how = "make a new " + label + " roll and activate one result it allows"
		}
		return how + " for " + subj + ", in addition to any already active" + consumed
	}
	instead := ""
	if override, ok := asMap(m["override"]); ok && override != nil {
		instead = ", using " + diceCase(override["amount"]) + " in place of its usual amount"
	}
	if m["option"] == nil {
		return subj + " " + ev(subj, "resolves") + " the " + label + " ability now" + instead
	}
	excl := ""
	if m["exclusive"] == true {
		excl = " (and no other option is)"
	}
	return "the " + titleCase(ejstr(m["option"])) + " option of " + label + " is active for " + subj + excl + consumed
}
