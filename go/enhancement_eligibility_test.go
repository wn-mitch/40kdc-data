package wh40kdc

import "testing"

func TestMeetsEnhancementGroupsDatasheetScoped(t *testing.T) {
	holds := func(keywords ...string) func(string) bool {
		return func(k string) bool {
			for _, kw := range keywords {
				if kw == k {
					return true
				}
			}
			return false
		}
	}
	if !meetsEnhancementGroups(map[string]any{}, "any-unit", holds()) {
		t.Fatal("an enhancement with no groups admits any bearer")
	}
	solo := map[string]any{"datasheet_restriction_groups": []any{map[string]any{"unit_id": "squad-a", "keywords": []any{"Faction"}}}}
	if meetsEnhancementGroups(solo, "squad-b", holds("Faction", "Squad A")) {
		t.Fatal("a datasheet-only record must not admit another unit carrying the datasheet's name")
	}
	if meetsEnhancementGroups(solo, "squad-a", holds()) {
		t.Fatal("a datasheet group still needs its keywords")
	}
	if !meetsEnhancementGroups(solo, "squad-a", holds("Faction")) {
		t.Fatal("the named datasheet with its keywords is eligible")
	}
	mixed := map[string]any{
		"keyword_restrictions":         []any{"Infantry", "Leader"},
		"datasheet_restriction_groups": []any{map[string]any{"unit_id": "squad-a"}},
	}
	if !meetsEnhancementGroups(mixed, "squad-a", holds()) || !meetsEnhancementGroups(mixed, "squad-b", holds("Infantry", "Leader")) {
		t.Fatal("datasheet and keyword groups are alternatives")
	}
	if meetsEnhancementGroups(mixed, "squad-b", holds("Infantry")) {
		t.Fatal("a partial keyword group is not eligible")
	}
}
