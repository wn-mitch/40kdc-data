package wh40kdc

// Terrain op handlers. Go mirror of the resolve_terrain / keystones handlers in
// python .../runner.py.

func (s *RunnerState) handleResolveTerrain(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("resolve_terrain args must be an object"))
	}
	layout, ok := getMap(a, "layout")
	if !ok {
		return errResp("INVALID_INPUT", detail("resolve_terrain.layout must be an object"))
	}
	templates := getList(a, "templates")
	if a["templates"] != nil {
		if _, isList := a["templates"].([]any); !isList {
			return errResp("INVALID_INPUT", detail("resolve_terrain.templates must be an array"))
		}
	}
	pieces, err := resolveLayout(layout, templates)
	if err != nil {
		return errResp("INVALID_INPUT", detail(err.Error()))
	}
	return okResp(map[string]any{"pieces": toAny(pieces)})
}

func (s *RunnerState) handleKeystones(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("keystones args must be an object"))
	}
	layout, ok := getMap(a, "layout")
	if !ok {
		return errResp("INVALID_INPUT", detail("keystones.layout must be an object"))
	}
	templates := getList(a, "templates")
	if a["templates"] != nil {
		if _, isList := a["templates"].([]any); !isList {
			return errResp("INVALID_INPUT", detail("keystones.templates must be an array"))
		}
	}
	var board map[string]float64
	if a["board"] != nil {
		b, ok := asMap(a["board"])
		if !ok || !isNumber(b["width"]) || !isNumber(b["height"]) {
			return errResp("INVALID_INPUT", detail("keystones.board must be {width, height}"))
		}
		board = map[string]float64{"width": numOr0(b["width"]), "height": numOr0(b["height"])}
	}
	measurements, err := keystoneMeasurements(layout, templates, board)
	if err != nil {
		return errResp("INVALID_INPUT", detail(err.Error()))
	}
	return okResp(map[string]any{"measurements": toAny(measurements)})
}

func toAny(xs []map[string]any) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}
