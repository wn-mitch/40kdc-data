//! One unit's wargear legality at any model count, behind one interface: its
//! MFM loadout rules (unit-composition `loadout`) where the dump provides them,
//! else the authored wargear options. [`Dataset::loadout_of`] hands these out.
//!
//! Port of `tools/src/data/unit-loadout.ts`. Under MFM rules a unit's model
//! count can split across its loadout rows more than one way when its tiers
//! allow it ([`mfm_row_splits`]); a loadout is legal when it is legal on any
//! split. Defaults, the maximal loadout and candidates use the bulk split
//! ([`mfm_rows`]).

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use super::dataset::Dataset;
use super::loadout::{
    base_loadout, check_unit_legality, complete_loadout, group_loadout, loadout_candidates,
    loadout_models, loadout_tiers, maximal_loadout, weapon_bounds, CompletedLoadout, LoadoutGroup,
    LoadoutModel, LoadoutTier, Violation, WeaponBound, LOADOUT_CANDIDATES_DEFAULT_LIMIT,
};
use super::mfm_loadout::{mfm_unit_candidates, MfmComposition, MfmSearchTooLarge};
use crate::{Unit, UnitComposition, WargearOption};

/// Which rules decide a unit's wargear.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadoutSource {
    /// The unit's MFM loadout rules.
    Mfm,
    /// The unit's authored wargear options.
    WargearOptions,
}

type Splits = Arc<Vec<BTreeMap<String, i64>>>;
type Bounds = Result<Option<BTreeMap<String, WeaponBound>>, MfmSearchTooLarge>;

/// A unit's wargear legality at a model count. Counts are copies across the whole unit.
pub struct UnitLoadout {
    unit_id: String,
    inner: Inner,
}

enum Inner {
    Mfm(MfmView),
    Options(OptionsView),
}

#[path = "unit_loadout_mfm.rs"]
mod mfm;
pub use mfm::{mfm_group_row_order, mfm_groups};
use mfm::{signed, MfmView};

struct OptionsView {
    unit: Unit,
    options: Vec<WargearOption>,
    models: Option<Vec<LoadoutModel>>,
    tiers: Option<Vec<LoadoutTier>>,
    /// Each recorded squad size's total model range; empty without a composition.
    sizes: Vec<(u64, u64)>,
}

/// The view for `unit` with its faction-scoped `composition` and `options`.
pub fn unit_loadout(
    unit: &Unit,
    composition: Option<&UnitComposition>,
    options: &[&WargearOption],
) -> UnitLoadout {
    let unit_id = unit.id.as_str().to_string();
    if let Some(composition) = composition.filter(|c| c.loadout.is_some()) {
        let composition = MfmComposition::from_composition(composition);
        return UnitLoadout {
            unit_id,
            inner: Inner::Mfm(MfmView::new(composition)),
        };
    }
    let models = composition.map(|c| loadout_models(&c.models));
    let tiers = composition.map(|c| loadout_tiers(&c.tiers));
    let sizes = match (&tiers, &models) {
        (Some(tiers), _) if !tiers.is_empty() => tiers
            .iter()
            .map(|tier| {
                let min = tier.models.iter().map(|m| m.min).sum();
                (min, tier.models.iter().map(|m| m.max).sum())
            })
            .collect(),
        (_, Some(models)) => vec![(
            models.iter().map(|m| m.min).sum(),
            models.iter().map(|m| m.max).sum(),
        )],
        _ => Vec::new(),
    };
    UnitLoadout {
        unit_id,
        inner: Inner::Options(OptionsView {
            unit: unit.clone(),
            options: options.iter().map(|o| (*o).clone()).collect(),
            models,
            tiers,
            sizes,
        }),
    }
}

impl OptionsView {
    fn options(&self) -> Vec<&WargearOption> {
        self.options.iter().collect()
    }

    /// A unit without a composition has no recorded sizes; any count is taken as given.
    fn buildable(&self, model_count: u64) -> bool {
        self.sizes.is_empty()
            || self
                .sizes
                .iter()
                .any(|(min, max)| (*min..=*max).contains(&model_count))
    }
}

impl UnitLoadout {
    /// Which rules decide this unit's wargear.
    pub fn source(&self) -> LoadoutSource {
        match self.inner {
            Inner::Mfm(_) => LoadoutSource::Mfm,
            Inner::Options(_) => LoadoutSource::WargearOptions,
        }
    }

    /// The out-of-the-box loadout. None when no squad size has `model_count`
    /// models. Under MFM rules a few dump defaults break their own rules;
    /// [`check`](Self::check) reports those.
    pub fn base(&self, model_count: u64) -> Option<BTreeMap<String, i64>> {
        match &self.inner {
            Inner::Mfm(view) => view.base(model_count),
            Inner::Options(view) => view.buildable(model_count).then(|| {
                base_loadout(
                    &view.unit,
                    model_count,
                    &view.options(),
                    view.models.as_deref(),
                )
                .counts
            }),
        }
    }

    /// Each item's fewest and most copies on any legal loadout; None when the size cannot be built.
    pub fn bounds(&self, model_count: u64) -> Bounds {
        match &self.inner {
            Inner::Mfm(view) => view.bounds(model_count),
            Inner::Options(view) => Ok(view.buildable(model_count).then(|| {
                weapon_bounds(
                    &view.unit,
                    model_count,
                    &view.options(),
                    view.models.as_deref(),
                )
            })),
        }
    }

    /// The legal loadout that adds the most copies over [`base`](Self::base)
    /// (Σ max(0, count − base)); ties go to the first in search order. None when
    /// the size has no legal loadout.
    pub fn maximal(
        &self,
        model_count: u64,
    ) -> Result<Option<BTreeMap<String, i64>>, MfmSearchTooLarge> {
        match &self.inner {
            Inner::Mfm(view) => view.maximal(model_count),
            Inner::Options(view) => Ok(view.buildable(model_count).then(|| {
                maximal_loadout(
                    &view.unit,
                    model_count,
                    &view.options(),
                    view.models.as_deref(),
                )
                .counts
            })),
        }
    }

    /// Violations of `counts` on a unit of `model_count` models, by id then code; empty when legal.
    pub fn check(
        &self,
        model_count: u64,
        counts: &HashMap<String, i64>,
    ) -> Result<Vec<Violation>, MfmSearchTooLarge> {
        match &self.inner {
            Inner::Mfm(view) => view.check(&self.unit_id, model_count, counts),
            Inner::Options(view) => Ok(check_unit_legality(
                &view.unit,
                model_count,
                &view.options(),
                counts,
                view.models.as_deref(),
                view.tiers.as_deref(),
            )),
        }
    }

    /// How `counts` sit on the models; None for one model, or when no legal assignment exists.
    pub fn groups(
        &self,
        model_count: u64,
        counts: &BTreeMap<String, i64>,
    ) -> Result<Option<Vec<LoadoutGroup>>, MfmSearchTooLarge> {
        match &self.inner {
            Inner::Mfm(view) => view.groups(model_count, counts),
            Inner::Options(view) => Ok(group_loadout(
                &view.unit,
                model_count,
                &view.options(),
                view.models.as_deref(),
                counts,
            )),
        }
    }

    /// A legal loadout holding at least `explicit`'s copies of each item and
    /// nothing beyond the greater of `explicit` and the default: a sparse source
    /// list with its implied defaults filled in. None when no such loadout exists.
    pub fn complete(
        &self,
        model_count: u64,
        explicit: &BTreeMap<String, i64>,
    ) -> Result<Option<CompletedLoadout>, MfmSearchTooLarge> {
        match &self.inner {
            Inner::Mfm(view) => view.complete(model_count, explicit),
            Inner::Options(view) => Ok(complete_loadout(
                &view.unit,
                model_count,
                &view.options(),
                view.models.as_deref(),
                explicit,
            )),
        }
    }

    /// Legal loadouts as encoded candidate strings, up to `limit` (default
    /// [`LOADOUT_CANDIDATES_DEFAULT_LIMIT`]), then a truncation marker.
    pub fn candidates(
        &self,
        model_count: u64,
        limit: Option<usize>,
    ) -> Result<Vec<String>, MfmSearchTooLarge> {
        match &self.inner {
            Inner::Mfm(view) => mfm_unit_candidates(
                &view.composition,
                signed(model_count),
                limit.unwrap_or(LOADOUT_CANDIDATES_DEFAULT_LIMIT),
            ),
            Inner::Options(view) => Ok(loadout_candidates(
                &view.unit,
                model_count,
                &view.options(),
                view.models.as_deref(),
                view.tiers.as_deref(),
                limit,
            )),
        }
    }
}

impl Dataset {
    /// The unit's wargear legality at any model count: its MFM loadout rules
    /// where the dump has them, else its authored wargear options (see
    /// [`UnitLoadout`]). Faction-scoped like
    /// [`unit_composition_of`](Dataset::unit_composition_of); one view per unit,
    /// kept for the dataset's life and shared by its game-mode views.
    pub fn loadout_of(&self, unit: &Unit) -> Arc<UnitLoadout> {
        let key = format!("{}::{}", unit.faction_id.as_str(), unit.id.as_str());
        if let Some(view) = self.loadouts.lock().expect("loadout views").get(&key) {
            return Arc::clone(view);
        }
        let view = Arc::new(unit_loadout(
            unit,
            self.unit_composition_of(unit),
            &self.wargear_options_of(unit),
        ));
        Arc::clone(
            self.loadouts
                .lock()
                .expect("loadout views")
                .entry(key)
                .or_insert(view),
        )
    }
}
