package wh40kdc

import (
	"reflect"
	"testing"
)

func conditionalAttachmentDataset() *Dataset {
	unit := func(id, name, role, attachmentRole string) any {
		return map[string]any{
			"id": id, "name": name, "role": role, "attachment_role": attachmentRole,
		}
	}
	return NewDataset(rawData{
		"units": []any{
			unit("conditional-leader", "Conditional Leader", "character", "leader"),
			unit("flat-bodyguard", "Flat Bodyguard", "battleline", ""),
			unit("required-bodyguard", "Required Bodyguard", "battleline", ""),
			unit("excluded-bodyguard", "Excluded Bodyguard", "battleline", ""),
			unit("required-companion", "Required Companion", "character", ""),
			unit("excluded-companion", "Excluded Companion", "character", ""),
		},
		"leader_attachments": []any{map[string]any{
			"leader_id":              "conditional-leader",
			"eligible_bodyguard_ids": []any{"flat-bodyguard"},
			"conditional_groups": []any{
				map[string]any{
					"role": "support", "eligible_bodyguard_ids": []any{"required-bodyguard"},
					"required_roster_unit_ids": []any{"required-companion"},
				},
				map[string]any{
					"role": "leader", "eligible_bodyguard_ids": []any{"excluded-bodyguard"},
					"excluded_roster_unit_ids": []any{"excluded-companion", "required-companion"},
				},
			},
		}},
	})
}

func viewIDs(views []*UnitView) []string {
	ids := make([]string, len(views))
	for i, view := range views {
		ids[i] = view.ID()
	}
	return ids
}

func hasRosterViolation(violations []rosterViolation, code, id string, unitIndex int) bool {
	for _, violation := range violations {
		if violation.code == code && violation.id == id && violation.unitIndex == unitIndex {
			return true
		}
	}
	return false
}

func TestConditionalAttachmentBrowseAndRosterLegality(t *testing.T) {
	ds := conditionalAttachmentDataset()
	if got, want := viewIDs(ds.bodyguardsAttachableFrom("conditional-leader")), []string{
		"excluded-bodyguard", "flat-bodyguard", "required-bodyguard",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("possible bodyguards = %v, want %v", got, want)
	}

	blocked := map[string]struct{}{"excluded-companion": {}}
	if got, want := viewIDs(ds.bodyguardsAttachableFromInRoster("conditional-leader", blocked)), []string{"flat-bodyguard"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("bodyguards with excluded companion = %v, want %v", got, want)
	}
	withRequired := map[string]struct{}{"required-companion": {}}
	if got, want := viewIDs(ds.bodyguardsAttachableFromInRoster("conditional-leader", withRequired)), []string{
		"flat-bodyguard", "required-bodyguard",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("bodyguards with required companion = %v, want %v", got, want)
	}
	if got := viewIDs(ds.leadersAttachableToInRoster("required-bodyguard", blocked)); len(got) != 0 {
		t.Fatalf("leaders for unavailable required bodyguard = %v, want none", got)
	}
	if got, want := viewIDs(ds.leadersAttachableToInRoster("required-bodyguard", withRequired)), []string{"conditional-leader"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("leaders for required bodyguard = %v, want %v", got, want)
	}

	_, supportViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, counts: map[string]int{}},
		{unitID: "required-companion", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if !hasRosterViolation(supportViolations, "leader-must-attach", "conditional-leader", 0) {
		t.Fatalf("required companion did not switch leader to support: %v", supportViolations)
	}

	_, leaderViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, counts: map[string]int{}},
		{unitID: "excluded-companion", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if hasRosterViolation(leaderViolations, "leader-must-attach", "conditional-leader", 0) {
		t.Fatalf("excluded companion did not leave leader solo-legal: %v", leaderViolations)
	}

	_, legalAttachmentViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, leaderBodyguardID: "required-bodyguard", counts: map[string]int{}},
		{unitID: "required-companion", modelCount: 1, counts: map[string]int{}},
		{unitID: "required-bodyguard", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if hasRosterViolation(legalAttachmentViolations, "leader-attachment-illegal", "conditional-leader", 0) {
		t.Fatalf("required conditional attachment was illegal: %v", legalAttachmentViolations)
	}

	_, illegalAttachmentViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, leaderBodyguardID: "required-bodyguard", counts: map[string]int{}},
		{unitID: "excluded-companion", modelCount: 1, counts: map[string]int{}},
		{unitID: "required-bodyguard", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if !hasRosterViolation(illegalAttachmentViolations, "leader-attachment-illegal", "conditional-leader", 0) {
		t.Fatalf("required bodyguard remained legal without its companion: %v", illegalAttachmentViolations)
	}

	_, permittedExcludedViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, leaderBodyguardID: "excluded-bodyguard", counts: map[string]int{}},
		{unitID: "excluded-bodyguard", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if hasRosterViolation(permittedExcludedViolations, "leader-attachment-illegal", "conditional-leader", 0) {
		t.Fatalf("excluded-condition bodyguard was illegal without its exclusion: %v", permittedExcludedViolations)
	}

	_, blockedExcludedViolations := validateRosterCore(normRoster{units: []normUnit{
		{unitID: "conditional-leader", modelCount: 1, leaderBodyguardID: "excluded-bodyguard", counts: map[string]int{}},
		{unitID: "excluded-companion", modelCount: 1, counts: map[string]int{}},
		{unitID: "excluded-bodyguard", modelCount: 1, counts: map[string]int{}},
	}}, ds)
	if !hasRosterViolation(blockedExcludedViolations, "leader-attachment-illegal", "conditional-leader", 0) {
		t.Fatalf("excluded-condition bodyguard remained legal with its exclusion: %v", blockedExcludedViolations)
	}
}

func TestConditionalSupportAttachmentInferenceUsesRosterContext(t *testing.T) {
	ds := conditionalAttachmentDataset()
	parsedUnits := []any{
		map[string]any{"raw_name": "Conditional Leader", "is_character": true},
		map[string]any{"raw_name": "Required Bodyguard", "is_character": false},
		map[string]any{"raw_name": "Required Companion", "is_character": true},
	}
	units := []any{
		map[string]any{"ref": refResolved("conditional-leader", "Conditional Leader")},
		map[string]any{"ref": refResolved("required-bodyguard", "Required Bodyguard")},
		map[string]any{"ref": refResolved("required-companion", "Required Companion")},
	}
	applyLeaderAttachments(parsedUnits, units, ds, "", &diagBuilder{})
	attachment, ok := units[0].(map[string]any)["leader_attachment"].(map[string]any)
	if !ok {
		t.Fatal("support role with required companion was not inferred")
	}
	bodyguard := attachment["bodyguard_ref"].(map[string]any)
	if got := getStr(bodyguard, "id"); got != "required-bodyguard" {
		t.Fatalf("inferred bodyguard = %q, want required-bodyguard", got)
	}

	withoutCompanion := []any{
		map[string]any{"ref": refResolved("conditional-leader", "Conditional Leader")},
		map[string]any{"ref": refResolved("required-bodyguard", "Required Bodyguard")},
	}
	applyLeaderAttachments(parsedUnits[:2], withoutCompanion, ds, "", &diagBuilder{})
	if _, inferred := withoutCompanion[0].(map[string]any)["leader_attachment"]; inferred {
		t.Fatal("leader role without required companion was inferred as an attachment")
	}
}

func TestConditionalAttachmentOverlapLeaderWins(t *testing.T) {
	ds := conditionalAttachmentDataset()
	withRequired := map[string]struct{}{"required-companion": {}}
	if role := ds.attachmentRole("conditional-leader", "leader", withRequired); role != "support" {
		t.Fatalf("conditional support role = %q, want support", role)
	}
	attachment := ds.LeaderAttachments[0].(map[string]any)
	attachment["conditional_groups"] = append(getList(attachment, "conditional_groups"), map[string]any{
		"role": "leader", "eligible_bodyguard_ids": []any{"required-bodyguard"},
		"required_roster_unit_ids": []any{"required-companion"},
	})
	if role := ds.attachmentRole("conditional-leader", "support", withRequired); role != "leader" {
		t.Fatalf("overlapping leader role = %q, want leader", role)
	}
}
