//! Game-mode views over the [`Dataset`].
//!
//! Army-construction records (units, weapons, detachments, enhancements,
//! stratagems, wargear options, unit compositions) carry an optional
//! `game_modes` array; an absent or empty array means matched-play only. A
//! [`Dataset`] is a view with one [`GameModeView`]: its *listings* (`all`,
//! `iter`, `len`, `by_faction`, `find`, `find_all`, the plain
//! `unit_compositions` vector, and the reverse listings such as
//! [`units_with_keyword`](Dataset::units_with_keyword)) show only the records
//! that mode includes, while its *id lookups* (`get`, `get_any`,
//! `get_in_faction`, `has`, `by_external_ref`, and the per-unit lookups such as
//! [`unit_composition_of`](Dataset::unit_composition_of)) resolve every record,
//! so share tokens, saved rosters and internal references keep resolving
//! content from other modes. Every other collection is unfiltered.
//!
//! [`Dataset::embedded`] and [`Dataset::from_raw`] are the matched-play view.
//! [`Dataset::for_game_mode`] returns another view over the same record
//! stores and indexes (shared through `Arc`). Listings hand out slices, so
//! each scoped collection materialises the records a mode lists once per mode
//! and shares that copy across views; a dataset caches each view it hands out.
//! Mirror of the TS `Dataset.forGameMode` (`tools/src/data/dataset.ts`).

use std::fmt;
use std::str::FromStr;
use std::sync::{Arc, OnceLock};

use crate::generated::{
    Detachment, Enhancement, GameModeId, GameModes, Stratagem, Unit, UnitComposition,
    WargearOption, Weapon,
};

use super::dataset::Dataset;

/// The game mode a [`Dataset`] view lists: one game mode, or every mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GameModeView {
    /// Every record, whatever its `game_modes`.
    All,
    /// Records whose effective game modes include this mode.
    Mode(GameModeId),
}

impl GameModeView {
    /// The default view: matched play.
    pub const MATCHED_PLAY: GameModeView = GameModeView::Mode(GameModeId::MatchedPlay);
}

impl Default for GameModeView {
    fn default() -> Self {
        Self::MATCHED_PLAY
    }
}

impl From<GameModeId> for GameModeView {
    fn from(mode: GameModeId) -> Self {
        Self::Mode(mode)
    }
}

impl fmt::Display for GameModeView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::All => f.write_str("all"),
            Self::Mode(mode) => mode.fmt(f),
        }
    }
}

/// A game-mode string that is neither a game-mode id nor `"all"`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnknownGameMode(pub String);

impl fmt::Display for UnknownGameMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "unknown game mode \"{}\" (expected matched-play, combat-patrol, \
             boarding-actions, crusade, or all)",
            self.0
        )
    }
}

impl std::error::Error for UnknownGameMode {}

impl FromStr for GameModeView {
    type Err = UnknownGameMode;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value == "all" {
            return Ok(Self::All);
        }
        value
            .parse::<GameModeId>()
            .map(Self::Mode)
            .map_err(|_| UnknownGameMode(value.to_string()))
    }
}

/// Reads a record's optional `game_modes` array (stored once per collection).
pub(super) type ModesOf<T> = fn(&T) -> Option<&GameModes>;

/// Whether a record with these `game_modes` is listed in `view`. An absent or
/// empty array means matched-play only.
pub(super) fn in_game_mode(modes: Option<&GameModes>, view: GameModeView) -> bool {
    match view {
        GameModeView::All => true,
        GameModeView::Mode(mode) => match modes {
            Some(list) if !list.0.is_empty() => list.0.contains(&mode),
            _ => mode == GameModeId::MatchedPlay,
        },
    }
}

/// The records one game-mode view of a collection lists: their positions in
/// the full store, plus a materialised copy so listings can hand out a slice.
pub(super) struct Listed<T> {
    pub(super) indices: Vec<usize>,
    pub(super) items: Vec<T>,
}

/// Per-collection game-mode scoping: how to read a record's modes, plus each
/// mode's listed records, materialised once on first use.
pub(super) struct ModeScope<T> {
    modes_of: Option<ModesOf<T>>,
    /// Per mode: `None` when the mode hides nothing (listings use the full store).
    listed: [OnceLock<Option<Arc<Listed<T>>>>; 4],
}

impl<T> ModeScope<T> {
    /// A scope that lists every record in every mode.
    pub(super) fn unscoped() -> Self {
        Self {
            modes_of: None,
            listed: Default::default(),
        }
    }

    /// A scope reading each record's modes with `modes_of`.
    pub(super) fn scoped(modes_of: ModesOf<T>) -> Self {
        Self {
            modes_of: Some(modes_of),
            listed: Default::default(),
        }
    }

    /// Whether `item` is listed in `view`.
    pub(super) fn lists(&self, item: &T, view: GameModeView) -> bool {
        match self.modes_of {
            Some(modes_of) => in_game_mode(modes_of(item), view),
            None => true,
        }
    }

    /// The records of `items` listed in `view`, or `None` when every item is
    /// (unscoped collection, the "all" view, or a mode that hides nothing).
    /// Computed and cloned once per mode, then shared by every view.
    pub(super) fn listed(&self, items: &[T], view: GameModeView) -> Option<Arc<Listed<T>>>
    where
        T: Clone,
    {
        let GameModeView::Mode(mode) = view else {
            return None;
        };
        self.modes_of?;
        self.listed[mode_slot(mode)]
            .get_or_init(|| {
                let indices: Vec<usize> = (0..items.len())
                    .filter(|&i| self.lists(&items[i], view))
                    .collect();
                if indices.len() == items.len() {
                    return None;
                }
                let items = indices.iter().map(|&i| items[i].clone()).collect();
                Some(Arc::new(Listed { indices, items }))
            })
            .clone()
    }
}

fn mode_slot(mode: GameModeId) -> usize {
    match mode {
        GameModeId::MatchedPlay => 0,
        GameModeId::CombatPatrol => 1,
        GameModeId::BoardingActions => 2,
        GameModeId::Crusade => 3,
    }
}

// Field readers for the game-mode-scoped record types.
pub(super) fn unit_modes(r: &Unit) -> Option<&GameModes> {
    r.game_modes.as_ref()
}
pub(super) fn weapon_modes(r: &Weapon) -> Option<&GameModes> {
    r.game_modes.as_ref()
}
pub(super) fn detachment_modes(r: &Detachment) -> Option<&GameModes> {
    r.game_modes.as_ref()
}
pub(super) fn enhancement_modes(r: &Enhancement) -> Option<&GameModes> {
    r.game_modes.as_ref()
}
pub(super) fn stratagem_modes(r: &Stratagem) -> Option<&GameModes> {
    r.game_modes.as_ref()
}
pub(super) fn wargear_option_modes(r: &WargearOption) -> Option<&GameModes> {
    r.game_modes.as_ref()
}

/// One cached view per [`GameModeView`], owned by the dataset it was taken
/// from (so no reference cycle): matched-play, combat-patrol,
/// boarding-actions, crusade, all.
#[derive(Clone, Default)]
pub(super) struct ViewCache([OnceLock<Box<Dataset>>; 5]);

fn view_slot(view: GameModeView) -> usize {
    match view {
        GameModeView::Mode(mode) => mode_slot(mode),
        GameModeView::All => 4,
    }
}

impl Dataset {
    /// The game mode this view lists.
    pub fn game_mode(&self) -> GameModeView {
        self.game_mode
    }

    /// This dataset viewed in another game mode, parsed from its id
    /// (`"matched-play"`, `"combat-patrol"`, `"boarding-actions"`, `"crusade"`)
    /// or `"all"`. Errors on an unknown mode string. See
    /// [`with_game_mode`](Self::with_game_mode).
    pub fn for_game_mode(&self, mode: &str) -> Result<&Dataset, UnknownGameMode> {
        Ok(self.with_game_mode(mode.parse()?))
    }

    /// This dataset viewed in `view`. The view shares every record store and
    /// index with `self`; each collection materialises its listed records
    /// once per mode. Views are built on first use and cached on `self`, so
    /// repeated calls return the same view (and `self` for its own mode).
    pub fn with_game_mode(&self, view: GameModeView) -> &Dataset {
        if view == self.game_mode {
            return self;
        }
        self.views.0[view_slot(view)].get_or_init(|| Box::new(self.build_view(view)))
    }

    /// Build (uncached) the `view` of this dataset.
    pub(super) fn build_view(&self, view: GameModeView) -> Dataset {
        Dataset {
            game_mode: view,
            units: self.units.with_game_mode(view),
            weapons: self.weapons.with_game_mode(view),
            weapon_keywords: self.weapon_keywords.clone(),
            factions: self.factions.clone(),
            unit_keywords: self.unit_keywords.clone(),
            abilities: self.abilities.clone(),
            target_profiles: self.target_profiles.clone(),
            detachments: self.detachments.with_game_mode(view),
            allied_rules: self.allied_rules.clone(),
            enhancements: self.enhancements.with_game_mode(view),
            stratagems: self.stratagems.with_game_mode(view),
            wargear_options: self.wargear_options.with_game_mode(view),
            wargear: self.wargear.clone(),
            missions: self.missions.clone(),
            mission_matchups: self.mission_matchups.clone(),
            mission_cards: self.mission_cards.clone(),
            deployment_patterns: self.deployment_patterns.clone(),
            force_dispositions: self.force_dispositions.clone(),
            terrain_templates: self.terrain_templates.clone(),
            terrain_layouts: self.terrain_layouts.clone(),
            hull_shapes: self.hull_shapes.clone(),
            resource_pools: self.resource_pools.clone(),
            leader_attachments: self.leader_attachments.clone(),
            unit_compositions: self
                .every_unit_composition
                .iter()
                .filter(|c| in_game_mode(c.game_modes.as_ref(), view))
                .cloned()
                .collect(),
            game_versions: self.game_versions.clone(),
            interaction_flags: self.interaction_flags.clone(),
            phase_mappings: self.phase_mappings.clone(),
            every_unit_composition: Arc::clone(&self.every_unit_composition),
            phase_index: Arc::clone(&self.phase_index),
            units_by_ability: Arc::clone(&self.units_by_ability),
            units_by_weapon: Arc::clone(&self.units_by_weapon),
            units_by_keyword: Arc::clone(&self.units_by_keyword),
            wargear_options_by_unit: Arc::clone(&self.wargear_options_by_unit),
            views: ViewCache::default(),
        }
    }

    /// The unit's composition (models and tiers), scoped to the unit's own
    /// faction. A lookup, so it resolves in every view regardless of the
    /// composition's `game_modes`. Mirror of TS `Dataset.unitCompositionOf`.
    pub fn unit_composition_of(&self, unit: &Unit) -> Option<&UnitComposition> {
        self.every_unit_composition.iter().find(|c| {
            c.unit_id.as_str() == unit.id.as_str()
                && c.faction_id.as_str() == unit.faction_id.as_str()
        })
    }
}

#[cfg(test)]
#[path = "game_mode_tests.rs"]
mod tests;
