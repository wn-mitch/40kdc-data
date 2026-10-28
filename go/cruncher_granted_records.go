package wh40kdc

// Grants of ability records ("friendly BLOOD LEGIONS units gain Blessings of
// Khorne"), resolved to the record itself so the translator reads them as
// printed definitions: the holders run the granted rule as their own ability,
// and its "this unit" is the holder. Go mirror of
// tools/src/cruncher/granted-records.ts.

// GrantedRecordLookup returns the ability record with this id (its "effect",
// "trigger", "usage" and "optional"), or nil when none resolves.
type GrantedRecordLookup func(abilityID string) map[string]any

// ResolveGrantedRecords rewrites each ability-grant that names an ability
// record by id into a printed grant: its "definition" is an ability part
// carrying the record's effect (itself resolved), trigger, usage and
// optionality. A grant already carrying a definition, a rules bundle, an id
// lookup does not resolve (a core ability), and a record in seen (the granting
// ability itself, or a cycle) stay as they are, so the translator reports them
// as before. Unchanged subtrees keep their identity.
func ResolveGrantedRecords(effect any, lookup GrantedRecordLookup, seen map[string]bool) any {
	resolved, _ := resolveGrantedRecords(effect, lookup, seen)
	return resolved
}

func resolveGrantedRecords(effect any, lookup GrantedRecordLookup, seen map[string]bool) (any, bool) {
	switch node := effect.(type) {
	case []any:
		var copy []any
		for i, child := range node {
			if resolved, changed := resolveGrantedRecords(child, lookup, seen); changed {
				if copy == nil {
					copy = append([]any(nil), node...)
				}
				copy[i] = resolved
			}
		}
		if copy != nil {
			return copy, true
		}
		return effect, false
	case map[string]any:
		if granted, ok := resolveGrant(node, lookup, seen); ok {
			return granted, true
		}
		var copy map[string]any
		for key, child := range node {
			if resolved, changed := resolveGrantedRecords(child, lookup, seen); changed {
				if copy == nil {
					copy = cloneMap(node)
				}
				copy[key] = resolved
			}
		}
		if copy != nil {
			return copy, true
		}
		return effect, false
	default:
		return effect, false
	}
}

func resolveGrant(node map[string]any, lookup GrantedRecordLookup, seen map[string]bool) (map[string]any, bool) {
	if getStr(node, "type") != "ability-grant" {
		return nil, false
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return nil, false
	}
	ability, isString := modifier["ability"].(string)
	if !isString || modifier["definition"] != nil || modifier["rules_bundle"] == true || seen[ability] {
		return nil, false
	}
	record := lookup(ability)
	recordEffect, isObject := record["effect"].(map[string]any)
	if !isObject {
		return nil, false
	}
	inner := make(map[string]bool, len(seen)+1)
	for id := range seen {
		inner[id] = true
	}
	inner[ability] = true
	definition := map[string]any{"type": "ability-part", "effect": ResolveGrantedRecords(recordEffect, lookup, inner)}
	for _, key := range []string{"trigger", "usage"} {
		if value := record[key]; value != nil {
			definition[key] = value
		}
	}
	if record["optional"] == true {
		definition["optional"] = true
	}
	nextModifier := cloneMap(modifier)
	nextModifier["definition"] = definition
	granted := cloneMap(node)
	granted["modifier"] = nextModifier
	return granted, true
}
