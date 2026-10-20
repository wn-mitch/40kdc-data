package wh40kdc

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// The expected-value damage engine. Closed-form math over schema profiles + a
// flat buff stack. Go mirror of python .../cruncher/engine.py. The reduction
// order is a conformance contract (buffs left-to-right, stages left-to-right);
// only the numeric `expected` per stage crosses the wire (detail strings are
// dropped).

var diceRe = regexp.MustCompile(`^(\d*)[dD](\d+)([+-]\d+)?$`)

type crunchError struct{ msg string }

func (e *crunchError) Error() string { return e.msg }

// profileBuffs returns the buffs contributed by profile i's intrinsic keywords.
func (w *WeaponView) profileBuffs(i int, ctx map[string]any) []any {
	var out []any
	for _, entry := range w.keywordsAt(i) {
		kw := entry["keyword"].(*WeaponKeywordView)
		var params map[string]any
		if p, ok := asMap(entry["parameters"]); ok {
			params = p
		}
		out = append(out, buffsFromKeyword(kw.ID(), w.ID(), kw.Raw["effect"], params, ctx)...)
	}
	return out
}

func profileBuffsFor(attacker map[string]any, ds *Dataset, ctx map[string]any) []any {
	// Resolve buffs from the attacker's OWN weapon object, never a re-lookup by
	// id: a bare weapon id shared across factions first-wins-resolves to whichever
	// faction bundled first, feeding the WRONG faction's keywords into buff math
	// (issue #59). attacker["weapon"] is authoritative and carries its profiles.
	return manualWeaponKeywordBuffs(attacker, ds, ctx)
}

func profileCanTarget(profile map[string]any, target map[string]any) bool {
	restrictions, ok := getMap(profile, "target_restrictions")
	if !ok {
		return true
	}
	targetKeywords := map[string]bool{}
	for _, keyword := range append(getList(target, "keywords"), getList(target, "faction_keywords")...) {
		if value, ok := keyword.(string); ok {
			targetKeywords[lower(value)] = true
		}
	}
	required := getList(restrictions, "required_keywords_any")
	if len(required) > 0 {
		matched := false
		for _, keyword := range required {
			if value, ok := keyword.(string); ok && targetKeywords[lower(value)] {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	for _, keyword := range getList(restrictions, "excluded_keywords") {
		if value, ok := keyword.(string); ok && targetKeywords[lower(value)] {
			return false
		}
	}
	return true
}

func manualWeaponKeywordBuffs(attacker map[string]any, ds *Dataset, ctx map[string]any) []any {
	weapon, _ := getMap(attacker, "weapon")
	profiles := getList(weapon, "profiles")
	index := asInt(attacker["profileIndex"])
	if index < 0 || index >= len(profiles) {
		return nil
	}
	prof, _ := asMap(profiles[index])
	var out []any
	for _, refAny := range getList(prof, "keywords") {
		ref, _ := asMap(refAny)
		view, ok := ds.WeaponKeywords.Get(getStr(ref, "keyword_id"))
		if !ok {
			continue
		}
		var params map[string]any
		if p, ok := getMap(ref, "parameters"); ok {
			params = p
		}
		out = append(out, buffsFromKeyword(view.ID(), getStr(weapon, "id"), view.Raw["effect"], params, ctx)...)
	}
	return out
}

func stage(name string, expected float64) map[string]any {
	return map[string]any{"name": name, "expected": expected}
}

// crunch computes the per-stage projection for one (attacker, target, buffs)
// triple. Returns the stages, the resolved modifiers (for attribution), or an
// error.
func crunch(input map[string]any, ds *Dataset) ([]map[string]any, *resolved, error) {
	attacker, _ := getMap(input, "attacker")
	target, _ := getMap(input, "target")
	weapon, _ := getMap(attacker, "weapon")
	profiles := getList(weapon, "profiles")
	profileIndex := asInt(attacker["profileIndex"])
	if profileIndex < 0 || profileIndex >= len(profiles) {
		return nil, nil, &crunchError{"crunch: attacker.profileIndex out of range for weapon " + getStr(weapon, "id")}
	}
	weaponProfile, _ := asMap(profiles[profileIndex])
	unit, _ := getMap(target, "unit")
	unitProfiles := getList(unit, "profiles")
	targetProfileIndex := asInt(target["profileIndex"])
	if targetProfileIndex < 0 || targetProfileIndex >= len(unitProfiles) {
		return nil, nil, &crunchError{"crunch: target.profileIndex out of range for unit " + getStr(unit, "id")}
	}
	unitProfile, _ := asMap(unitProfiles[targetProfileIndex])
	if !profileCanTarget(weaponProfile, unit) {
		return nil, nil, &crunchError{msg: "crunch: weapon " + getStr(weapon, "id") +
			" profile " + strconv.Itoa(profileIndex) + " cannot target unit " + getStr(unit, "id")}
	}

	targetKeywords := unitKeywordsLower(unit)
	ctx := cloneMap(getMapOr(input, "context"))
	if ctx["attackerUnitId"] == nil {
		ctx["attackerUnitId"] = getStr(attacker, "unitId")
	}
	if ctx["targetUnitId"] == nil {
		ctx["targetUnitId"] = getStr(unit, "id")
	}
	if ctx["targetKeywords"] == nil {
		tk := make([]any, len(targetKeywords))
		for i, k := range targetKeywords {
			tk[i] = k
		}
		ctx["targetKeywords"] = tk
	}
	if ctx["weaponNames"] == nil {
		// Lower-cased, de-duplicated weapon and profile names drive applicableWhen.weaponName.
		names := []any{}
		for _, v := range []any{weapon["name"], weaponProfile["name"]} {
			if name, ok := v.(string); ok && !containsAny(names, lower(name)) {
				names = append(names, lower(name))
			}
		}
		ctx["weaponNames"] = names
	}
	// The request's weaponKeywords and weaponKeywordRefs each default to the profile's printed
	// keywords independently, so refs the request supplies survive a defaulted id list.
	if ctx["weaponKeywords"] == nil || ctx["weaponKeywordRefs"] == nil {
		keywords := []any{}
		refs := []any{}
		for _, refAny := range getList(weaponProfile, "keywords") {
			if ref, ok := asMap(refAny); ok && ref != nil {
				if id := getStr(ref, "keyword_id"); id != "" && !containsAny(keywords, id) {
					keywords = append(keywords, id)
				}
				refs = append(refs, ref)
			}
		}
		if ctx["weaponKeywords"] == nil {
			ctx["weaponKeywords"] = keywords
		}
		if ctx["weaponKeywordRefs"] == nil {
			ctx["weaponKeywordRefs"] = refs
		}
	}

	profBuffs := profileBuffsFor(attacker, ds, ctx)
	allBuffs := append(append([]any{}, profBuffs...), getList(input, "buffs")...)
	res := resolveBuffs(allBuffs, ctx)

	stats, _ := getMap(weaponProfile, "stats")
	stages := []map[string]any{}

	// Melee/ranged is per-profile (11e weapons mix profiles), not weapon-level.
	isMelee := getStr(weaponProfile, "range") == "Melee"

	// 1. Attacks
	baseA, err := evalStatValue(stats["A"])
	if err != nil {
		return nil, nil, err
	}
	attacksPerModel := baseA + res.attacksMod
	rapidFire := res.findKeyword("rapid-fire")
	halfRange := ctx["withinHalfRange"] == true
	rapidFireExtra := 0.0
	if rapidFire != nil && halfRange {
		rapidFireExtra, err = evalStatValue(paramValue(rapidFire, "value"))
		if err != nil {
			return nil, nil, err
		}
	}
	blast := res.findKeyword("blast")
	targetModelCount := target["modelCount"]
	if targetModelCount == nil {
		mc, _ := getMap(unit, "model_count")
		targetModelCount = mc["min"]
	}
	tmc := 1.0
	if isNumber(targetModelCount) {
		tmc, _ = num(targetModelCount)
	}
	blastExtra := 0.0
	if blast != nil {
		value, err := evalStatValue(paramValue(blast, "value"))
		if err != nil {
			value = 1
		}
		blastExtra = math.Floor(tmc/5) * value
	}
	modelsFiring, _ := num(input["modelsFiring"])
	attacks := modelsFiring * (attacksPerModel + rapidFireExtra + blastExtra)
	stages = append(stages, stage("attacks", attacks))

	// 2. Hits
	ignoresCover := res.findKeyword("ignores-cover") != nil
	// Ignoring hit modifiers also ignores the cover penalty.
	_, ignoreHit := res.ignoreModifiers["hit"]
	covered := res.coverActive && !ignoresCover && !isMelee && !ignoreHit
	coverHitPenalty := 0.0
	if covered {
		coverHitPenalty = -1
	}
	var hitStat any
	if isMelee {
		hitStat = stats["WS"]
	} else {
		hitStat = stats["BS"]
	}
	torrent := res.findKeyword("torrent") != nil
	var hits, critHits float64
	if torrent {
		hits = attacks
		critHits = 0
	} else {
		if !isNumber(hitStat) {
			ws := "BS"
			if isMelee {
				ws = "WS"
			}
			return nil, nil, &crunchError{"crunch: weapon " + getStr(weapon, "id") + " missing " + ws}
		}
		hitStatN, _ := num(hitStat)
		// A WS/BS improvement changes the characteristic itself, floored at 2+.
		skillStat := "BS"
		if isMelee {
			skillStat = "WS"
		}
		if skillMod := res.skillMod[skillStat]; skillMod != 0 {
			hitStatN = math.Max(2, hitStatN-skillMod)
		}
		critHitThreshold := 6.0
		if crit, ok := res.critThresholds["hit"]; ok {
			critHitThreshold = math.Min(6, crit.value)
		}
		hitModifier := res.hitMod + coverHitPenalty
		passP, critP := checkProbabilities(hitStatN, hitModifier, rerollSubset(res, "hit"), true, true, critHitThreshold)
		hits = attacks * passP
		critHits = attacks * critP
	}
	sustained := res.findKeyword("sustained-hits")
	if sustained != nil {
		sv, err := evalStatValue(paramValue(sustained, "value"))
		if err != nil {
			return nil, nil, err
		}
		hits += critHits * sv
	}
	stages = append(stages, stage("hits", hits))

	// 3. Wounds
	sBase, err := evalStatValue(stats["S"])
	if err != nil {
		return nil, nil, err
	}
	sStat := sBase + res.strengthMod
	tStat := numOr0(unitProfile["T"]) + res.toughnessMod
	stdWoundNeeded := woundThreshold(sStat, tStat)
	antiThreshold := antiWoundThreshold(res.extraKeywords, targetKeywords)
	critWoundThreshold := math.Min(6, antiThreshold)
	if crit, ok := res.critThresholds["wound"]; ok {
		critWoundThreshold = math.Min(critWoundThreshold, crit.value)
	}
	hasLethal := res.findKeyword("lethal-hits") != nil
	hitsForWoundRoll := hits
	lethalAutoWounds := 0.0
	if hasLethal {
		hitsForWoundRoll = hits - critHits
		lethalAutoWounds = critHits
	}
	woundPass, woundCrit := checkProbabilities(float64(stdWoundNeeded), res.woundMod, rerollSubset(res, "wound"), true, true, critWoundThreshold)
	regularWoundsFromRoll := hitsForWoundRoll * (woundPass - woundCrit)
	critWoundsFromRoll := hitsForWoundRoll * woundCrit
	totalRegularWounds := regularWoundsFromRoll + lethalAutoWounds
	hasDevastating := res.findKeyword("devastating-wounds") != nil
	mortalWoundsStream := 0.0
	if hasDevastating {
		mortalWoundsStream = critWoundsFromRoll
	}
	regularWoundsForSaves := totalRegularWounds + critWoundsFromRoll
	if hasDevastating {
		regularWoundsForSaves = totalRegularWounds
	}
	totalWounds := regularWoundsForSaves + mortalWoundsStream
	stages = append(stages, stage("wounds", totalWounds))

	// 4. Saves
	// Worsening AP stops at 0.
	ap := math.Min(0, numOr0(stats["AP"])+res.apMod)
	sv := numOr0(unitProfile["Sv"])
	if res.saveCharacteristic != nil {
		sv = res.saveCharacteristic.value
	}
	armorTargetRaw := sv - ap - res.saveMod
	armorFinal := clampF(armorTargetRaw, 2, 7)
	var effectiveInvuln *float64
	// Attack-scoped invuln (issue #87): a ranged-/melee-only save applies only to
	// that attack type; fall back to the unconditional invuln_sv when unscoped.
	scopedKey := "invuln_sv_ranged"
	if isMelee {
		scopedKey = "invuln_sv_melee"
	}
	pv := unitProfile[scopedKey]
	if !isNumber(pv) {
		pv = unitProfile["invuln_sv"]
	}
	if isNumber(pv) {
		p, _ := num(pv)
		effectiveInvuln = &p
	}
	if res.invulnerable != nil {
		ai := res.invulnerable.threshold
		if effectiveInvuln == nil {
			effectiveInvuln = &ai
		} else if ai < *effectiveInvuln {
			effectiveInvuln = &ai
		}
	}
	effectiveSaveTarget := armorFinal
	if effectiveInvuln != nil {
		effectiveSaveTarget = math.Min(armorFinal, *effectiveInvuln)
	}
	savePass, _ := checkProbabilities(effectiveSaveTarget, 0, rerollSubset(res, "save"), true, false, 7)
	pSaved := savePass
	if effectiveSaveTarget >= 7 {
		pSaved = 0
	}
	unsaved := regularWoundsForSaves * (1 - pSaved)
	stages = append(stages, stage("unsaved", unsaved))

	// 5. Damage
	// Evaluated first so an unparseable D reports the stat-value error, matching
	// the reference engine's order.
	if _, err := evalStatValue(stats["D"]); err != nil {
		return nil, nil, err
	}
	melta := res.findKeyword("melta")
	meltaBonus := 0.0
	if melta != nil && halfRange {
		meltaBonus, err = evalStatValue(paramValue(melta, "value"))
		if err != nil {
			return nil, nil, err
		}
	}
	// 10e damage-reduction abilities always carry the canonical "to a minimum
	// of 1" clause, so the floor lives in the math, not the data. The clause
	// only applies when damage-reduction is active. Both floors act on each
	// Damage roll, as does a damage reroll.
	damageReroll := ""
	if e, ok := res.rerolls["damage"]; ok {
		damageReroll = e.subset
	}
	perAttack, err := damageRoll(damageRollInput{
		stat:      stats["D"],
		bonus:     meltaBonus,
		modifier:  res.damageMod,
		reduction: res.damageReduction,
		reroll:    damageReroll,
	})
	if err != nil {
		return nil, nil, err
	}
	damagePerHit := perAttack.expected
	damageMain := unsaved * damagePerHit
	damageMortal := mortalWoundsStream * damagePerHit
	damage := damageMain + damageMortal
	stages = append(stages, stage("damage", damage))

	// 6. FNP
	pSurviveAll := fnpSurvivalFraction(res.feelNoPain)
	pSurviveMortal := fnpSurvivalFraction(res.feelNoPainMortal)
	afterMain := damageMain * pSurviveAll
	afterMortal := damageMortal * pSurviveAll * pSurviveMortal
	afterFnp := afterMain + afterMortal
	stages = append(stages, stage("after-fnp", afterFnp))

	// 7. Models killed
	woundsStat := numOr0(unitProfile["W"])
	expectedModelsKilled := 0.0
	if woundsStat > 0 {
		expectedModelsKilled = math.Min(tmc, afterFnp/woundsStat)
	}
	stages = append(stages, stage("models-killed", expectedModelsKilled))

	return stages, res, nil
}

func getMapOr(m map[string]any, key string) map[string]any {
	v, _ := getMap(m, key)
	if v == nil {
		return map[string]any{}
	}
	return v
}

func paramValue(ref map[string]any, key string) any {
	params, _ := getMap(ref, "parameters")
	if params == nil {
		return nil
	}
	return params[key]
}

func rerollSubset(r *resolved, roll string) string {
	if e, ok := r.rerolls[roll]; ok {
		return e.subset
	}
	return "none"
}

func unitKeywordsLower(unit map[string]any) []string {
	var out []string
	for _, k := range getStrList(unit, "keywords") {
		out = append(out, lower(k))
	}
	for _, k := range getStrList(unit, "faction_keywords") {
		out = append(out, lower(k))
	}
	return out
}

// antiWoundThreshold is the lowest critical-wound threshold any Anti keyword grants against the
// target, or 7 (unreachable) when none applies. An Anti applies when it names a target: its
// target_keyword the unit has, at least one of its required_target_keywords_any, and none of its
// excluded_target_keywords. Only an integer threshold in 2..6 counts. targetKeywords are lower
// case. Mirror of the Anti loop in tools/src/cruncher/engine.ts.
func antiWoundThreshold(extraKeywords []extraKw, targetKeywords []string) float64 {
	threshold := 7.0
	hasAny := func(raw any) bool {
		list, _ := raw.([]any)
		for _, keyword := range list {
			if text, ok := keyword.(string); ok && containsStr2(targetKeywords, lower(text)) {
				return true
			}
		}
		return false
	}
	for _, entry := range extraKeywords {
		if getStr(entry.keywordRef, "keyword_id") != "anti" {
			continue
		}
		params, _ := getMap(entry.keywordRef, "parameters")
		targetKw, hasTargetKw := params["target_keyword"].(string)
		required, hasRequired := params["required_target_keywords_any"].([]any)
		_, hasExcluded := params["excluded_target_keywords"].([]any)
		if !hasTargetKw && !hasRequired && !hasExcluded {
			continue
		}
		if hasTargetKw && !containsStr2(targetKeywords, lower(targetKw)) {
			continue
		}
		if hasRequired && !hasAny(required) {
			continue
		}
		if hasExcluded && hasAny(params["excluded_target_keywords"]) {
			continue
		}
		value := jsNumber(params["threshold"])
		if value == math.Trunc(value) && value >= 2 && value <= 6 {
			threshold = math.Min(threshold, value)
		}
	}
	return threshold
}

func containsStr2(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func woundThreshold(s, t float64) int {
	switch {
	case s >= 2*t:
		return 2
	case s > t:
		return 3
	case s == t:
		return 4
	case s*2 > t:
		return 5
	default:
		return 6
	}
}

func checkProbabilities(unmodifiedNeeded, modifier float64, reroll string, autoFailOnOne, autoPassOnSix bool, critThreshold float64) (float64, float64) {
	outcome := func(face int) (int, int) {
		f := float64(face)
		if autoFailOnOne && face == 1 {
			return 0, 0
		}
		if f >= critThreshold {
			return 1, 1
		}
		if autoPassOnSix && face == 6 {
			return 1, 0
		}
		if (f + modifier) >= unmodifiedNeeded {
			return 1, 0
		}
		return 0, 0
	}
	passP, critP := 0.0, 0.0
	for face := 1; face <= 6; face++ {
		p, c := outcome(face)
		if p == 1 {
			passP += 1.0 / 6
			critP += float64(c) / 6
			continue
		}
		eligible := reroll == "all-failures" || (reroll == "ones" && face == 1)
		if !eligible {
			continue
		}
		rerollPass, rerollCrit := 0.0, 0.0
		for f2 := 1; f2 <= 6; f2++ {
			sp, sc := outcome(f2)
			rerollPass += float64(sp) / 6
			rerollCrit += float64(sc) / 6
		}
		passP += rerollPass / 6
		critP += rerollCrit / 6
	}
	return passP, critP
}

func jsNumber(v any) float64 {
	switch x := v.(type) {
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case nil:
		return math.NaN()
	case string:
		t := strings.TrimSpace(x)
		if t == "" {
			return 0
		}
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	}
	return math.NaN()
}

func unresolvedQuantityError(v any) error {
	encoded, err := json.Marshal(v)
	if err != nil {
		encoded = []byte("<unserializable>")
	}
	return &crunchError{"evalStatValue: unresolved quantity " + string(encoded)}
}

func evalStatValue(v any) (float64, error) {
	if isNumber(v) {
		f, _ := num(v)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, unresolvedQuantityError(v)
		}
		return f, nil
	}
	if v != nil {
		if _, ok := v.(string); !ok {
			return 0, unresolvedQuantityError(v)
		}
	}
	s, ok := v.(string)
	if !ok {
		return 0, unresolvedQuantityError(v)
	}
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return 0, nil
	}
	if asNumber, err := strconv.ParseFloat(trimmed, 64); err == nil {
		if !math.IsInf(asNumber, 0) && !math.IsNaN(asNumber) {
			return asNumber, nil
		}
	}
	m := diceRe.FindStringSubmatch(trimmed)
	if m == nil {
		return 0, &crunchError{"eval_stat_value: cannot parse \"" + s + "\""}
	}
	count := 1
	if m[1] != "" {
		count, _ = strconv.Atoi(m[1])
	}
	die, _ := strconv.Atoi(m[2])
	offset := 0
	if m[3] != "" {
		offset, _ = strconv.Atoi(m[3])
	}
	return float64(count)*(float64(die)+1)/2 + float64(offset), nil
}

func clampF(n, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, n))
}

func fnpSurvivalFraction(f *fnpState) float64 {
	if f == nil {
		return 1
	}
	pSucc := math.Max(0, math.Min(1, (7-f.threshold)/6))
	return 1 - pSucc
}
