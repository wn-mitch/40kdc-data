package wh40kdc

import "math"

// Terrain layout resolver + keystone derivation. Go mirror of
// python .../terrain/resolve.py and keystones.py, pinned by
// conformance/terrain-resolver and terrain-keystones. Vertices are 4-dp
// rounded with JS Math.round semantics (half toward +Inf), compared with ±5e-4.

const deg = math.Pi / 180

// boardInches is the 40kdc standard board extent (x=width, y=height).
var boardInches = map[string]float64{"width": 60, "height": 44}

type terrainError struct{ msg string }

func (e *terrainError) Error() string { return e.msg }

type vec2 struct{ x, y float64 }

func footprintVertices(fp map[string]any) ([]vec2, error) {
	switch getStr(fp, "type") {
	case "rectangle":
		w, _ := num(fp["width"])
		h, _ := num(fp["height"])
		return []vec2{{0, 0}, {w, 0}, {w, h}, {0, h}}, nil
	case "right-triangle":
		w, _ := num(fp["width"])
		h, _ := num(fp["height"])
		return []vec2{{0, 0}, {w, 0}, {0, h}}, nil
	case "polygon":
		var out []vec2
		for _, pAny := range getList(fp, "points") {
			p, _ := asMap(pAny)
			px, _ := num(p["x"])
			py, _ := num(p["y"])
			out = append(out, vec2{px, py})
		}
		return out, nil
	default:
		return nil, &terrainError{"unknown footprint type: " + getStr(fp, "type")}
	}
}

func polygonCentroid(verts []vec2) vec2 {
	n := len(verts)
	if n == 0 {
		return vec2{0, 0}
	}
	twiceArea, cx, cy := 0.0, 0.0, 0.0
	for i := 0; i < n; i++ {
		a := verts[i]
		b := verts[(i+1)%n]
		cross := a.x*b.y - b.x*a.y
		twiceArea += cross
		cx += (a.x + b.x) * cross
		cy += (a.y + b.y) * cross
	}
	if twiceArea == 0 {
		var mx, my float64
		for _, v := range verts {
			mx += v.x
			my += v.y
		}
		return vec2{mx / float64(n), my / float64(n)}
	}
	return vec2{cx / (3 * twiceArea), cy / (3 * twiceArea)}
}

func applyMirror(v vec2, m string) vec2 {
	switch m {
	case "horizontal":
		return vec2{-v.x, v.y}
	case "vertical":
		return vec2{v.x, -v.y}
	}
	return v
}

func rotateCW(v vec2, degVal float64) vec2 {
	if degVal == 0 {
		return v
	}
	r := degVal * deg
	c := math.Cos(r)
	s := math.Sin(r)
	return vec2{c*v.x - s*v.y, s*v.x + c*v.y}
}

func orient(v vec2, rotation float64, mirror string) vec2 {
	return rotateCW(applyMirror(v, mirror), rotation)
}

func placeFootprint(fp map[string]any, position vec2, rotation float64, mirror string) ([]vec2, error) {
	verts, err := footprintVertices(fp)
	if err != nil {
		return nil, err
	}
	c := polygonCentroid(verts)
	out := make([]vec2, len(verts))
	for i, v := range verts {
		o := orient(vec2{v.x - c.x, v.y - c.y}, rotation, mirror)
		out[i] = vec2{o.x + position.x, o.y + position.y}
	}
	return out, nil
}

func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

func round4(v vec2) vec2 {
	return vec2{jsRound(v.x*1e4) / 1e4, jsRound(v.y*1e4) / 1e4}
}

func vec2JSON(v vec2) map[string]any { return map[string]any{"x": v.x, "y": v.y} }

func posOf(piece map[string]any) vec2 {
	p, _ := getMap(piece, "position")
	px, _ := num(p["x"])
	py, _ := num(p["y"])
	return vec2{px, py}
}

func numOr0(v any) float64 {
	f, _ := num(v)
	return f
}

// resolveLayout resolves a layout to absolute board-space vertices per piece.
func resolveLayout(layout map[string]any, templates []any) ([]map[string]any, error) {
	byID := map[string]map[string]any{}
	for _, tAny := range templates {
		t, _ := asMap(tAny)
		byID[getStr(t, "id")] = t
	}
	pieces := getList(layout, "pieces")
	areasByID := map[string]map[string]any{}
	for _, pAny := range pieces {
		p, _ := asMap(pAny)
		if id := getStr(p, "id"); id != "" {
			areasByID[id] = p
		}
	}

	footprintOf := func(piece map[string]any, where string) (map[string]any, error) {
		if fp, ok := getMap(piece, "footprint"); ok && fp != nil {
			return fp, nil
		}
		if tmpl := getStr(piece, "template"); tmpl != "" {
			t, ok := byID[tmpl]
			if !ok {
				return nil, &terrainError{where + ": unknown template \"" + tmpl + "\""}
			}
			fp, _ := getMap(t, "footprint")
			return fp, nil
		}
		return nil, &terrainError{where + ": piece has neither footprint nor template"}
	}

	idName := func(piece map[string]any) map[string]any {
		return map[string]any{"id": piece["id"], "name": piece["name"]}
	}

	var out []map[string]any
	for _, pieceAny := range pieces {
		piece, _ := asMap(pieceAny)
		where := getStr(piece, "id")
		if where == "" {
			where = getStr(piece, "name")
		}
		if where == "" {
			where = "<piece>"
		}
		fp, err := footprintOf(piece, where)
		if err != nil {
			return nil, err
		}
		rotation := numOr0(piece["rotation_degrees"])
		mirror := strOr(piece, "mirror", "none")
		pieceType := getStr(piece, "piece_type")
		if pieceType == "" {
			if getStr(piece, "parent_area_id") != "" {
				pieceType = "feature"
			} else {
				pieceType = "area"
			}
		}
		floor := numOr0(piece["floor"])

		if parentID := getStr(piece, "parent_area_id"); parentID != "" {
			parent, ok := areasByID[parentID]
			if !ok {
				return nil, &terrainError{where + ": unknown parent_area_id \"" + parentID + "\""}
			}
			areaLocal, err := placeFootprint(fp, posOf(piece), rotation, mirror)
			if err != nil {
				return nil, err
			}
			aRot := numOr0(parent["rotation_degrees"])
			aMirror := strOr(parent, "mirror", "none")
			ppos := posOf(parent)
			vertices := make([]any, len(areaLocal))
			for i, p := range areaLocal {
				o := orient(p, aRot, aMirror)
				vertices[i] = vec2JSON(round4(vec2{o.x + ppos.x, o.y + ppos.y}))
			}
			rec := idName(piece)
			rec["piece_type"] = pieceType
			rec["floor"] = floor
			rec["vertices"] = vertices
			out = append(out, rec)
			continue
		}

		placed, err := placeFootprint(fp, posOf(piece), rotation, mirror)
		if err != nil {
			return nil, err
		}
		vertices := make([]any, len(placed))
		for i, v := range placed {
			vertices[i] = vec2JSON(round4(v))
		}
		rec := idName(piece)
		rec["piece_type"] = pieceType
		rec["floor"] = floor
		rec["vertices"] = vertices
		out = append(out, rec)

		// Expand an area template's composed features.
		if tmpl := getStr(piece, "template"); tmpl != "" {
			t := byID[tmpl]
			ppos := posOf(piece)
			for _, featAny := range getList(t, "features") {
				feat, _ := asMap(featAny)
				ft, ok := byID[getStr(feat, "template")]
				if !ok {
					return nil, &terrainError{where + ": composed feature references unknown template \"" + getStr(feat, "template") + "\""}
				}
				ffp, _ := getMap(ft, "footprint")
				areaLocal, err := placeFootprint(ffp, posOf(feat), numOr0(feat["rotation_degrees"]), strOr(feat, "mirror", "none"))
				if err != nil {
					return nil, err
				}
				featVerts := make([]any, len(areaLocal))
				for i, p := range areaLocal {
					o := orient(p, rotation, mirror)
					featVerts[i] = vec2JSON(round4(vec2{o.x + ppos.x, o.y + ppos.y}))
				}
				out = append(out, map[string]any{
					"id":         feat["id"],
					"name":       ft["name"],
					"piece_type": "feature",
					"floor":      numOr0(feat["floor"]),
					"vertices":   featVerts,
				})
			}
		}
	}
	return out, nil
}

func axisOfEdge(edge string) string {
	if edge == "left" || edge == "right" {
		return "x"
	}
	return "y"
}

func refCoordinate(rp map[string]any, k map[string]any, where string) (float64, error) {
	axis := axisOfEdge(getStr(k, "edge"))
	ref, _ := getMap(k, "ref")
	vertices := getList(rp, "vertices")
	if getStr(ref, "kind") == "vertex" {
		index := asInt(ref["index"])
		if index < 0 || index >= len(vertices) {
			return 0, &terrainError{where + ": keystone vertex index out of range"}
		}
		v, _ := asMap(vertices[index])
		return numOr0(v[axis]), nil
	}
	side := getStr(ref, "side")
	sideAxis := "y"
	if side == "min-x" || side == "max-x" {
		sideAxis = "x"
	}
	if sideAxis != axis {
		return 0, &terrainError{where + ": face \"" + side + "\" cannot be measured from the " + getStr(k, "edge") + " edge (axis mismatch)"}
	}
	best := math.NaN()
	for _, vAny := range vertices {
		v, _ := asMap(vAny)
		val := numOr0(v[axis])
		if math.IsNaN(best) {
			best = val
		} else if side[:3] == "min" {
			best = math.Min(best, val)
		} else {
			best = math.Max(best, val)
		}
	}
	return best, nil
}

// keystoneMeasurements derives every keystone's printed distance for a layout.
func keystoneMeasurements(layout map[string]any, templates []any, board map[string]float64) ([]map[string]any, error) {
	if board == nil {
		board = boardInches
	}
	resolved, err := resolveLayout(layout, templates)
	if err != nil {
		return nil, err
	}
	byTemplate := map[string]map[string]any{}
	for _, tAny := range templates {
		t, _ := asMap(tAny)
		byTemplate[getStr(t, "id")] = t
	}
	pieces := getList(layout, "pieces")
	out := []map[string]any{}
	cursor := 0
	for i, pieceAny := range pieces {
		piece, _ := asMap(pieceAny)
		if cursor >= len(resolved) {
			return nil, &terrainError{"piece resolved emission shorter than layout.pieces"}
		}
		rp := resolved[cursor]
		cursor++
		if getStr(piece, "parent_area_id") == "" && getStr(piece, "template") != "" {
			template := byTemplate[getStr(piece, "template")]
			cursor += len(getList(template, "features"))
		}
		for _, kAny := range getList(piece, "keystones") {
			k, _ := asMap(kAny)
			where := "piece"
			c, err := refCoordinate(rp, k, where)
			if err != nil {
				return nil, err
			}
			edge := getStr(k, "edge")
			var extent float64
			if axisOfEdge(edge) == "x" {
				extent = board["width"]
			} else {
				extent = board["height"]
			}
			distance := c
			if edge != "left" && edge != "top" {
				distance = extent - c
			}
			out = append(out, map[string]any{
				"piece_index": i,
				"piece_id":    rp["id"],
				"edge":        edge,
				"ref":         k["ref"],
				"distance":    jsRound(distance*1e4) / 1e4,
			})
		}
	}
	return out, nil
}
