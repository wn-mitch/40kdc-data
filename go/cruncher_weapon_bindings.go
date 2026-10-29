package wh40kdc

// A select-weapon step that names the weapon it binds (weapons.name) is resolved before
// translation: every later weapons.ref naming its bind_as variable, in the same sequence or nested
// under it, takes the selection's weapon scope, and the selection step is dropped. A model holds
// one weapon of a name in nearly every loadout, so the named scope is the selected weapon. A
// selection that does not name its weapon is the player's choice among several and stays bound.

// namedWeaponBinding returns the weapon scope a selection binds by name, or ok=false when it does
// not name its weapon.
func namedWeaponBinding(step any) (string, map[string]any, bool) {
	node, isMap := step.(map[string]any)
	if !isMap || node["type"] != "select-weapon" {
		return "", nil, false
	}
	modifier, isMap := node["modifier"].(map[string]any)
	if !isMap {
		return "", nil, false
	}
	variable, isString := modifier["bind_as"].(string)
	scope, isScope := modifier["weapons"].(map[string]any)
	if !isString || !isScope {
		return "", nil, false
	}
	if _, named := scope["name"].(string); !named {
		return "", nil, false
	}
	if _, hasRef := scope["ref"]; hasRef {
		return "", nil, false
	}
	return variable, scope, true
}

// substitutedWeaponScope replaces a weapons.ref naming a bound variable by the bound scope,
// keeping the scope's other fields.
func substitutedWeaponScope(scope map[string]any, bindings map[string]map[string]any) (map[string]any, bool) {
	ref, isMap := scope["ref"].(map[string]any)
	if !isMap || len(ref) != 1 {
		return nil, false
	}
	variable, isString := ref["weapon_var"].(string)
	if !isString {
		return nil, false
	}
	bound, found := bindings[variable]
	if !found {
		return nil, false
	}
	out := map[string]any{}
	for key, value := range scope {
		if key != "ref" {
			out[key] = value
		}
	}
	for key, value := range bound {
		out[key] = value
	}
	return out, true
}

func resolveWeaponBindings(node any, bindings map[string]map[string]any) any {
	switch value := node.(type) {
	case []any:
		out := make([]any, len(value))
		for index, child := range value {
			out[index] = resolveWeaponBindings(child, bindings)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(value))
		for key, child := range value {
			steps, isSteps := child.([]any)
			scope, isScope := child.(map[string]any)
			switch {
			case key == "steps" && value["type"] == "sequence" && isSteps:
				local := make(map[string]map[string]any, len(bindings))
				for name, bound := range bindings {
					local[name] = bound
				}
				kept := []any{}
				for _, step := range steps {
					if variable, bound, ok := namedWeaponBinding(step); ok {
						local[variable] = bound
					} else {
						kept = append(kept, resolveWeaponBindings(step, local))
					}
				}
				out[key] = kept
			case key == "weapons" && isScope:
				if replaced, ok := substitutedWeaponScope(scope, bindings); ok {
					out[key] = replaced
				} else {
					out[key] = resolveWeaponBindings(scope, bindings)
				}
			default:
				out[key] = resolveWeaponBindings(child, bindings)
			}
		}
		return out
	default:
		return node
	}
}

// resolveNamedWeaponBindings returns the effect with each weapon a selection binds by name written
// into the scopes that refer to it.
func resolveNamedWeaponBindings(effect any) any {
	return resolveWeaponBindings(effect, map[string]map[string]any{})
}
