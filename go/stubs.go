package wh40kdc

// Temporary stubs so the module compiles while the port is built incrementally.
// Each stub is removed as its area lands. A stubbed op returns UNKNOWN_OP, which
// makes the differ *skip* that area for go pairings rather than diff on the ok
// flag.

// --- stub types (replaced by the real one in validator.go) ---

// SchemaValidator is replaced by the real implementation in Phase 5.
type SchemaValidator struct{}

// NewSchemaValidator is replaced by the real implementation in Phase 5.
func NewSchemaValidator() *SchemaValidator { return &SchemaValidator{} }

// --- stub handlers (replaced per phase) ---

func unimplemented() map[string]any { return errResp("UNKNOWN_OP", nil) }

func (s *RunnerState) handleImport(args any) map[string]any    { return unimplemented() }
func (s *RunnerState) handleTryImport(args any) map[string]any { return unimplemented() }
func (s *RunnerState) handleExport(args any) map[string]any    { return unimplemented() }
func (s *RunnerState) handleValidate(args any) map[string]any  { return unimplemented() }
