package wh40kdc

import (
	"fmt"
	"strings"
	"sync"
)

// Game-mode views of a Dataset. Every view shares one set of records, indexes
// and collections' lookup maps; a view differs only in which records its
// listings show. Go mirror of TS Dataset.forGameMode / Dataset.gameMode.

const (
	// defaultGameMode is the view EmbeddedDataset and NewDataset return, and
	// the mode a record without game_modes is legal in.
	defaultGameMode = "matched-play"
	// gameModeAll is the view that shows every record.
	gameModeAll = "all"
)

// gameModeViewIDs are the accepted ForGameMode arguments: the game-mode ids of
// schemas/$defs/common.schema.json#/$defs/game-mode-id, plus "all".
var gameModeViewIDs = []string{"matched-play", "combat-patrol", "boarding-actions", "crusade", gameModeAll}

// gameModeViews caches the per-mode views of one root ("all") Dataset.
type gameModeViews struct {
	mu     sync.Mutex
	byMode map[string]*Dataset
}

func newGameModeViews() *gameModeViews {
	return &gameModeViews{byMode: map[string]*Dataset{}}
}

// GameMode returns the view's game mode: a game-mode id or "all".
func (ds *Dataset) GameMode() string { return ds.gameMode }

// ForGameMode returns the view of the same records for mode, a game-mode id
// (matched-play, combat-patrol, boarding-actions, crusade) or "all". The view
// shares this Dataset's records and indexes; views are cached per mode, so
// repeated calls return the same *Dataset. Listings (All, Size, ByFaction,
// Find, FindAll on units, weapons, detachments, enhancements, stratagems and
// wargear options; UnitCompositions; the reverse unit/weapon listings) show
// only records legal in mode. Id lookups (Get, GetAny, GetInFaction, Has,
// ByExternalRef) and every other collection are unfiltered. An unknown mode
// is an error.
func (ds *Dataset) ForGameMode(mode string) (*Dataset, error) {
	if !contains(gameModeViewIDs, mode) {
		return nil, fmt.Errorf("unknown game mode %q (want one of %s)", mode, strings.Join(gameModeViewIDs, ", "))
	}
	return ds.root.viewFor(mode), nil
}

// allModes returns the "all" view, for internal consumers that must see every
// record whatever the caller's mode.
func (ds *Dataset) allModes() *Dataset { return ds.root }

// shows reports whether a record is visible in this view.
func (ds *Dataset) shows(record any) bool { return ds.visible == nil || ds.visible(record) }

// viewFor returns the cached view for a validated mode; root must be the "all"
// view.
func (root *Dataset) viewFor(mode string) *Dataset {
	if mode == gameModeAll {
		return root
	}
	root.views.mu.Lock()
	defer root.views.mu.Unlock()
	if v, ok := root.views.byMode[mode]; ok {
		return v
	}
	v := root.deriveView(mode)
	root.views.byMode[mode] = v
	return v
}

// deriveView builds the view for mode over root's records. The struct copy
// shares every index, list and unfiltered collection; the filtered collections
// are rebuilt as views over the same records, and the linked-view collections
// rewrap so a record reached from this view links back into it.
func (root *Dataset) deriveView(mode string) *Dataset {
	v := *root
	ds := &v
	visible := gameModeVisible(mode)
	ds.gameMode = mode
	ds.visible = visible

	ds.Units = root.Units.view(func(i any) *UnitView {
		return &UnitView{Raw: i.(map[string]any), ds: ds}
	}, visible)
	ds.Weapons = root.Weapons.view(func(i any) *WeaponView {
		return &WeaponView{Raw: i.(map[string]any), ds: ds}
	}, visible)
	ds.WeaponKeywords = root.WeaponKeywords.view(func(i any) *WeaponKeywordView {
		return &WeaponKeywordView{Raw: i.(map[string]any), ds: ds}
	}, nil)
	ds.Factions = root.Factions.view(func(i any) *FactionView {
		return &FactionView{Raw: i.(map[string]any), ds: ds}
	}, nil)
	ds.Abilities = root.Abilities.view(func(i any) *AbilityView {
		return &AbilityView{Raw: i.(map[string]any), ds: ds}
	}, nil)

	ds.Detachments = root.Detachments.view(nil, visible)
	ds.Enhancements = root.Enhancements.view(nil, visible)
	ds.Stratagems = root.Stratagems.view(nil, visible)
	ds.WargearOptions = root.WargearOptions.view(nil, visible)

	ds.UnitCompositions = make([]any, 0, len(root.allUnitCompositions))
	for _, c := range root.allUnitCompositions {
		if visible(c) {
			ds.UnitCompositions = append(ds.UnitCompositions, c)
		}
	}
	return ds
}

// gameModeVisible returns the visibility predicate for a single game mode: a
// record is visible when its effective modes include mode. The effective modes
// are its game_modes, or ["matched-play"] when game_modes is absent or empty.
func gameModeVisible(mode string) func(any) bool {
	return func(item any) bool {
		record, ok := item.(map[string]any)
		if !ok {
			return mode == defaultGameMode
		}
		modes := getStrList(record, "game_modes")
		if len(modes) == 0 {
			return mode == defaultGameMode
		}
		return contains(modes, mode)
	}
}
