package wh40kdc

// Condition evaluators that read declared scenario state: which rules are
// active, which regions a unit is in, how many objectives each side controls,
// and which units make up a combined unit. Each returns true, false, or nil
// ("unknown") when the context does not declare the fact it needs. Mirror of
// tools/src/cruncher/scenario-conditions.ts.
//
//	activeRules                     []string | []{ability_id, option_id?, definition_id?}
//	attackerRegions, targetRegions  []{ruleRegion?, terrainArea?, territory?, deploymentZone?, wholly?}
//	objectivesControlled            {attacker, target, total}
//	attackerMembers, targetMembers  []{unitId, role: leader|bodyguard|support, keywords}
//	attackerNeighbours, targetNeighbours  []{keywords, owner: friendly|enemy, distanceInches}

// keywordPredicateKeys are the keyword-predicate fields of a unit filter.
var keywordPredicateKeys = []string{"all_of", "any_of", "none_of", "not_all_of"}

// evaluateRuleActive evaluates `rule-active`: a rule id is active when it, or
// one of its options or definitions, is listed; an option or definition
// reference needs that exact entry.
func evaluateRuleActive(params, ctx map[string]any) any {
	active, known := asList(ctx["activeRules"])
	if !known {
		return nil
	}
	rule := params["rule"]
	if id, ok := rule.(string); ok {
		for _, entry := range active {
			if text, ok := entry.(string); ok {
				if text == id {
					return true
				}
			} else if record, ok := asMap(entry); ok && record != nil && record["ability_id"] == id {
				return true
			}
		}
		return false
	}
	ref, ok := asMap(rule)
	if !ok || ref == nil {
		return nil
	}
	abilityID, ok := ref["ability_id"].(string)
	if !ok {
		return nil
	}
	key := ""
	if _, ok := ref["option_id"].(string); ok {
		key = "option_id"
	} else if _, ok := ref["definition_id"].(string); ok {
		key = "definition_id"
	}
	if key == "" {
		return nil
	}
	for _, entry := range active {
		record, ok := asMap(entry)
		if !ok || record == nil || record["ability_id"] != abilityID {
			continue
		}
		if value, ok := record[key].(string); ok && value == ref[key] {
			return true
		}
	}
	return false
}

// evaluateInRegion evaluates `in-region` for the unit on side. Territory and
// deployment zones are read from the ability's side. "Wholly" and "every
// model" need an entry that declares the unit wholly in the region.
func evaluateInRegion(params, ctx map[string]any, side, abilitySide string) any {
	regions, known := asList(sideValue(ctx, side, "Regions"))
	region, isRegion := asMap(params["region"])
	if !known || !isRegion || region == nil {
		return nil
	}
	if models, present := params["models"]; present && models != "any" && models != "every" {
		return nil
	}
	wholly := params["wholly"] == true || params["models"] == "every"
	matches := regionMatcher(region, abilitySide)
	if matches == nil {
		return nil
	}
	for _, raw := range regions {
		entry, ok := asMap(raw)
		if !ok || entry == nil {
			continue
		}
		if matches(entry) && (!wholly || entry["wholly"] == true) {
			return true
		}
	}
	return false
}

// regionMatcher is the scenario-region test for a condition's region, or nil
// when the scenario cannot describe that region.
func regionMatcher(region map[string]any, abilitySide string) func(map[string]any) bool {
	if territory, ok := region["territory"].(string); ok {
		field, wanted := "", ""
		switch territory {
		case "your-territory":
			field, wanted = "territory", abilitySide
		case "enemy-territory":
			field, wanted = "territory", otherSide(abilitySide)
		case "attacker-territory":
			field, wanted = "territory", "attacker"
		case "no-mans-land":
			field, wanted = "territory", "no-mans-land"
		case "your-deployment-zone":
			field, wanted = "deploymentZone", abilitySide
		case "enemy-deployment-zone":
			field, wanted = "deploymentZone", otherSide(abilitySide)
		default:
			return nil
		}
		return func(entry map[string]any) bool { return entry[field] == wanted }
	}
	if terrain, ok := asMap(region["terrain_area"]); ok && terrain != nil {
		// A designated terrain area needs designations the scenario does not carry.
		if _, designated := terrain["designated"]; designated {
			return nil
		}
		return func(entry map[string]any) bool { return entry["terrainArea"] == true }
	}
	if ruleRegion, ok := asMap(region["rule_region"]); ok && ruleRegion != nil {
		if id, ok := ruleRegion["region_id"].(string); ok {
			return func(entry map[string]any) bool { return entry["ruleRegion"] == id }
		}
	}
	return nil
}

// compareNumbers applies a comparison operator, or returns nil for an
// unrecognised one.
func compareNumbers(left float64, comparison any, right float64) any {
	switch comparison {
	case "gt":
		return left > right
	case "gte":
		return left >= right
	case "lt":
		return left < right
	case "lte":
		return left <= right
	case "eq":
		return left == right
	}
	return nil
}

// evaluateControls evaluates `controls`: objectives the `by` side (friendly
// unless stated, relative to the ability's side) controls, bounded by `count`,
// compared with the other side's, or as a `proportion` of every objective.
// Every stated clause must hold. An objective filter needs per-objective state.
func evaluateControls(params, ctx map[string]any, abilitySide string) any {
	control, known := asMap(ctx["objectivesControlled"])
	if _, filtered := params["objective"]; !known || control == nil || filtered {
		return nil
	}
	sideOf := func(owner any, present bool) string {
		if !present || owner == "friendly" {
			return abilitySide
		}
		if owner == "enemy" {
			return otherSide(abilitySide)
		}
		return ""
	}
	byValue, byPresent := params["by"]
	by := sideOf(byValue, byPresent)
	if by == "" {
		return nil
	}
	count, countKnown := contextNumber(control[by])
	if !countKnown {
		return nil
	}
	verdicts := []any{}
	if rawBounds, present := params["count"]; present {
		bounds, ok := asMap(rawBounds)
		if !ok || bounds == nil {
			return nil
		}
		minimum, minPresent := bounds["min"]
		maximum, maxPresent := bounds["max"]
		low, lowOK := contextNumber(minimum)
		high, highOK := contextNumber(maximum)
		if (minPresent && !lowOK) || (maxPresent && !highOK) {
			return nil
		}
		verdicts = append(verdicts, (!minPresent || count >= low) && (!maxPresent || count <= high))
	}
	if rawCompare, present := params["compare"]; present {
		compare, ok := asMap(rawCompare)
		if !ok || compare == nil {
			return nil
		}
		owner, ownerPresent := compare["owner"]
		against := sideOf(owner, ownerPresent)
		if against == "" {
			return nil
		}
		other, otherKnown := contextNumber(control[against])
		if !otherKnown {
			return nil
		}
		verdicts = append(verdicts, compareNumbers(count, compare["comparison"], other))
	}
	if rawProportion, present := params["proportion"]; present {
		proportion, ok := asMap(rawProportion)
		fraction, fractionOK := contextNumber(proportion["fraction"])
		total, totalOK := contextNumber(control["total"])
		if !ok || proportion == nil || !fractionOK || !totalOK || total <= 0 {
			return nil
		}
		verdicts = append(verdicts, compareNumbers(count/total, proportion["comparison"], fraction))
	}
	// Bare `controls` means at least one objective.
	if len(verdicts) == 0 {
		verdicts = append(verdicts, count >= 1)
	}
	unknown := false
	for _, verdict := range verdicts {
		if verdict == false {
			return false
		}
		if verdict == nil {
			unknown = true
		}
	}
	if unknown {
		return nil
	}
	return true
}

// attachmentFromMembers evaluates the `attachment` facts the combined unit's
// members settle. own is the unit the ability belongs to ("" when unknown).
// Leading needs own to be a Leader with a Bodyguard; led needs another member
// that is a Leader; attached needs another member. `with` narrows those other
// members by keyword (friendly units only).
func attachmentFromMembers(role, withFilter, rawMembers any, own string) any {
	members, known := asList(rawMembers)
	if !known || own == "" {
		return nil
	}
	var self map[string]any
	others := []map[string]any{}
	for _, raw := range members {
		member, ok := asMap(raw)
		if !ok || member == nil {
			continue
		}
		if member["unitId"] == own {
			if self == nil {
				self = member
			}
		} else {
			others = append(others, member)
		}
	}
	if self == nil {
		return false
	}
	var candidates []map[string]any
	switch role {
	case "leading":
		candidates = []map[string]any{}
		if self["role"] == "leader" {
			candidates = membersWithRole(others, "bodyguard")
		}
	case "led":
		candidates = membersWithRole(others, "leader")
	case "attached":
		candidates = others
	default:
		return nil
	}
	if withFilter == nil {
		return len(candidates) > 0
	}
	with, ok := asMap(withFilter)
	if !ok {
		return nil
	}
	if with["owner"] == "enemy" {
		return false
	}
	predicate := map[string]any{}
	for key := range with {
		if key != "owner" && !isKeywordPredicateKey(key) {
			return nil
		}
	}
	for _, key := range keywordPredicateKeys {
		value, present := with[key]
		if !present {
			continue
		}
		items, ok := stringItems(value)
		if !ok {
			return nil
		}
		predicate[key] = items
	}
	for _, member := range candidates {
		if unitMatchesAppliesTo(predicate, getStrList(member, "keywords")) {
			return true
		}
	}
	return false
}

func membersWithRole(members []map[string]any, role string) []map[string]any {
	out := []map[string]any{}
	for _, member := range members {
		if member["role"] == role {
			out = append(out, member)
		}
	}
	return out
}

func isKeywordPredicateKey(key string) bool {
	for _, candidate := range keywordPredicateKeys {
		if key == candidate {
			return true
		}
	}
	return false
}

// stringItems returns value as a list when every item is a string.
func stringItems(value any) ([]any, bool) {
	items, ok := asList(value)
	if !ok {
		return nil, false
	}
	for _, item := range items {
		if _, ok := item.(string); !ok {
			return nil, false
		}
	}
	return items, true
}

// attachmentFromFlags evaluates `attachment` from the attachment flags and
// roles alone; `with` filters are left to the members.
func attachmentFromFlags(params, ctx map[string]any, perspective string, source map[string]any) any {
	subject := params["subject"]
	explicitSide := ""
	switch subject {
	case "attacker":
		explicitSide = "attacker"
	case "defender":
		explicitSide = "target"
	}
	side := explicitSide
	if side == "" {
		side = perspectiveSide(perspective)
	}
	attached := sideValue(ctx, side, "Attached")
	role := sideValue(ctx, side, "AttachmentRole")
	if explicitSide == "" && sourcedFromAttachment(source) {
		role = nil
		if id, ok := source["sourceUnitId"].(string); ok {
			if roles, ok := getMap(ctx, "attachmentRoles"); ok {
				role = roles[id]
			}
		}
		if getStr(source, "abilityKind") == "attached" || role != nil {
			attached = true
		} else {
			attached = nil
		}
	}
	if attached == false {
		return false
	}
	switch params["role"] {
	case "attached":
		if attached == nil {
			return nil
		}
		return attached == true
	case "leading":
		if role == nil {
			return nil
		}
		return role == "leader"
	case "led":
		// A bodyguard is known to be led; other combined-unit leadership needs more facts.
		if role == "bodyguard" {
			return true
		}
	}
	return nil
}

// sourcedFromAttachment reports an ability an attached Leader or Support unit
// brings to the combined unit.
func sourcedFromAttachment(source map[string]any) bool {
	kind := getStr(source, "abilityKind")
	return getStr(source, "kind") == "ability" && (kind == "attached" || kind == "support")
}

// evaluateAttachment evaluates `attachment`: the members settle it when the
// context lists them, else the flags (which cannot settle a `with` filter).
func evaluateAttachment(params, ctx map[string]any, perspective string, source map[string]any) any {
	subject := params["subject"]
	explicitSide := ""
	switch subject {
	case "attacker":
		explicitSide = "attacker"
	case "defender":
		explicitSide = "target"
	default:
		if subject != nil && subject != "this-model" && subject != "this-unit" && subject != "ability-unit" {
			return nil
		}
	}
	flags := attachmentFromFlags(params, ctx, perspective, source)
	if flags == false {
		return false
	}
	side := explicitSide
	if side == "" {
		side = perspectiveSide(perspective)
	}
	var own string
	if explicitSide == "" && sourcedFromAttachment(source) {
		own, _ = source["sourceUnitId"].(string)
	} else {
		own, _ = sideValue(ctx, side, "UnitId").(string)
	}
	if members := attachmentFromMembers(params["role"], params["with"], sideValue(ctx, side, "Members"), own); members != nil {
		return members
	}
	if params["with"] == nil {
		return flags
	}
	return nil
}

// isNeighbourFilter reports a `within.of` that names other units by keyword
// and owner.
func isNeighbourFilter(of map[string]any) bool {
	if len(of) == 0 {
		return false
	}
	for key, value := range of {
		if key == "owner" {
			if value != "friendly" && value != "enemy" && value != "any" {
				return false
			}
			continue
		}
		if !isKeywordPredicateKey(key) {
			return false
		}
		if _, ok := stringItems(value); !ok {
			return false
		}
	}
	return true
}

// withinNeighbour reports whether a unit near the filtered unit meets a
// `within.of` filter within inches. The filter's owner is relative to the
// ability's side; a neighbour's owner is relative to the filtered unit, so
// they agree only when the ability belongs to the filtered unit's side.
func withinNeighbour(of map[string]any, inches float64, rawNeighbours any, sameSide bool) any {
	neighbours, known := asList(rawNeighbours)
	if !known {
		return nil
	}
	predicate := map[string]any{}
	for _, key := range keywordPredicateKeys {
		if value, present := of[key]; present {
			predicate[key] = value
		}
	}
	wanted, ownerPresent := of["owner"]
	for _, raw := range neighbours {
		neighbour, ok := asMap(raw)
		if !ok || neighbour == nil {
			continue
		}
		owner := neighbour["owner"]
		if !sameSide {
			if owner == "friendly" {
				owner = "enemy"
			} else {
				owner = "friendly"
			}
		}
		if ownerPresent && wanted != "any" && wanted != owner {
			continue
		}
		distance, ok := contextNumber(neighbour["distanceInches"])
		if ok && distance <= inches && unitMatchesAppliesTo(predicate, getStrList(neighbour, "keywords")) {
			return true
		}
	}
	return false
}
