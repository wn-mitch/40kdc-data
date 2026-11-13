package wh40kdc

// Keywords a bearer's own abilities change once it is attached at list
// building. Go mirror of tools/src/data/list-building-keywords.ts.

// keywordChange is one keyword a bearer gains (add) or loses, compared by
// keywordKey.
type keywordChange struct {
	add bool
	key string
}

var listPredicateKeys = map[string]struct{}{"all_of": {}, "any_of": {}, "none_of": {}, "not_all_of": {}}

func isBearerRef(ref any) bool {
	return ref == nil || ref == "this-model" || ref == "this-unit"
}

// withPredicate returns the with filter's keyword predicate (nil for no
// filter) and false when the filter needs more than the attached unit's
// keywords.
func withPredicate(filter any) (map[string]any, bool) {
	if filter == nil {
		return nil, true
	}
	object, ok := asMap(filter)
	if !ok {
		return nil, false
	}
	predicate := map[string]any{}
	for key, value := range object {
		if value == nil || (key == "owner" && value == "friendly") || (key == "level" && value == "unit") {
			continue
		}
		if _, known := listPredicateKeys[key]; !known {
			return nil, false
		}
		items, ok := asList(value)
		if !ok {
			return nil, false
		}
		for _, item := range items {
			if _, isString := item.(string); !isString {
				return nil, false
			}
		}
		predicate[key] = items
	}
	return predicate, true
}

func leafKeywordChanges(leaf map[string]any) []keywordChange {
	modifier, ok := asMap(leaf["modifier"])
	if !ok || !isBearerRef(leaf["target"]) {
		return nil
	}
	switch leaf["type"] {
	case "keyword-grant":
		keywords, _ := asList(modifier["keywords"])
		var out []keywordChange
		for _, k := range keywords {
			if s, isString := k.(string); isString {
				out = append(out, keywordChange{add: true, key: keywordKey(s)})
			}
		}
		return out
	case "rule-state":
		rule, isString := modifier["rule"].(string)
		if modifier["rule_kind"] != "keyword" || !isString {
			return nil
		}
		switch modifier["direction"] {
		case "suppressed":
			return []keywordChange{{add: false, key: keywordKey(rule)}}
		case "granted":
			return []keywordChange{{add: true, key: keywordKey(rule)}}
		}
	}
	return nil
}

// attachmentKeywordChanges returns the keyword changes an ability makes to
// its bearer once attached, when attachment alone gates them: an untriggered
// conditional on a single attachment predicate (role attached, the bearer as
// subject) over a leaf or a sequence of leaves. It returns the predicate the
// attached unit's keywords must meet (nil for none), the changes, and false
// for any other shape (a compound condition is not list building).
func attachmentKeywordChanges(ability map[string]any) (map[string]any, []keywordChange, bool) {
	if ability["trigger"] != nil {
		return nil, nil, false
	}
	effect, ok := asMap(ability["effect"])
	if !ok || effect["type"] != "conditional" {
		return nil, nil, false
	}
	condition, condOK := asMap(effect["condition"])
	body, bodyOK := asMap(effect["effect"])
	if !condOK || !bodyOK || condition["type"] != "attachment" || condition["operator"] != nil {
		return nil, nil, false
	}
	params, _ := asMap(condition["parameters"])
	if params["role"] != "attached" || !isBearerRef(params["subject"]) {
		return nil, nil, false
	}
	predicate, decidable := withPredicate(params["with"])
	if !decidable {
		return nil, nil, false
	}
	var changes []keywordChange
	if steps, isList := asList(body["steps"]); body["type"] == "sequence" && isList {
		for _, step := range steps {
			if leaf, isMap := asMap(step); isMap {
				changes = append(changes, leafKeywordChanges(leaf)...)
			}
		}
	} else {
		changes = leafKeywordChanges(body)
	}
	return predicate, changes, len(changes) > 0
}

// listBuildingKeywordChanges returns the bearer's keyword changes while
// attached to a unit with attachedToKeywords (leader or support attachment),
// in ability then effect order; none when attachedToKeywords is nil.
func listBuildingKeywordChanges(bearer *UnitView, attachedToKeywords map[string]struct{}) []keywordChange {
	if attachedToKeywords == nil {
		return nil
	}
	attached := make([]string, 0, len(attachedToKeywords))
	for k := range attachedToKeywords {
		attached = append(attached, k)
	}
	var out []keywordChange
	for _, ability := range bearer.Abilities() {
		predicate, changes, ok := attachmentKeywordChanges(ability.Raw)
		if !ok || (predicate != nil && !unitMatchesAppliesTo(predicate, attached)) {
			continue
		}
		out = append(out, changes...)
	}
	return out
}

// withKeywordChanges is keyword membership over a roster keyword set with the
// changes applied in order. A keyword the set holds keeps its exact spelling
// test; a change matches any spelling.
func withKeywordChanges(owned map[string]struct{}, changes []keywordChange) func(string) bool {
	removed := map[string]struct{}{}
	granted := map[string]struct{}{}
	for _, change := range changes {
		if change.add {
			granted[change.key] = struct{}{}
			delete(removed, change.key)
		} else {
			removed[change.key] = struct{}{}
			delete(granted, change.key)
		}
	}
	return func(keyword string) bool {
		_, held := owned[keyword]
		if len(changes) == 0 {
			return held
		}
		key := keywordKey(keyword)
		if _, ok := granted[key]; ok {
			return true
		}
		_, gone := removed[key]
		return held && !gone
	}
}
