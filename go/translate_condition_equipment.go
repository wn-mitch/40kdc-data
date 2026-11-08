package wh40kdc

// Go mirror of tools/src/translate/condition-equipment.ts: English for the named-equipment
// predicates (named-weapon, unit-wargear). Negation is written here rather than through
// negatePhrase, because a printed weapon name may contain " is " or " has ".

// namedEquipmentPhrase returns the English for one named-equipment predicate, negated when negated.
func namedEquipmentPhrase(t string, p map[string]any, negated bool) string {
	if t == "unit-wargear" {
		return wargearEquipmentPhrase(p, negated)
	}
	return weaponEquipmentPhrase(p, negated)
}

func wargearEquipmentPhrase(p map[string]any, negated bool) string {
	label := titleCase(cstr(p["wargear"]))
	models, ok := p["models"].(map[string]any)
	if !ok {
		verb := "has"
		if negated {
			verb = "does not have"
		}
		return "this unit " + verb + " the " + label + " wargear"
	}
	verb := "are equipped with"
	if cstr(models["state"]) == "lack" {
		verb = "are not equipped with"
	}
	return equipmentUnitLevel(equipmentModelsSubject(models)+" "+verb+" the "+label+" wargear", negated)
}

func weaponEquipmentPhrase(p map[string]any, negated bool) string {
	name := cstr(p["name"])
	count := cstr(p["count"])
	one := false
	if n, ok := p["count"].(float64); ok && n == 1 {
		one = true
	}
	weapons := "exactly " + count + " weapons named \"" + name + "\""
	if one {
		weapons = "one weapon named \"" + name + "\""
	}
	if cstr(p["subject"]) == "this-model" {
		verb := "is"
		if negated {
			verb = "is not"
		}
		return "this model " + verb + " equipped with " + weapons
	}
	models, _ := p["models"].(map[string]any)
	if cstr(models["state"]) == "lack" {
		none := "fewer than " + count + " weapons named \"" + name + "\""
		if one {
			none = "no weapon named \"" + name + "\""
		}
		return equipmentUnitLevel(equipmentModelsSubject(models)+" have "+none, negated)
	}
	return equipmentUnitLevel(equipmentModelsSubject(models)+" are each equipped with "+weapons, negated)
}

func equipmentModelsSubject(models map[string]any) string {
	count := mapOr(models["count"])
	if count["max"] == nil {
		if jsNumber(count["min"]) == 1 {
			return "one or more models in this unit"
		}
		return "at least " + cstr(count["min"]) + " models in this unit"
	}
	return controlCountPhrase(count) + " models in this unit"
}

func equipmentUnitLevel(phrase string, negated bool) string {
	if negated {
		return "it is not the case that " + phrase
	}
	return phrase
}
