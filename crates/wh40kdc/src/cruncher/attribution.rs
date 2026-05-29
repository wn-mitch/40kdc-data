//! Per-stage buff attribution by leave-one-out (LOO) recompute.
//!
//! Mirrors `tools/src/cruncher/attribution.ts`. The engine is closed-form, so
//! the honest way to answer "how much did this buff lift this stage?" is to
//! re-run [`crunch`] with that buff removed and diff the stage value. LOO is
//! exactly correct through every non-linearity the pipeline has — the ±1
//! hit/wound caps, the wound-threshold table, save clamps, FNP, the
//! models-killed cap — and it respects the resolver's non-additive rules for
//! free: a buff that grants a keyword the weapon already carries is deduped
//! inside [`resolve_buffs`](super::buffs::resolve_buffs), so its LOO delta
//! comes out ≈ 0 rather than double-counting.
//!
//! Only *toggleable* buffs are attributed — abilities (army / detachment /
//! stratagem / unit / attached / support) and manual UI toggles. The weapon's
//! intrinsic keywords are auto-injected inside [`crunch`], are not levers,
//! and are never removed; they're reported by id in
//! [`AttributedStage::intrinsics`].

use super::buffs::BuffSource;
use super::engine::{crunch, CruncherError, EngineInput, EngineOutput, StageName};
use crate::data::Dataset;

/// One toggleable buff group's marginal effect on a single stage.
#[derive(Clone, Debug)]
pub struct StageLift {
    /// Representative source of the group (all its buffs share a group key).
    pub source: BuffSource,
    /// `stageValue(all buffs) − stageValue(all buffs minus this group)`.
    pub delta: f64,
}

/// A pipeline stage with its value decomposed across the toggleable buffs.
#[derive(Clone, Debug)]
pub struct AttributedStage {
    pub name: StageName,
    /// Stage value with every buff on — identical to [`crunch`]'s stage.
    pub expected: f64,
    pub detail: String,
    /// Stage value with all groupable buffs removed (intrinsics kept).
    pub baseline: f64,
    /// Per-group marginal effect; groups whose `|delta| ≤ epsilon` are dropped.
    pub lifts: Vec<StageLift>,
    /// `expected − baseline − Σ lifts`. Non-zero when buffs collide under a
    /// cap (two +1s sharing one ±1 cap each show ≈0 lift; the real +1 lands
    /// here), so a UI can surface it honestly as "overlap (capped)".
    pub residual: f64,
    /// Active weapon-keyword ids (intrinsic, auto-injected); display-only.
    pub intrinsics: Vec<String>,
}

const DEFAULT_EPSILON: f64 = 1e-6;

fn is_groupable(source: &BuffSource) -> bool {
    matches!(source, BuffSource::Ability { .. } | BuffSource::Manual { .. })
}

/// Stable grouping key. Every buff a single UI toggle flatMaps to shares one
/// key, so a LOO pass removes the whole toggle, never a fragment of it.
fn group_key(source: &BuffSource) -> String {
    match source {
        BuffSource::Ability {
            ability_id,
            source_unit_id,
            ..
        } => format!(
            "a:{}:{}",
            ability_id,
            source_unit_id.as_deref().unwrap_or("")
        ),
        BuffSource::Manual { label } => format!("m:{label}"),
        BuffSource::WeaponKeyword {
            weapon_id,
            keyword_id,
        } => format!("w:{weapon_id}:{keyword_id}"),
    }
}

/// Decompose each pipeline stage of `crunch(input)` into the marginal lift of
/// every toggleable buff group, via leave-one-out recompute.
///
/// Cost is `groups + 2` [`crunch`] calls (full + baseline + one per group);
/// the engine is closed-form, so this is cheap to call per weapon line.
///
/// `epsilon` defaults to `1e-6`; lifts and residuals whose magnitude is at
/// or below it are treated as zero.
pub fn attribute_stages(
    input: &EngineInput,
    dataset: Option<&Dataset>,
    epsilon: Option<f64>,
) -> Result<Vec<AttributedStage>, CruncherError> {
    let eps = epsilon.unwrap_or(DEFAULT_EPSILON);
    let full = crunch(input, dataset)?;

    // First-seen order of groupable buff groups, with a representative source.
    let mut order: Vec<String> = Vec::new();
    let mut rep_source: std::collections::HashMap<String, BuffSource> =
        std::collections::HashMap::new();
    for b in &input.buffs {
        if !is_groupable(&b.source) {
            continue;
        }
        let key = group_key(&b.source);
        if !rep_source.contains_key(&key) {
            rep_source.insert(key.clone(), b.source.clone());
            order.push(key);
        }
    }

    // Baseline keeps only non-groupable buffs.
    let baseline_input = EngineInput {
        attacker: input.attacker,
        target: input.target,
        models_firing: input.models_firing,
        context: input.context.clone(),
        buffs: input
            .buffs
            .iter()
            .filter(|b| !is_groupable(&b.source))
            .cloned()
            .collect(),
    };
    let baseline = crunch(&baseline_input, dataset)?;

    // Leave-one-out: drop one whole group, keep the rest.
    let mut loo: std::collections::HashMap<String, EngineOutput> =
        std::collections::HashMap::new();
    for key in &order {
        let without_input = EngineInput {
            attacker: input.attacker,
            target: input.target,
            models_firing: input.models_firing,
            context: input.context.clone(),
            buffs: input
                .buffs
                .iter()
                .filter(|b| !is_groupable(&b.source) || &group_key(&b.source) != key)
                .cloned()
                .collect(),
        };
        loo.insert(key.clone(), crunch(&without_input, dataset)?);
    }

    let intrinsics: Vec<String> = full
        .resolved
        .extra_keywords
        .iter()
        .map(|e| e.keyword_ref.keyword_id.clone())
        .collect();

    let out: Vec<AttributedStage> = full
        .stages
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let expected = s.expected;
            let base_expected = baseline.stages[i].expected;
            let mut total_lift = 0.0;
            let mut lifts: Vec<StageLift> = Vec::new();
            for key in &order {
                let delta = expected - loo[key].stages[i].expected;
                total_lift += delta;
                if delta.abs() > eps {
                    lifts.push(StageLift {
                        source: rep_source[key].clone(),
                        delta,
                    });
                }
            }
            let residual_raw = expected - base_expected - total_lift;
            AttributedStage {
                name: s.name,
                expected,
                detail: s.detail.clone(),
                baseline: base_expected,
                lifts,
                residual: if residual_raw.abs() > eps {
                    residual_raw
                } else {
                    0.0
                },
                intrinsics: intrinsics.clone(),
            }
        })
        .collect();
    Ok(out)
}
