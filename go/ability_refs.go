package wh40kdc

// A unit's `ability_ids` entry: an ability id, or an object for a rated rule
// ({id, value}: Deadly Demise D3, Feel No Pain 5+) or for the ability a wargear
// item prints ({id, wargear}). Mirror of tools/src/data/ability-refs.ts.

// abilityRefID is the ability id an entry names ("" when it names none).
func abilityRefID(ref any) string {
	switch r := ref.(type) {
	case string:
		return r
	case map[string]any:
		id, _ := r["id"].(string)
		return id
	}
	return ""
}

// abilityRefValue is the rating an entry prints, if it is a rated rule.
func abilityRefValue(ref any) (any, bool) {
	r, ok := ref.(map[string]any)
	if !ok || r["value"] == nil {
		return nil, false
	}
	return r["value"], true
}

// abilityIDsOf is the ability ids of an untyped `ability_ids` value, in
// order: strings and {id} objects, anything else skipped.
func abilityIDsOf(value any) []string {
	l, _ := asList(value)
	out := make([]string, 0, len(l))
	for _, v := range l {
		switch r := v.(type) {
		case string:
			out = append(out, r)
		case map[string]any:
			if id, ok := r["id"].(string); ok {
				out = append(out, id)
			}
		}
	}
	return out
}

// unitAbilityIDs is the ability ids a unit lists.
func unitAbilityIDs(unit map[string]any) []string { return abilityIDsOf(unit["ability_ids"]) }

// printedWargearIDs is the wargear ids whose printed ability the unit lists
// (its datasheet prints that wargear's rule).
func printedWargearIDs(unit map[string]any) []string {
	var out []string
	for _, v := range getList(unit, "ability_ids") {
		if r, ok := v.(map[string]any); ok {
			if w, ok := r["wargear"].(string); ok && w != "" {
				out = append(out, w)
			}
		}
	}
	return out
}

// isRatingRef reports `{rating: true}`: the rating the unit's datasheet prints
// for this rule (withRating's exact form: one key).
func isRatingRef(v any) bool {
	m, ok := v.(map[string]any)
	return ok && len(m) == 1 && m["rating"] == true
}

// withRating returns effect with every `{rating: true}` replaced by rating.
// Without a rating (hasRating false) the effect is returned as is; unchanged
// subtrees are shared, not copied.
func withRating(effect any, rating any, hasRating bool) any {
	if !hasRating {
		return effect
	}
	var walk func(v any) (any, bool)
	walk = func(v any) (any, bool) {
		if isRatingRef(v) {
			return rating, true
		}
		switch x := v.(type) {
		case []any:
			var cp []any
			for i, e := range x {
				if r, changed := walk(e); changed {
					if cp == nil {
						cp = append([]any(nil), x...)
					}
					cp[i] = r
				}
			}
			if cp != nil {
				return cp, true
			}
		case map[string]any:
			var cp map[string]any
			for k, e := range x {
				if r, changed := walk(e); changed {
					if cp == nil {
						cp = cloneMap(x)
					}
					cp[k] = r
				}
			}
			if cp != nil {
				return cp, true
			}
		}
		return v, false
	}
	out, _ := walk(effect)
	return out
}

// RatingOf is the rating this unit's datasheet prints for a rated rule (the D3
// of Deadly Demise D3), if any.
func (u *UnitView) RatingOf(abilityID string) (any, bool) {
	for _, r := range getList(u.Raw, "ability_ids") {
		if abilityRefID(r) == abilityID {
			return abilityRefValue(r)
		}
	}
	return nil, false
}
