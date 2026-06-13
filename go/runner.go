package wh40kdc

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

// NDJSON conformance runner — the Go implementation of the wire protocol in
// conformance/RUNNER_PROTOCOL.md. Each stdin line is a JSON request {op,args?};
// each stdout line is {ok:true,value} or {ok:false,error_kind,error_payload?}.
//
// The runner is a thin wrapper over the public API; it exists to give the
// cross-implementation differ a uniform interface. Go mirror of
// python .../runner.py and tools/src/runner.ts. Dispatch is exported so tests
// can drive the runner in-process without spawning a child.

const implName = "go"

func ok(value any) map[string]any {
	return map[string]any{"ok": true, "value": value}
}

func errResp(kind string, payload any) map[string]any {
	r := map[string]any{"ok": false, "error_kind": kind}
	if payload != nil {
		r["error_payload"] = payload
	}
	return r
}

func detail(s string) map[string]any { return map[string]any{"detail": s} }

// RunnerState holds the per-process runner state. init must be the first
// request; subsequent ops fail with INVALID_INPUT until init succeeds. The
// dataset and validator are built lazily.
type RunnerState struct {
	initialized bool
	locale      string
	tz          string
	seed        float64

	ds        *Dataset
	validator *SchemaValidator
}

// NewRunnerState returns a fresh runner state.
func NewRunnerState() *RunnerState { return &RunnerState{locale: "C", tz: "UTC"} }

func (s *RunnerState) dataset() *Dataset {
	if s.ds == nil {
		s.ds = EmbeddedDataset()
	}
	return s.ds
}

func (s *RunnerState) validatorInstance() *SchemaValidator {
	if s.validator == nil {
		s.validator = NewSchemaValidator()
	}
	return s.validator
}

func (s *RunnerState) handleInit(args any) map[string]any {
	if s.initialized {
		return errResp("INVALID_INPUT", detail("init called twice"))
	}
	a, ok2 := asMap(args)
	if !ok2 {
		return errResp("INVALID_INPUT", detail("init args must be an object"))
	}
	if asInt(a["spec_version"]) != SpecVersion || !isNumber(a["spec_version"]) {
		return errResp("INVALID_INPUT", detail("spec_version mismatch"))
	}
	if getStr(a, "locale") != "C" {
		return errResp("INVALID_INPUT", detail("unsupported locale (only \"C\")"))
	}
	if getStr(a, "tz") != "UTC" {
		return errResp("INVALID_INPUT", detail("unsupported tz (only \"UTC\")"))
	}
	if !isNumber(a["seed"]) {
		return errResp("INVALID_INPUT", detail("seed must be a number"))
	}
	s.initialized = true
	s.locale = "C"
	s.tz = "UTC"
	s.seed, _ = num(a["seed"])
	return ok(map[string]any{"impl": implName, "spec_version": SpecVersion, "impl_version": Version})
}

// Dispatch applies one decoded request to the runner state and returns the
// response. Used directly by tests; the CLI loop wraps it with line parsing.
func (s *RunnerState) Dispatch(req map[string]any) map[string]any {
	op, _ := req["op"].(string)
	args := req["args"]
	if !s.initialized && op != "init" {
		return errResp("INVALID_INPUT", detail("must init before any other op"))
	}
	switch op {
	case "init":
		return s.handleInit(args)
	case "version":
		return ok(map[string]any{"impl": implName, "spec_version": SpecVersion, "impl_version": Version})
	case "normalize":
		return s.handleNormalize(args)
	case "import":
		return s.handleImport(args)
	case "try_import":
		return s.handleTryImport(args)
	case "export":
		return s.handleExport(args)
	case "linked_query":
		return s.handleLinkedQuery(args)
	case "validate":
		return s.handleValidate(args)
	case "crunch":
		return s.handleCrunch(args)
	case "compare":
		return s.handleCompare(args)
	case "loadout":
		return s.handleLoadout(args)
	case "attribution":
		return s.handleAttribution(args)
	case "translate_scoring":
		return s.handleTranslateScoring(args)
	case "translate_effect":
		return s.handleTranslateEffect(args)
	case "match_applies_to":
		return s.handleMatchAppliesTo(args)
	case "score_event":
		return s.handleScoreEvent(args)
	case "score_state":
		return s.handleScoreState(args)
	case "wtc_result":
		return s.handleWtcResult(args)
	case "resolve_terrain":
		return s.handleResolveTerrain(args)
	case "keystones":
		return s.handleKeystones(args)
	case "share_encode":
		return s.handleShareEncode(args)
	case "share_decode":
		return s.handleShareDecode(args)
	case "shutdown":
		return ok(nil)
	default:
		return errResp("UNKNOWN_OP", map[string]any{"op": op})
	}
}

func (s *RunnerState) handleNormalize(args any) map[string]any {
	a, ok2 := asMap(args)
	if !ok2 {
		return errResp("INVALID_INPUT", detail("normalize args must be an object"))
	}
	in, ok3 := a["input"].(string)
	if !ok3 {
		return errResp("INVALID_INPUT", detail("normalize.input must be a string"))
	}
	return ok(NormalizeName(in))
}

// processRequest processes one line of stdin and returns the line to write to
// stdout, or ("",false) for empty lines (silently ignored).
func (s *RunnerState) processRequest(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "", false
	}
	var req map[string]any
	if err := json.Unmarshal([]byte(trimmed), &req); err != nil {
		out, _ := json.Marshal(errResp("INVALID_INPUT", detail("not valid JSON: "+err.Error())))
		return string(out), true
	}
	if _, isStr := req["op"].(string); !isStr {
		out, _ := json.Marshal(errResp("INVALID_INPUT", detail("request must have a string `op` field")))
		return string(out), true
	}
	resp := s.Dispatch(req)
	out, _ := json.Marshal(resp)
	return string(out), true
}

// RunnerMain runs the stdin/stdout NDJSON loop. The differ pipelines requests
// and expects responses in order, flushed per line.
func RunnerMain(in io.Reader, out io.Writer) error {
	state := NewRunnerState()
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<27) // large lines (full rosters)
	w := bufio.NewWriter(out)
	for scanner.Scan() {
		line := scanner.Text()
		resp, write := state.processRequest(line)
		if write {
			w.WriteString(resp)
			w.WriteByte('\n')
			w.Flush()
		}
		var req map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &req) == nil {
			if op, _ := req["op"].(string); op == "shutdown" {
				return nil
			}
		}
	}
	return scanner.Err()
}
