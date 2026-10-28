package wh40kdc

import (
	"reflect"
	"sort"
	"testing"
)

const (
	cpUnitID        = "manipulus-skand"
	cpDetachmentID  = "purge-corps-deltic-9"
	cpEnhancementID = "empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus"
	admechID        = "adeptus-mechanicus"
)

func mustView(t *testing.T, ds *Dataset, mode string) *Dataset {
	t.Helper()
	v, err := ds.ForGameMode(mode)
	if err != nil {
		t.Fatalf("ForGameMode(%q): %v", mode, err)
	}
	if v.GameMode() != mode {
		t.Fatalf("ForGameMode(%q).GameMode() = %q", mode, v.GameMode())
	}
	return v
}

func unitIDSet(units []*UnitView) map[string]bool {
	out := map[string]bool{}
	for _, u := range units {
		out[u.ID()] = true
	}
	return out
}

func rawIDSet(records []any) map[string]bool {
	out := map[string]bool{}
	for _, r := range records {
		out[getStr(r.(map[string]any), "id")] = true
	}
	return out
}

func TestDefaultViewIsMatchedPlay(t *testing.T) {
	ds := EmbeddedDataset()
	if ds.GameMode() != "matched-play" {
		t.Fatalf("EmbeddedDataset().GameMode() = %q", ds.GameMode())
	}
	if NewDataset(embeddedRawData()).GameMode() != "matched-play" {
		t.Fatal("NewDataset default mode is not matched-play")
	}
	if ds.Units.Size() >= len(embeddedRawData()["units"]) {
		t.Fatalf("matched-play Units.Size() = %d hides nothing", ds.Units.Size())
	}
}

func TestCombatPatrolUnitHiddenFromDefaultListings(t *testing.T) {
	ds := EmbeddedDataset()
	if unitIDSet(ds.Units.ByFaction(admechID))[cpUnitID] {
		t.Errorf("default ByFaction(%s) lists %s", admechID, cpUnitID)
	}
	if unitIDSet(ds.Units.All())[cpUnitID] {
		t.Errorf("default All() lists %s", cpUnitID)
	}
	if u, ok := ds.Units.Find("Manipulus Skand"); ok {
		t.Errorf("default Find(Manipulus Skand) = %s", u.ID())
	}
	// The exact-id step of Find skips hidden records too.
	if u, ok := ds.Units.Find(cpUnitID); ok {
		t.Errorf("default Find(%s) = %s", cpUnitID, u.ID())
	}
	if f, ok := ds.Factions.Get(admechID); !ok || unitIDSet(f.Units())[cpUnitID] {
		t.Errorf("default faction.Units() lists %s", cpUnitID)
	}
}

// The unit_compositions listing filters like the collections; the per-unit
// unitCompositionOf lookup does not. overlord-amonhotekh's composition is
// tagged combat-patrol (the adeptus-mechanicus Combat Patrol compositions are
// not tagged in the data).
func TestUnitCompositionsListingFiltersButLookupDoesNot(t *testing.T) {
	const unitID = "overlord-amonhotekh"
	lists := func(ds *Dataset) bool {
		for _, c := range ds.UnitCompositions {
			if getStr(c.(map[string]any), "unit_id") == unitID {
				return true
			}
		}
		return false
	}
	ds := EmbeddedDataset()
	if lists(ds) {
		t.Errorf("default UnitCompositions lists %s", unitID)
	}
	if !lists(mustView(t, ds, "combat-patrol")) {
		t.Errorf("combat-patrol UnitCompositions lacks %s", unitID)
	}
	u, ok := ds.Units.GetAny(unitID)
	if !ok {
		t.Fatalf("GetAny(%s) missed", unitID)
	}
	if models, _ := ds.unitCompositionOf(u.Raw); len(models) == 0 {
		t.Errorf("default unitCompositionOf(%s) is empty", unitID)
	}
}

func TestIDLookupsResolveHiddenRecords(t *testing.T) {
	ds := EmbeddedDataset()
	u, ok := ds.Units.GetAny(cpUnitID)
	if !ok || u.ID() != cpUnitID {
		t.Fatalf("default GetAny(%s) = %v, %v", cpUnitID, u, ok)
	}
	if _, ok := ds.Units.GetInFaction(cpUnitID, admechID); !ok {
		t.Errorf("default GetInFaction(%s) missed", cpUnitID)
	}
	if !ds.Units.Has(cpUnitID) {
		t.Errorf("default Has(%s) = false", cpUnitID)
	}
	if _, ok := ds.Detachments.GetAny(cpDetachmentID); !ok {
		t.Errorf("default Detachments.GetAny(%s) missed", cpDetachmentID)
	}
	if _, ok := ds.Enhancements.Get(cpEnhancementID); !ok {
		t.Errorf("default Enhancements.Get(%s) missed", cpEnhancementID)
	}
	// Per-unit lookups ignore the mode.
	if models, _ := ds.unitCompositionOf(u.Raw); len(models) == 0 {
		t.Errorf("default unitCompositionOf(%s) is empty", cpUnitID)
	}
}

func TestCombatPatrolViewListsCombatPatrolContent(t *testing.T) {
	cp := mustView(t, EmbeddedDataset(), "combat-patrol")
	got := unitIDSet(cp.Units.ByFaction(admechID))
	want := map[string]bool{
		cpUnitID:                             true,
		"purge-corps-pteraxii-sterylizors":   true,
		"purge-corps-serberys-sulphurhounds": true,
		"purge-corps-skitarii-vanguard":      true,
	}
	if len(got) != len(want) {
		t.Errorf("combat-patrol ByFaction(%s) = %v, want %v", admechID, got, want)
	}
	for id := range want {
		if !got[id] {
			t.Errorf("combat-patrol ByFaction(%s) lacks %s", admechID, id)
		}
	}
	if u, ok := cp.Units.Find("Manipulus Skand"); !ok || u.ID() != cpUnitID {
		t.Errorf("combat-patrol Find(Manipulus Skand) = %v, %v", u, ok)
	}
	// A record reached from a view links back into that view.
	if u, _ := cp.Units.GetAny(cpUnitID); u.ds != cp {
		t.Error("combat-patrol unit is not bound to its view")
	}
	dets := rawIDSet(cp.Detachments.ByFaction(admechID))
	if len(dets) != 1 || !dets[cpDetachmentID] {
		t.Errorf("combat-patrol Detachments.ByFaction(%s) = %v", admechID, dets)
	}
	if e, ok := cp.Enhancements.Find("Empowered Mechanisms"); !ok || getStr(e.(map[string]any), "id") != cpEnhancementID {
		t.Errorf("combat-patrol Enhancements.Find = %v, %v", e, ok)
	}
}

func TestCombatPatrolDetachmentAndEnhancementHiddenByDefault(t *testing.T) {
	ds := EmbeddedDataset()
	if rawIDSet(ds.Detachments.ByFaction(admechID))[cpDetachmentID] {
		t.Errorf("default Detachments.ByFaction(%s) lists %s", admechID, cpDetachmentID)
	}
	if d, ok := ds.Detachments.Find("Purge Corps Deltic 9"); ok {
		t.Errorf("default Detachments.Find = %v", d)
	}
	if e, ok := ds.Enhancements.Find("Empowered Mechanisms"); ok {
		t.Errorf("default Enhancements.Find(Empowered Mechanisms) = %v", e)
	}
	if rawIDSet(ds.Enhancements.All())[cpEnhancementID] {
		t.Errorf("default Enhancements.All() lists %s", cpEnhancementID)
	}
}

func TestAllViewIsTheUnion(t *testing.T) {
	ds := EmbeddedDataset()
	all := mustView(t, ds, "all")
	mp := unitIDSet(ds.Units.ByFaction(admechID))
	cp := unitIDSet(mustView(t, ds, "combat-patrol").Units.ByFaction(admechID))
	union := unitIDSet(all.Units.ByFaction(admechID))
	for id := range mp {
		if !union[id] {
			t.Errorf("all view lacks matched-play unit %s", id)
		}
	}
	for id := range cp {
		if !union[id] {
			t.Errorf("all view lacks combat-patrol unit %s", id)
		}
	}
	extra := []string{}
	for id := range union {
		if !mp[id] && !cp[id] {
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	if len(extra) > 0 {
		t.Errorf("all view lists units in neither view: %v", extra)
	}
	if got, want := all.Units.Size(), len(all.Units.All()); got != want {
		t.Errorf("all Units.Size() = %d, All() = %d", got, want)
	}
	if len(all.UnitCompositions) != len(embeddedRawData()["unit_compositions"]) {
		t.Errorf("all UnitCompositions = %d, bundle has %d", len(all.UnitCompositions), len(embeddedRawData()["unit_compositions"]))
	}
}

func TestViewsShareRecordsAndCache(t *testing.T) {
	ds := EmbeddedDataset()
	cp := mustView(t, ds, "combat-patrol")
	if again := mustView(t, ds, "combat-patrol"); again != cp {
		t.Error("ForGameMode does not cache views")
	}
	if back := mustView(t, cp, "matched-play"); back != ds {
		t.Error("matched-play view of a combat-patrol view is not the default view")
	}
	a, _ := ds.Units.GetAny(cpUnitID)
	b, _ := cp.Units.GetAny(cpUnitID)
	if reflect.ValueOf(a.Raw).Pointer() != reflect.ValueOf(b.Raw).Pointer() {
		t.Error("views do not share the underlying record")
	}
}

func TestUnknownGameModeErrors(t *testing.T) {
	for _, mode := range []string{"", "Matched-Play", "kill-team"} {
		if v, err := EmbeddedDataset().ForGameMode(mode); err == nil {
			t.Errorf("ForGameMode(%q) = %v, want error", mode, v.GameMode())
		}
	}
}

func TestPrintedKeywordSeesEveryMode(t *testing.T) {
	ds := EmbeddedDataset()
	all := mustView(t, ds, "all")
	// Find a keyword printed only on a non-matched-play datasheet.
	mpKeywords := map[string]bool{}
	for _, u := range ds.Units.All() {
		for _, k := range append(u.Keywords(), u.FactionKeywords()...) {
			mpKeywords[NormalizeName(k)] = true
		}
	}
	var hiddenOnly string
	for _, u := range all.Units.All() {
		for _, k := range append(u.Keywords(), u.FactionKeywords()...) {
			if !mpKeywords[NormalizeName(k)] {
				hiddenOnly = k
			}
		}
	}
	if hiddenOnly == "" {
		t.Skip("no keyword is printed only on non-matched-play datasheets")
	}
	if !ds.printedKeyword()(hiddenOnly) {
		t.Errorf("printedKeyword(%q) = false in the matched-play view", hiddenOnly)
	}
}

func TestLinkedQueryGameMode(t *testing.T) {
	s := NewRunnerState()
	q := func(query string, input map[string]any) map[string]any {
		return s.handleLinkedQuery(map[string]any{"query": query, "input": input})
	}
	if r := q("find_unit", map[string]any{"query": "Manipulus Skand"}); r["value"] != nil {
		t.Errorf("default find_unit = %v", r)
	}
	if r := q("find_unit", map[string]any{"query": "Manipulus Skand", "gameMode": "combat-patrol"}); r["value"] != cpUnitID {
		t.Errorf("combat-patrol find_unit = %v", r)
	}
	if r := q("get_unit", map[string]any{"unitId": cpUnitID}); r["value"] != cpUnitID {
		t.Errorf("default get_unit = %v", r)
	}
	if r := q("get_detachment", map[string]any{"detachmentId": cpDetachmentID}); r["value"] != cpDetachmentID {
		t.Errorf("default get_detachment = %v", r)
	}
	if r := q("find_enhancement", map[string]any{"query": "Empowered Mechanisms", "gameMode": "combat-patrol"}); r["value"] != cpEnhancementID {
		t.Errorf("combat-patrol find_enhancement = %v", r)
	}
	if r := q("detachments_of_faction", map[string]any{"factionId": admechID, "gameMode": "combat-patrol"}); len(r["value"].([]any)) != 1 {
		t.Errorf("combat-patrol detachments_of_faction = %v", r)
	}
	if r := q("units_of_faction", map[string]any{"factionId": admechID, "gameMode": "nope"}); r["error_kind"] != "INVALID_INPUT" {
		t.Errorf("unknown gameMode = %v, want INVALID_INPUT", r)
	}
}
