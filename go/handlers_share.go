package wh40kdc

// Share op handlers. Go mirror of the share_encode / share_decode handlers in
// python .../runner.py.

func (s *RunnerState) handleShareEncode(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("share_encode args must be an object"))
	}
	list, ok := getMap(a, "list")
	if !ok {
		return errResp("INVALID_INPUT", detail("share_encode.list must be an object"))
	}
	token, err := encodeShareToken(list)
	if err != nil {
		// An id absent from the embedded registry is the only expected throw.
		return errResp("INVALID_INPUT", detail(err.Error()))
	}
	return okResp(token)
}

func (s *RunnerState) handleShareDecode(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("share_decode args must be an object"))
	}
	token, ok := a["token"].(string)
	if !ok {
		return errResp("INVALID_INPUT", detail("share_decode.token must be a string"))
	}
	// A malformed/stale token is a normal result (the inner ok carries it).
	return okResp(decodeShareToken(token))
}
