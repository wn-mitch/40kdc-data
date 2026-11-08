package wh40kdc

import (
	"encoding/json"
	"strings"
)

// parentRuleCopies is a chapter army's own copies of its parent faction's
// rules, keyed by the parent rule's id: a record of the chapter named like a
// parent record and suffixed with the chapter's faction. Mirrors TS
// parentRuleCopies.
func (ds *Dataset) parentRuleCopies(factionID string) map[string]string {
	copies := map[string]string{}
	if factionID == "" {
		return copies
	}
	faction, ok := ds.Factions.GetAny(factionID)
	if !ok || faction == nil {
		return copies
	}
	parent := getStr(faction.Raw, "parent_faction_id")
	if parent == "" {
		return copies
	}
	suffix := "-" + factionID
	for _, ability := range ds.Abilities.All() {
		id := ability.ID()
		if getStr(ability.Raw, "faction_id") != factionID || !strings.HasSuffix(id, suffix) {
			continue
		}
		parentID := strings.TrimSuffix(id, suffix) + "-" + parent
		original, ok := ds.Abilities.GetInFaction(parentID, parent)
		if ok && original != nil && getStr(original.Raw, "faction_id") == parent && original.Name() == ability.Name() {
			copies[parentID] = id
		}
	}
	return copies
}

// withRuleCopies sets ctx's activeRules so each declared parent rule and its
// chapter copy stand for the other. Mirrors TS withRuleCopies.
func (ds *Dataset) withRuleCopies(ctx map[string]any, factionID string) {
	rules, known := asList(ctx["activeRules"])
	if !known {
		return
	}
	copies := ds.parentRuleCopies(factionID)
	if len(copies) == 0 {
		return
	}
	counterpart := map[string]string{}
	for parentID, copyID := range copies {
		counterpart[parentID] = copyID
		counterpart[copyID] = parentID
	}
	key := func(rule any) string {
		encoded, _ := json.Marshal(rule)
		return string(encoded)
	}
	out := append([]any(nil), rules...)
	seen := map[string]bool{}
	for _, rule := range out {
		seen[key(rule)] = true
	}
	for _, rule := range rules {
		var mirrored any
		if text, ok := rule.(string); ok {
			other, found := counterpart[text]
			if !found {
				continue
			}
			mirrored = other
		} else if record, ok := asMap(rule); ok && record != nil {
			other, found := counterpart[getStr(record, "ability_id")]
			if !found {
				continue
			}
			moved := cloneMap(record)
			moved["ability_id"] = other
			mirrored = moved
		} else {
			continue
		}
		if !seen[key(mirrored)] {
			seen[key(mirrored)] = true
			out = append(out, mirrored)
		}
	}
	ctx["activeRules"] = out
}
