package wh40kdc

// validate op handler. Go mirror of python runner._handle_validate.

func (s *RunnerState) handleValidate(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("validate args must be an object"))
	}
	target, ok := a["target"].(string)
	if !ok {
		return errResp("INVALID_INPUT", detail("unknown validator target"))
	}
	id, ok := validatorTargets[target]
	if !ok {
		return errResp("INVALID_INPUT", detail("unknown validator target: "+target))
	}
	validator := s.validatorInstance()
	if !validator.hasSchema(id) {
		return errResp("VALIDATION_ERROR", detail("schema not loaded: "+target))
	}
	errs := validator.validateTarget(target, a["value"])
	out := make([]any, len(errs))
	for i, e := range errs {
		out[i] = e
	}
	return okResp(out)
}
