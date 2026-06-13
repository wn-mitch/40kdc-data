package wh40kdc

// Temporary stubs so the module compiles while the port is built incrementally.
// Each stub is removed as its area lands (Phases 1-5). A stubbed op returns
// UNKNOWN_OP, which makes the differ *skip* that area for go pairings rather
// than diff on the ok flag.

// --- stub types (replaced by the real ones in validator.go) ---

// SchemaValidator is replaced by the real implementation in Phase 5.
type SchemaValidator struct{}

// NewSchemaValidator is replaced by the real implementation in Phase 5.
func NewSchemaValidator() *SchemaValidator { return &SchemaValidator{} }

// --- stub handlers (replaced per phase) ---

func unimplemented() map[string]any { return errResp("UNKNOWN_OP", nil) }

func (s *RunnerState) handleImport(args any) map[string]any           { return unimplemented() }
func (s *RunnerState) handleTryImport(args any) map[string]any        { return unimplemented() }
func (s *RunnerState) handleExport(args any) map[string]any           { return unimplemented() }
func (s *RunnerState) handleValidate(args any) map[string]any         { return unimplemented() }
func (s *RunnerState) handleCrunch(args any) map[string]any           { return unimplemented() }
func (s *RunnerState) handleCompare(args any) map[string]any          { return unimplemented() }
func (s *RunnerState) handleLoadout(args any) map[string]any          { return unimplemented() }
func (s *RunnerState) handleAttribution(args any) map[string]any      { return unimplemented() }
func (s *RunnerState) handleTranslateScoring(args any) map[string]any { return unimplemented() }
func (s *RunnerState) handleTranslateEffect(args any) map[string]any  { return unimplemented() }

// handleEligibleAbilities (linked_query "eligible_abilities") lands in Phase 3.
func (s *RunnerState) handleEligibleAbilities(in map[string]any) map[string]any {
	return unimplemented()
}
