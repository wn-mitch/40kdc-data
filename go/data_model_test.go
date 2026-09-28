package wh40kdc

import (
	"reflect"
	"strings"
	"testing"
)

// Ability ids are unique across factions and every faction record names its
// faction: the collection keeps every record. Mirror of the TS data-model test.
func TestKeepsEveryAbilityRecordUnderAUniqueID(t *testing.T) {
	ds := EmbeddedDataset()
	seen := map[string]struct{}{}
	all := ds.Abilities.All()
	for _, a := range all {
		if _, dup := seen[a.ID()]; dup {
			t.Fatalf("duplicate ability_id %q in All()", a.ID())
		}
		seen[a.ID()] = struct{}{}
		if f := getStr(a.Raw, "faction_id"); f != "" && a.ID() != f && !strings.HasSuffix(a.ID(), "-"+f) {
			t.Errorf("%s does not end with its faction %s", a.ID(), f)
		}
	}
	if raw := len(embeddedRawData()["abilities"]); len(all) != raw {
		t.Fatalf("All() = %d records, bundle has %d", len(all), raw)
	}
}

// Get of an ability is exact: an old bare faction id resolves to nothing (the
// mirror's renames carry no alias), so a stale reference misses rather than
// guessing a faction.
func TestAbilityGetIsExact(t *testing.T) {
	ds := EmbeddedDataset()
	idol, ok := ds.Abilities.Get("idol-of-blessed-blood-khorne-lord-of-skulls-world-eaters")
	if !ok || getStr(idol.Raw, "faction_id") != "world-eaters" {
		t.Fatalf("idol lookup = %v, %v", idol, ok)
	}
	for _, stale := range []string{"idol-of-blessed-blood", "berzerker-frenzy", "deadly-demise-d3"} {
		if _, ok := ds.Abilities.Get(stale); ok {
			t.Errorf("stale id %q still resolves", stale)
		}
	}
}

func TestByExternalRefReturnsEveryExactMatch(t *testing.T) {
	items := []any{
		map[string]any{
			"id": "first",
			"external_refs": []any{
				map[string]any{"namespace": "source", "id": "shared"},
				map[string]any{"namespace": "source", "id": "alternate"},
			},
		},
		map[string]any{
			"id": "second",
			"external_refs": []any{
				map[string]any{"namespace": "source", "id": "shared"},
			},
		},
	}
	collection := newCollection(items, func(item any) map[string]any {
		return item.(map[string]any)
	}, collectionOpts{
		idOf: func(item any) string { return getStr(item.(map[string]any), "id") },
	})
	ids := func(namespace, id string) []string {
		matches := collection.ByExternalRef(namespace, id)
		result := make([]string, len(matches))
		for index, match := range matches {
			result[index] = getStr(match, "id")
		}
		return result
	}

	for _, test := range []struct {
		namespace string
		id        string
		want      []string
	}{
		{"source", "shared", []string{"first", "second"}},
		{"source", "alternate", []string{"first"}},
		{"Source", "shared", []string{}},
		{"source", "Shared", []string{}},
	} {
		if got := ids(test.namespace, test.id); !reflect.DeepEqual(got, test.want) {
			t.Fatalf("ByExternalRef(%q, %q) = %v, want %v", test.namespace, test.id, got, test.want)
		}
	}
}

// Each faction's copy of a shared datasheet gets only what its own datasheet
// prints: the World Eaters Lord of Skulls prints the Idol of Blessed Blood, the
// CSM one does not. Both print Deadly Demise D6+2, read from the unit.
func TestSharedDatasheetGetsOnlyItsOwnPrintedAbilities(t *testing.T) {
	ds := EmbeddedDataset()
	hasIdol := func(faction string) bool {
		unit, ok := ds.Units.GetInFaction("khorne-lord-of-skulls", faction)
		if !ok {
			t.Fatalf("khorne-lord-of-skulls missing from %s", faction)
		}
		if r, ok := unit.RatingOf("deadly-demise"); !ok || r != "D6+2" {
			t.Errorf("%s deadly-demise rating = %v, %v; want D6+2", faction, r, ok)
		}
		for _, a := range unit.Abilities() {
			if strings.HasPrefix(a.ID(), "idol-of-blessed-blood") {
				return true
			}
		}
		return false
	}
	if !hasIdol("world-eaters") {
		t.Error("world-eaters lord of skulls lost the Idol of Blessed Blood")
	}
	if hasIdol("chaos-space-marines") {
		t.Error("chaos-space-marines lord of skulls still carries the Idol of Blessed Blood")
	}
}

// The shared _core pool stays faction-less; a bare Get still finds it.
func TestCorePoolAbilitiesResolveViaFallback(t *testing.T) {
	ds := EmbeddedDataset()
	if _, ok := ds.Abilities.Get("benefit-of-cover"); !ok {
		t.Fatal("benefit-of-cover (shared _core pool) not resolvable")
	}
}

// The tripwire that turns a silent wrong-faction lookup into a loud error:
// chaos-land-raider exists under several Chaos factions, so a faction-less
// Get would return the first-registered copy (wrong divergent fields).
func TestGetPanicsForSharedUnitIDWithoutFaction(t *testing.T) {
	ds := EmbeddedDataset()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("Get on a shared unit id should panic")
		}
	}()
	ds.Units.Get("chaos-land-raider")
}

func TestGetAnyIsTheExplicitFirstWinsOptOut(t *testing.T) {
	ds := EmbeddedDataset()
	unit, ok := ds.Units.GetAny("chaos-land-raider")
	if !ok || unit.ID() != "chaos-land-raider" {
		t.Fatal("GetAny should resolve the shared id first-wins")
	}
}

func TestGetStillWorksForUnambiguousIDsOnGuardedCollection(t *testing.T) {
	ds := EmbeddedDataset()
	if _, ok := ds.Units.Get("kharn-the-betrayer"); !ok {
		t.Fatal("unambiguous id should resolve through Get")
	}
}

func TestGetPanicsForSharedDetachmentIDWithoutFaction(t *testing.T) {
	ds := EmbeddedDataset()
	// Find a chapter-replicated detachment id (appears under >1 faction).
	counts := map[string]int{}
	var shared string
	for _, dAny := range ds.Detachments.All() {
		id := getStr(dAny.(map[string]any), "id")
		counts[id]++
		if counts[id] > 1 {
			shared = id
			break
		}
	}
	if shared == "" {
		t.Fatal("expected at least one chapter-replicated detachment id")
	}
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("Get on a shared detachment id should panic")
		}
	}()
	ds.Detachments.Get(shared)
}

// lascannon exists under many factions with divergent stats; a faction-less
// Get would silently crunch the wrong faction's profile.
func TestGetPanicsForSharedWeaponIDWithoutFaction(t *testing.T) {
	ds := EmbeddedDataset()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("Get on a shared weapon id should panic")
		}
	}()
	ds.Weapons.Get("lascannon")
}

// Core rule 19.04 — a rule affecting a single specified model only ever applies
// to that model, even while part of an attached unit. Mirror of the TS
// `defensive-buffs.test.ts` / Python `test_data_model.py` blocks; pinned
// cross-impl by conformance/abilities-resolver/{from-dsl,defensive-from-dsl}.json.

const modelScopedReasonTest = "model-scoped effect from an attached model: applies to that model only (core rule 19.04)"

// contribTypesFrom projects the contributions a named ability put on the stack.
func contribTypesFrom(buffs []any, abilityID string) []map[string]any {
	var out []map[string]any
	for _, bAny := range buffs {
		b, _ := asMap(bAny)
		source, _ := getMap(b, "source")
		if getStr(source, "abilityId") != abilityID {
			continue
		}
		contribution, _ := getMap(b, "contribution")
		out = append(out, contribution)
	}
	return out
}

func TestLeaderPersonalInvulnDoesNotBuffBodyguardUnit(t *testing.T) {
	ds := EmbeddedDataset()
	// Shadowfield reads "the bearer has a 4+ invulnerable save" — one model out
	// of eleven, so it is not the Kabalite squad's invulnerable save.
	attached := ds.defensiveBuffsFor(map[string]any{
		"unitId":          "kabalite-warriors",
		"factionId":       "drukhari",
		"attachedUnitIds": []any{"archon"},
	}, map[string]any{"phase": "shooting"})
	if got := contribTypesFrom(attached, "shadowfield-drukhari"); len(got) != 0 {
		t.Errorf("shadowfield buffs on the bodyguard unit = %v, want none", got)
	}

	// The Archon crunched as itself still keeps it (source kind "unit").
	own := ds.defensiveBuffsFor(
		map[string]any{"unitId": "archon", "factionId": "drukhari"},
		map[string]any{"phase": "shooting"},
	)
	got := contribTypesFrom(own, "shadowfield-drukhari")
	if len(got) != 1 || getStr(got[0], "type") != "invulnerable-save" || asInt(got[0]["threshold"]) != 4 {
		t.Errorf("shadowfield buffs on the Archon itself = %v, want one 4+ invulnerable-save", got)
	}
}

func TestUnitScopedLeaderRuleStillBuffsAttachedUnit(t *testing.T) {
	ds := EmbeddedDataset()
	// Mental Fortress reads "models in that unit have a 4+ invulnerable save" —
	// authored `target: "unit"`, so the model-scope gate must not touch it.
	attached := ds.defensiveBuffsFor(map[string]any{
		"unitId":          "intercessor-squad",
		"factionId":       "adeptus-astartes",
		"attachedUnitIds": []any{"librarian"},
	}, map[string]any{"phase": "fight"})
	got := contribTypesFrom(attached, "mental-fortress-adeptus-astartes")
	if len(got) != 1 || asInt(got[0]["threshold"]) != 4 {
		t.Errorf("mental-fortress-psychic buffs = %v, want one 4+ invulnerable-save", got)
	}
}

func TestDroppedModelScopedEffectIsReportedUnsupported(t *testing.T) {
	ds := EmbeddedDataset()
	ability, ok := ds.Abilities.GetAny("shadowfield-drukhari")
	if !ok {
		t.Fatal("shadowfield missing from the embedded dataset")
	}
	result := effectToBuffs(
		ability.Raw["effect"],
		map[string]any{
			"kind":         "ability",
			"abilityId":    "shadowfield-drukhari",
			"abilityKind":  "attached",
			"sourceUnitId": "archon",
		},
		map[string]any{"phase": "shooting"},
		"target",
	)
	if len(result.applied) != 0 {
		t.Errorf("applied = %v, want none", result.applied)
	}
	if len(result.unsupported) != 1 {
		t.Fatalf("unsupported = %v, want exactly one diagnostic", result.unsupported)
	}
	u, _ := asMap(result.unsupported[0])
	if getStr(u, "reason") != modelScopedReasonTest {
		t.Errorf("reason = %q, want %q", getStr(u, "reason"), modelScopedReasonTest)
	}
}

func TestModelScopeGateIsAttackerSideTooAndSparesUnitScopedGrants(t *testing.T) {
	ds := EmbeddedDataset()
	keywords := func(buffs []any, abilityID string) []string {
		var out []string
		for _, c := range contribTypesFrom(buffs, abilityID) {
			if getStr(c, "type") != "extra-keyword" {
				continue
			}
			ref, _ := getMap(c, "keywordRef")
			out = append(out, getStr(ref, "keyword_id"))
		}
		return out
	}

	// Psychic Gifts reads "the bearer has the Psyker keyword" — model-scoped.
	led := ds.buffsFor(map[string]any{
		"unitId":          "inquisitorial-agents",
		"factionId":       "agents-of-the-imperium",
		"attachedUnitIds": []any{"inquisitor"},
	}, map[string]any{"phase": "command"})
	if got := keywords(led, "psychic-gifts-agents-of-the-imperium"); len(got) != 0 {
		t.Errorf("psychic-gifts keywords on the led unit = %v, want none", got)
	}
	alone := ds.buffsFor(
		map[string]any{"unitId": "inquisitor", "factionId": "agents-of-the-imperium"},
		map[string]any{"phase": "command"},
	)
	if got := keywords(alone, "psychic-gifts-agents-of-the-imperium"); len(got) != 1 || got[0] != "psyker" {
		t.Errorf("psychic-gifts keywords on the Inquisitor itself = %v, want [psyker]", got)
	}

	// Surgical Precision is unit-scoped, so an attached Apothecary Biologis
	// still grants [LETHAL HITS] to the squad it joined.
	aggressors := ds.buffsFor(map[string]any{
		"unitId":          "aggressor-squad",
		"factionId":       "adeptus-astartes",
		"attachedUnitIds": []any{"apothecary-biologis"},
	}, map[string]any{"phase": "shooting"})
	if got := keywords(aggressors, "surgical-precision-adeptus-astartes"); len(got) != 1 || got[0] != "lethal-hits" {
		t.Errorf("surgical-precision keywords = %v, want [lethal-hits]", got)
	}
}

// The QOL accessors on UnitView/WeaponView read the same fields the raw record
// carries; mirror of the TS views-profile tests.
func TestUnitAndWeaponViewAccessors(t *testing.T) {
	ds := EmbeddedDataset()
	unit, ok := ds.Units.GetInFaction("aggressor-squad", "adeptus-astartes")
	if !ok {
		t.Fatal("aggressor-squad missing from adeptus-astartes")
	}
	if got := unit.FactionID(); got != "adeptus-astartes" {
		t.Errorf("FactionID() = %q, want adeptus-astartes", got)
	}
	// role is optional in the schema — the getter mirrors the raw field ("" when absent).
	if unit.Role() != getStr(unit.Raw, "role") {
		t.Errorf("Role() = %q, want the raw role", unit.Role())
	}
	if len(unit.Keywords()) == 0 {
		t.Error("Keywords() is empty")
	}
	if len(unit.FactionKeywords()) == 0 {
		t.Error("FactionKeywords() is empty")
	}
	if unit.ModelCount() == nil {
		t.Error("ModelCount() is nil")
	}
	if len(unit.Points()) == 0 {
		t.Error("Points() is empty")
	}
	if len(unit.Profiles()) != unit.ProfileCount() || unit.ProfileCount() == 0 {
		t.Errorf("Profiles()=%d ProfileCount()=%d, want equal and non-zero",
			len(unit.Profiles()), unit.ProfileCount())
	}

	weapon, ok := ds.Weapons.GetAny("bolt-rifle")
	if !ok {
		t.Fatal("bolt-rifle not resolvable")
	}
	if weapon.Type() == "" {
		t.Error("Type() is empty")
	}
	if len(weapon.Profiles()) != weapon.ProfileCount() || weapon.ProfileCount() == 0 {
		t.Errorf("Profiles()=%d ProfileCount()=%d, want equal and non-zero",
			len(weapon.Profiles()), weapon.ProfileCount())
	}
	first, ok := weapon.profileAt(0)
	if !ok {
		t.Fatal("profileAt(0) missing")
	}
	if len(weapon.Profiles()) > 0 && weapon.Profiles()[0]["stats"] == nil && first["stats"] != nil {
		t.Error("Profiles()[0] does not match profileAt(0)")
	}
}

// recordSecondary clamps by the round's remaining room and the game-wide
// secondary total; with no caps it stays unbounded (historical behavior).
func TestRecordSecondaryCaps(t *testing.T) {
	rc, gc := 15, 45
	pg := recordSecondary(emptyPlayerGame("fixed"), 1, 99, &rc, &gc)
	if got := playerSecondary(pg); got != 15 {
		t.Errorf("round-capped secondary = %d, want 15", got)
	}
	// A second scoring in the same round has no room left.
	pg = recordSecondary(pg, 1, 5, &rc, &gc)
	if got := playerSecondary(pg); got != 15 {
		t.Errorf("secondary after a full round = %d, want 15", got)
	}
	// Later rounds are bounded by the game cap net of the other rounds.
	pg = recordSecondary(pg, 2, 99, &rc, &gc)
	pg = recordSecondary(pg, 3, 99, &rc, &gc)
	pg = recordSecondary(pg, 4, 99, &rc, &gc)
	if got := playerSecondary(pg); got != 45 {
		t.Errorf("game-capped secondary = %d, want 45", got)
	}

	uncapped := recordSecondary(emptyPlayerGame("fixed"), 1, 99, nil, nil)
	if got := playerSecondary(uncapped); got != 99 {
		t.Errorf("uncapped secondary = %d, want 99", got)
	}
}

// scoreSecondary logs the clamped amount, not the asserted one, so remove-score
// undoes exactly what was banked.
func TestScoreSecondaryLogsClampedVP(t *testing.T) {
	rc, gc := 15, 45
	pg := addToHand(emptyPlayerGame("fixed"), "assassination")
	pg = scoreSecondary(pg, 1, "assassination", 99, &rc, &gc)
	logList := getList(pg, "log")
	if len(logList) != 1 {
		t.Fatalf("log entries = %d, want 1", len(logList))
	}
	entry, _ := asMap(logList[0])
	if got := asInt(entry["vp"]); got != 15 {
		t.Errorf("logged vp = %d, want 15 (clamped)", got)
	}
	if got := playerSecondary(removeScore(pg, 0)); got != 0 {
		t.Errorf("secondary after remove-score = %d, want 0", got)
	}
}

func TestEntityBackedRulesBundleExpandsBeforeBuffTranslation(t *testing.T) {
	raw := emptyRawData()
	raw["abilities"] = []any{
		map[string]any{
			"ability_id": "shared-rules",
			"name":       "Shared Rules",
			"faction_id": "orks",
			"effect": map[string]any{
				"type": "rules-bundle",
				"steps": []any{
					map[string]any{
						"type":     "re-roll",
						"target":   "this-unit",
						"modifier": map[string]any{"roll": "hit", "subset": "ones"},
					},
					map[string]any{
						"type":     "re-roll",
						"target":   "this-unit",
						"modifier": map[string]any{"roll": "wound", "subset": "ones"},
					},
				},
			},
		},
		map[string]any{
			"ability_id": "bundle-grant",
			"name":       "Bundle Grant",
			"faction_id": "orks",
			"effect": map[string]any{
				"type":   "ability-grant",
				"target": "this-unit",
				"modifier": map[string]any{
					"ability":      "shared-rules",
					"rules_bundle": true,
				},
			},
		},
		map[string]any{
			"ability_id": "cycle-a",
			"name":       "Cycle A",
			"faction_id": "orks",
			"effect": map[string]any{
				"type": "rules-bundle",
				"steps": []any{
					map[string]any{
						"type":     "ability-grant",
						"target":   "this-unit",
						"modifier": map[string]any{"ability": "cycle-b", "rules_bundle": true},
					},
				},
			},
		},
		map[string]any{
			"ability_id": "cycle-b",
			"name":       "Cycle B",
			"faction_id": "orks",
			"effect": map[string]any{
				"type": "rules-bundle",
				"steps": []any{
					map[string]any{
						"type":     "ability-grant",
						"target":   "this-unit",
						"modifier": map[string]any{"ability": "cycle-a", "rules_bundle": true},
					},
				},
			},
		},
	}
	ability, ok := NewDataset(raw).Abilities.GetInFaction("bundle-grant", "orks")
	if !ok {
		t.Fatal("bundle-grant missing")
	}

	result := ability.describeBuffs(
		map[string]any{"kind": "ability", "abilityId": "bundle-grant", "abilityKind": "unit"},
		map[string]any{"phase": "shooting"},
		"attacker",
	)
	if len(result.applied) != 2 || len(result.unsupported) != 0 {
		t.Fatalf("translation = %#v", result)
	}
	for i, roll := range []string{"hit", "wound"} {
		buff, _ := asMap(result.applied[i])
		contribution, _ := getMap(buff, "contribution")
		if getStr(contribution, "type") != "reroll" ||
			getStr(contribution, "roll") != roll ||
			getStr(contribution, "subset") != "ones" {
			t.Fatalf("contribution[%d] = %#v", i, contribution)
		}
	}

	cycle, ok := NewDataset(raw).Abilities.GetInFaction("cycle-a", "orks")
	if !ok {
		t.Fatal("cycle-a missing")
	}
	cyclicResult := cycle.describeBuffs(
		map[string]any{"kind": "ability", "abilityId": "cycle-a", "abilityKind": "unit"},
		map[string]any{"phase": "shooting"},
		"attacker",
	)
	if len(cyclicResult.applied) != 0 || len(cyclicResult.unsupported) != 1 {
		t.Fatalf("cyclic translation = %#v", cyclicResult)
	}
	unsupported, _ := asMap(cyclicResult.unsupported[0])
	if got := getStr(unsupported, "reason"); got != `effect type "ability-grant" is not modelled by the buff layer` {
		t.Fatalf("cyclic unsupported reason = %q", got)
	}
}

func hasKeywordBuff(buffs []any, keywordID string) bool {
	for _, buffValue := range buffs {
		buff, _ := asMap(buffValue)
		contribution, _ := getMap(buff, "contribution")
		keywordRef, _ := getMap(contribution, "keywordRef")
		if getStr(keywordRef, "keyword_id") == keywordID {
			return true
		}
	}
	return false
}

func TestWeaponKeywordTargetGatesApplyInLinkedBuffAPI(t *testing.T) {
	ds := EmbeddedDataset()
	input := map[string]any{
		"weaponProfiles": []any{
			map[string]any{"weaponId": "big-shoota", "profileIndex": 0},
		},
	}
	matching := ds.buffsFor(input, map[string]any{
		"phase": "shooting", "targetKeywords": []any{"infantry"},
	})
	if !hasKeywordBuff(matching, "lethal-hits") {
		t.Fatal("matching target lost conditional Lethal Hits")
	}
	excluded := ds.buffsFor(input, map[string]any{
		"phase": "shooting", "targetKeywords": []any{"monster"},
	})
	if hasKeywordBuff(excluded, "lethal-hits") {
		t.Fatal("excluded target retained conditional Lethal Hits")
	}
}

// TestUsageAndTriggerGatingMatchTheReference pins the five fabricated gating
// abilities also pinned in tools/test/buff-gating.test.ts and the Python tests.
func TestUsageAndTriggerGatingMatchTheReference(t *testing.T) {
	reroll := map[string]any{"type": "re-roll", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "subset": "ones"}}
	ability := func(id string, fields map[string]any) map[string]any {
		out := map[string]any{"ability_id": id, "name": id, "faction_id": "orks", "effect": reroll}
		for k, v := range fields {
			out[k] = v
		}
		return out
	}
	raw := emptyRawData()
	raw["abilities"] = []any{
		ability("fixture-usage", map[string]any{"behavior": "passive", "usage": map[string]any{"frequency": "n-per-battle", "count": 1}}),
		ability("fixture-stratagem", map[string]any{"ability_type": "stratagem", "behavior": "activated", "usage": map[string]any{"frequency": "once-per-turn"}}),
		ability("fixture-moment", map[string]any{"behavior": "reactive", "trigger": map[string]any{"event": "selected", "filter": map[string]any{"to": "shoot"}}, "usage": map[string]any{"frequency": "once-per-turn"}}),
		ability("fixture-attack-step", map[string]any{"behavior": "reactive", "trigger": map[string]any{"event": "before-roll", "subject": map[string]any{"owner": "any"}, "filter": map[string]any{"roll": "hit"}}}),
		ability("fixture-charge", map[string]any{"behavior": "reactive", "trigger": map[string]any{"event": "move-ended", "filter": map[string]any{"move_types": []any{"charge"}}}}),
	}
	ds := NewDataset(raw)
	gated := func(id string, ctx map[string]any) (int, []string) {
		view, ok := ds.Abilities.GetInFaction(id, "orks")
		if !ok {
			t.Fatalf("%s missing", id)
		}
		result := view.describeBuffs(map[string]any{"kind": "ability", "abilityId": id, "abilityKind": "unit"}, ctx, "attacker")
		levers := []string{}
		for _, lever := range result.activatable {
			m, _ := asMap(lever)
			levers = append(levers, getStr(m, "id"))
		}
		return len(result.applied), levers
	}
	fight := map[string]any{"phase": "fight"}
	cases := []struct {
		id      string
		ctx     map[string]any
		applied int
		levers  string
	}{
		{"fixture-usage", fight, 0, "fixture-usage@n-per-battle"},
		{"fixture-stratagem", fight, 1, ""},
		{"fixture-moment", fight, 0, "fixture-moment@selected:shoot"},
		{"fixture-attack-step", fight, 1, ""},
		{"fixture-charge", map[string]any{"phase": "fight", "attackerCharged": true}, 1, ""},
		{"fixture-charge", map[string]any{"phase": "fight", "attackerCharged": false}, 0, ""},
	}
	for _, c := range cases {
		applied, levers := gated(c.id, c.ctx)
		if applied != c.applied || strings.Join(levers, ",") != c.levers {
			t.Fatalf("%s: applied %d levers %v, want %d %q", c.id, applied, levers, c.applied, c.levers)
		}
	}
}
