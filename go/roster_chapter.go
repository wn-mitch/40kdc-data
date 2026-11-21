package wh40kdc

// Chapter cohesion for the roster checker: which chapter-locked units an army under
// a faction-keyword-cohesion rule may not take. Mirror of TS data/roster-chapter.ts;
// pinned by the roster_validation conformance corpus.

// chapterMismatch is a roster unit locked to a chapter its army may not take.
type chapterMismatch struct {
	index    int
	keywords []string
}

// ownKeywords returns a child faction's own keywords: its keywords minus its parent's.
func ownKeywords(child, parent map[string]any) []string {
	inherited := map[string]struct{}{}
	for _, k := range getStrList(parent, "keywords") {
		inherited[k] = struct{}{}
	}
	var out []string
	for _, k := range getStrList(child, "keywords") {
		if _, ok := inherited[k]; !ok {
			out = append(out, k)
		}
	}
	return out
}

// chapterMismatches returns the units an army under a faction-keyword-cohesion rule
// may not take. A unit carrying the base keyword plus other faction keywords is
// locked to a chapter; allies (no base keyword) and generic units are not judged
// here. A chapter army (a child of parent) takes only its own chapter's units. A
// parent army takes no chapter's units: each child faction is an army of its own.
// children are the factions whose parent_faction_id is the army's faction.
func chapterMismatches(faction, parent map[string]any, children []map[string]any, unitFactionKeywords [][]string) []chapterMismatch {
	if faction == nil {
		return nil
	}
	base := ""
	for _, r := range getList(faction, "army_construction_rules") {
		if rule, ok := asMap(r); ok && getStr(rule, "type") == "faction-keyword-cohesion" {
			base = getStr(rule, "base_faction_keyword")
			break
		}
	}
	if base == "" {
		return nil
	}
	keywords := map[string]struct{}{}
	chapterArmy := getStr(faction, "parent_faction_id") != ""
	if chapterArmy {
		if parent == nil {
			return nil
		}
		for _, k := range ownKeywords(faction, parent) {
			keywords[k] = struct{}{}
		}
	} else {
		for _, child := range children {
			for _, k := range ownKeywords(child, faction) {
				keywords[k] = struct{}{}
			}
		}
	}
	if len(keywords) == 0 {
		return nil
	}
	var out []chapterMismatch
	for index, unitKeywords := range unitFactionKeywords {
		hasBase := false
		var own []string
		for _, k := range unitKeywords {
			if k == base {
				hasBase = true
			} else {
				own = append(own, k)
			}
		}
		if !hasBase || len(own) == 0 {
			continue
		}
		hit := false
		for _, k := range own {
			if _, ok := keywords[k]; ok {
				hit = true
				break
			}
		}
		if hit != chapterArmy {
			out = append(out, chapterMismatch{index: index, keywords: own})
		}
	}
	return out
}
