package wh40kdc

import "testing"

// Schema pins for the phase-4 shapes, mirroring tools/test/phase4-shapes-schema.test.ts:
// each shape accepts its documented form and rejects the misuse its if/then or
// oneOf exists to stop. Several rejections depend on oneOf failing when more
// than one branch matches.

// TestOneOfRejectsSeveralMatches pins oneOf exclusivity: an instance matching
// two branches is invalid (AJV and jsonschema agree), so a nested oneOf inside
// not / if / anyOf evaluates the same in every port.
func TestOneOfRejectsSeveralMatches(t *testing.T) {
	v := NewSchemaValidator()
	schema := map[string]any{"oneOf": []any{map[string]any{"type": "number"}, map[string]any{"minimum": 0.0}}}
	if v.valid(schema, 5.0, "") {
		t.Fatal("5 matches both branches but was accepted")
	}
	if !v.valid(schema, -1.0, "") || !v.valid(schema, "x", "") {
		t.Fatal("a single-branch match was rejected")
	}
	// The oneOf error maps to no closed-enum code, as in TS (AJV's "oneOf" keyword is unmapped).
	if _, ok := keywordToCode["oneOf"]; ok {
		t.Fatal("oneOf must stay unmapped")
	}
}
