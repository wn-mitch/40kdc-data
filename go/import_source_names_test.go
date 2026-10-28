package wh40kdc

import (
	"strings"
	"testing"
)

const sourceAliasList = `+++++++++++++++++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: FACTION
+ TOTAL ARMY POINTS: 130pts
+
+ NUMBER OF UNITS: 1
+++++++++++++++++++++++++++++++++++++++++++++++

UNIT (130 pts)
• 5x Astartes chainsword
`

func importedChainsword(t *testing.T, faction, unit string) (string, string) {
	t.Helper()
	text := strings.NewReplacer("FACTION", faction, "UNIT", unit).Replace(sourceAliasList)
	result := tryImportRoster(text, EmbeddedDataset())
	if result["ok"] != true {
		t.Fatalf("import failed: %v %v", result["reason"], result["message"])
	}
	roster, _ := asMap(result["roster"])
	units := getList(roster, "units")
	if len(units) != 1 {
		t.Fatalf("units = %d", len(units))
	}
	u, _ := asMap(units[0])
	unitRef, _ := asMap(u["ref"])
	for _, wAny := range getList(u, "wargear") {
		w, _ := asMap(wAny)
		ref, _ := asMap(w["ref"])
		if ref["raw_name"] == "Astartes chainsword" {
			return getStr(unitRef, "id"), getStr(ref, "id")
		}
	}
	t.Fatalf("no Astartes chainsword wargear line")
	return "", ""
}

// A unit whose own weapon is named "Chainsword" takes the source-name alias.
func TestAstartesChainswordAliasesToUnitsChainsword(t *testing.T) {
	unitID, weaponID := importedChainsword(t, "Imperium - Adeptus Astartes", "Death Company Marines with Jump Packs")
	if unitID != "death-company-marines-with-jump-packs" || weaponID != "chainsword" {
		t.Fatalf("got unit %q weapon %q, want chainsword", unitID, weaponID)
	}
}

// A unit fielding a weapon printed as "Astartes chainsword" keeps it, because
// the printed name is tried before the alias.
func TestAstartesChainswordKeepsPrintedWeapon(t *testing.T) {
	unitID, weaponID := importedChainsword(t, "Chaos Space Marines", "Raptors")
	if unitID != "raptors" || weaponID != "astartes-chainsword" {
		t.Fatalf("got unit %q weapon %q, want astartes-chainsword", unitID, weaponID)
	}
}
