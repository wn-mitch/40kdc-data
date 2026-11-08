package wh40kdc

import "regexp"

// Source-name spellings the importer accepts for a weapon or wargear item: the
// name as printed, its punctuation-normalized form, and a curated alias. Mirror
// of the TS sourceNameVariants / lookupNameKeys in tools/src/import/resolve.ts.

// sourceNameAliases maps export spellings with no matching repo name, keyed by
// NormalizeName of the punctuation-normalized source name. Tried after the
// printed name.
var sourceNameAliases = map[string]string{
	"astartes chainsword":         "Chainsword",
	"exo armour grenade launcher": "Exoarmour grenade launcher",
	"kombi rokkit":                "Kombi-weapon",
	"kombi shoota":                "Kombi-weapon",
	"leaders bio weapons":         "Leader’s cult weapons",
	"pan spectral scanner":        "Panspectral Scanner",
	"squig bomb":                  "Bomb Squig",
}

var (
	reSourceDashes    = regexp.MustCompile(`[‐‑‒–—]`)
	reSourceAmpersand = regexp.MustCompile(`\s*&\s*`)
	reSourceAutocanon = regexp.MustCompile(`(?i)\bautocanon\b`)
)

// normalizedSourcePunctuation unifies dash variants, spells out "&", and
// repairs the "autocanon" typo.
func normalizedSourcePunctuation(rawName string) string {
	s := reSourceDashes.ReplaceAllString(rawName, "-")
	s = reSourceAmpersand.ReplaceAllString(s, " and ")
	return reSourceAutocanon.ReplaceAllString(s, "autocannon")
}

// sourceNameVariants returns the printed name, its punctuation-normalized
// form, then its alias, in that order and without duplicates.
func sourceNameVariants(rawName string) []string {
	normalized := normalizedSourcePunctuation(rawName)
	candidates := []string{rawName, normalized}
	if alias, ok := sourceNameAliases[NormalizeName(normalized)]; ok {
		candidates = append(candidates, alias)
	}
	out := []string{}
	for _, c := range candidates {
		if !containsString(out, c) {
			out = append(out, c)
		}
	}
	return out
}

// lookupNameKeys returns normalized keys for every variant, each with
// leading-"The" tolerance in both directions.
func lookupNameKeys(rawName string) map[string]bool {
	keys := map[string]bool{}
	for _, variant := range sourceNameVariants(rawName) {
		keys[NormalizeName(variant)] = true
		keys[NormalizeName("The "+variant)] = true
		if stripped, ok := StripLeadingThe(variant); ok {
			keys[NormalizeName(stripped)] = true
		}
	}
	return keys
}

// sourceNameMatches reports whether any variant of a record name is in keys.
func sourceNameMatches(keys map[string]bool, recordName string) bool {
	for _, variant := range sourceNameVariants(recordName) {
		if keys[NormalizeName(variant)] {
			return true
		}
	}
	return false
}

func containsString(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

// wargearOptionIDs lists every id a unit's wargear options replace or offer,
// in option order.
func wargearOptionIDs(ds *Dataset, raw map[string]any) []string {
	var ids []string
	for _, optAny := range ds.wargearOptionsOf(raw) {
		opt, _ := optAny.(map[string]any)
		ids = append(ids, getStrList(opt, "replaces")...)
		ids = append(ids, getStrList(opt, "replacement")...)
		for _, gAny := range getList(opt, "replacement_choice") {
			g, _ := gAny.([]any)
			for _, idAny := range g {
				if s, ok := idAny.(string); ok {
					ids = append(ids, s)
				}
			}
		}
	}
	return ids
}

// findWeaponCandidates resolves a weapon raw name to candidate weapons,
// tolerating a leading "The " mismatch in either direction (NewRecruit "The
// Bloody Twins" ↔ data "Bloody Twins"; GW "Fire Axe" ↔ data "The Fire Axe").
// For each source-name variant it tries the name as given, then the
// "The"-stripped form, then the "The"-prefixed form, returning the first
// non-empty match set. Mirror of the TS findWeaponCandidates.
func findWeaponCandidates(ds *Dataset, rawName string) []*WeaponView {
	for _, variant := range sourceNameVariants(rawName) {
		if direct := ds.Weapons.FindAll(variant); len(direct) > 0 {
			return direct
		}
		if stripped, ok := StripLeadingThe(variant); ok {
			if hits := ds.Weapons.FindAll(stripped); len(hits) > 0 {
				return hits
			}
		}
		if prefixed := ds.Weapons.FindAll("The " + variant); len(prefixed) > 0 {
			return prefixed
		}
	}
	return nil
}

// scopedWeaponID resolves a weapon raw name to one of the RESOLVED unit's own
// weapon ids — its weapon_ids plus ids reachable through its wargear options —
// so a name match picks the per-unit stat variant the unit actually fields.
// The printed name (and its punctuation-normalized form) is matched first, so
// a unit that really carries a weapon under that name keeps it; only then do
// the leading-"The" and alias variants apply. Returns ("", false) when the
// unit fields no weapon of that name (the caller falls back to the global
// lookup). Mirror of the TS scopedWeaponId.
func scopedWeaponID(ds *Dataset, hit *UnitView, rawName string) (string, bool) {
	ids := []string{}
	for _, id := range append(getStrList(hit.Raw, "weapon_ids"), wargearOptionIDs(ds, hit.Raw)...) {
		if !containsString(ids, id) {
			ids = append(ids, id)
		}
	}
	factionID := getStr(hit.Raw, "faction_id")
	var weapons []*WeaponView
	for _, id := range ids {
		w, ok := ds.Weapons.GetInFaction(id, factionID)
		if !ok {
			w, ok = ds.Weapons.GetAny(id)
		}
		if ok {
			weapons = append(weapons, w)
		}
	}
	direct := map[string]bool{
		NormalizeName(rawName):                              true,
		NormalizeName(normalizedSourcePunctuation(rawName)): true,
	}
	for _, w := range weapons {
		if direct[NormalizeName(w.Name())] || direct[NormalizeName(normalizedSourcePunctuation(w.Name()))] {
			return w.ID(), true
		}
	}
	keys := lookupNameKeys(rawName)
	for _, w := range weapons {
		if sourceNameMatches(keys, w.Name()) {
			return w.ID(), true
		}
	}
	return "", false
}

// resolveWargearItemID is the fallback for wargear ITEMS (Simulacrum
// Imperialis, Daemonic Icon, …) — raw names that are not weapons but do exist
// in the wargear collection. Runs only after BOTH weapon lookups miss, so a
// wargear item whose name collides with a weapon ("multi-melta", "power
// weapon") keeps resolving to the weapon exactly as before. Scoped-first: ids
// reachable through the resolved unit's wargear options, then the global
// collection (wargear is replicated-identical across factions, so a global
// first-match is safe). Same source-name variants as the weapon lookups.
// Mirror of the TS resolveWargearItemId.
func resolveWargearItemID(ds *Dataset, hit *UnitView, rawName string) (string, bool) {
	if hit != nil {
		keys := lookupNameKeys(rawName)
		for _, id := range wargearOptionIDs(ds, hit.Raw) {
			if itemAny, ok := ds.Wargear.GetAny(id); ok {
				item, _ := itemAny.(map[string]any)
				if sourceNameMatches(keys, getStr(item, "name")) {
					return getStr(item, "id"), true
				}
			}
		}
	}
	for _, variant := range sourceNameVariants(rawName) {
		if itemAny, ok := ds.Wargear.Find(variant); ok {
			return getStr(itemAny.(map[string]any), "id"), true
		}
		if stripped, ok := StripLeadingThe(variant); ok {
			if itemAny, ok := ds.Wargear.Find(stripped); ok {
				return getStr(itemAny.(map[string]any), "id"), true
			}
		}
		if itemAny, ok := ds.Wargear.Find("The " + variant); ok {
			return getStr(itemAny.(map[string]any), "id"), true
		}
	}
	return "", false
}
