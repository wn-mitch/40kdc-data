//! Unit tests for the discrete allocation stage.
use serde_json::{json, Value};

use super::*;
use crate::cruncher::engine::RollProbabilities;

/// An attack model that always hits, wounds and goes unsaved.
fn model() -> AttackModel {
    AttackModel {
        models_firing: 1,
        attacks_stat: json!(1),
        attacks_reroll: None,
        attacks_bonus: 0.0,
        rapid_fire_stat: None,
        torrent: false,
        hit: RollProbabilities {
            pass: 1.0,
            crit: 0.0,
        },
        sustained_stat: None,
        lethal: false,
        wound: RollProbabilities {
            pass: 1.0,
            crit: 0.0,
        },
        devastating: false,
        unsaved: 1.0,
        damage: vec![(1.0, 1.0)],
        wound_lost: 1.0,
        mortal_wound_lost: 1.0,
        wounds: 1,
        model_count: 1,
        critical_wound: None,
    }
}

fn assert_close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn loses_damage_beyond_the_damaged_model_and_carries_a_wound_over() {
    // Two D2 attacks into one 3-wound model: 2, then 1 more kills it and 1 is lost.
    let out = allocate_model(&AttackModel {
        attacks_stat: json!(2),
        damage: vec![(2.0, 1.0)],
        wounds: 3,
        model_count: 2,
        ..model()
    })
    .expect("whole quantities");
    assert_close(out.damage_dealt, 3.0, 1e-12);
    assert_close(out.models_destroyed, 1.0, 1e-12);
    assert_eq!(out.models_destroyed_distribution, vec![0.0, 1.0, 0.0]);
}

#[test]
fn caps_at_the_unit_and_matches_the_expected_value_when_nothing_is_lost() {
    let open = AttackModel {
        attacks_stat: Value::String("2D6".into()),
        hit: RollProbabilities {
            pass: 2.0 / 3.0,
            crit: 1.0 / 6.0,
        },
        wound: RollProbabilities {
            pass: 1.0 / 2.0,
            crit: 1.0 / 6.0,
        },
        unsaved: 2.0 / 3.0,
        model_count: 40,
        ..model()
    };
    // E[attacks] * P(hit) * P(wound) * P(unsaved), with no model ever close to running out.
    let expected = 7.0 * (2.0 / 3.0) * (1.0 / 2.0) * (2.0 / 3.0);
    assert_close(allocate_model(&open).unwrap().damage_dealt, expected, 1e-9);
    let capped = allocate_model(&AttackModel {
        model_count: 1,
        ..open
    })
    .unwrap();
    assert!(capped.damage_dealt <= 1.0);
    let total: f64 = capped.models_destroyed_distribution.iter().sum();
    assert_close(total, 1.0, 1e-12);
}

#[test]
fn inflicts_devastating_wounds_after_normal_damage_with_their_own_feel_no_pain() {
    // A normal wound always lands before a mortal one, so a 1-model unit dies to the
    // normal wound and the mortal wound is lost; mortal-only Feel No Pain cannot change that.
    let out = allocate_model(&AttackModel {
        attacks_stat: json!(2),
        wound: RollProbabilities {
            pass: 1.0,
            crit: 0.5,
        },
        devastating: true,
        mortal_wound_lost: 0.5,
        ..model()
    })
    .unwrap();
    // Only both attacks critting leaves the model to two mortal wounds: 1 - 0.25 * (0.5 * 0.5).
    assert_close(out.models_destroyed, 1.0 - 0.25 * 0.25, 1e-12);
}

fn zeroing(uses: usize, per: ZeroingPer) -> AllocationDefences {
    AllocationDefences {
        zeroing: Some(DamageZeroing { uses, per }),
    }
}

#[test]
fn zeroes_the_first_attacks_a_unit_wide_defence_can_take() {
    // Three D3 attacks into one 3-wound model with one use: only the last two roll Damage.
    let d3 = vec![(1.0, 1.0 / 3.0), (2.0, 1.0 / 3.0), (3.0, 1.0 / 3.0)];
    let attack = AttackModel {
        attacks_stat: json!(3),
        damage: d3,
        wounds: 3,
        ..model()
    };
    let zeroed = allocate_model_with(&attack, &zeroing(1, ZeroingPer::Unit)).unwrap();
    let fewer = allocate_model(&AttackModel {
        attacks_stat: json!(2),
        ..attack.clone()
    })
    .unwrap();
    assert_eq!(zeroed, fewer);
    // Two D3 rolls fall short of 3 only as 1 and 1.
    assert_close(zeroed.models_destroyed, 8.0 / 9.0, 1e-12);
    let all = allocate_model_with(&attack, &zeroing(3, ZeroingPer::Unit)).unwrap();
    assert_eq!(all.damage_dealt, 0.0);
}

#[test]
fn refills_a_per_model_defence_but_never_zeroes_mortal_wounds() {
    let attack = AttackModel {
        attacks_stat: json!(3),
        damage: vec![(2.0, 1.0)],
        wounds: 2,
        model_count: 2,
        ..model()
    };
    let per_model = allocate_model_with(&attack, &zeroing(1, ZeroingPer::Model)).unwrap();
    assert_eq!(per_model.models_destroyed_distribution, vec![0.0, 1.0, 0.0]);
    let per_unit = allocate_model_with(&attack, &zeroing(1, ZeroingPer::Unit)).unwrap();
    assert_eq!(per_unit.models_destroyed_distribution, vec![0.0, 0.0, 1.0]);
    let mortal = AttackModel {
        attacks_stat: json!(2),
        wound: RollProbabilities {
            pass: 1.0,
            crit: 1.0,
        },
        devastating: true,
        model_count: 2,
        ..model()
    };
    let out = allocate_model_with(&mortal, &zeroing(2, ZeroingPer::Unit)).unwrap();
    assert_eq!(out.models_destroyed, 2.0);
}

#[test]
fn refuses_event_tables_past_the_exact_bound() {
    let huge = AttackModel {
        models_firing: 20,
        attacks_stat: json!(4),
        hit: RollProbabilities {
            pass: 2.0 / 3.0,
            crit: 1.0 / 6.0,
        },
        sustained_stat: Some(json!(2)),
        wound: RollProbabilities {
            pass: 1.0 / 2.0,
            crit: 1.0 / 6.0,
        },
        devastating: true,
        wounds: 3,
        model_count: 20,
        ..model()
    };
    assert!(matches!(
        allocate_model(&huge),
        Err(AllocationError::TooManyAttacks { attacks: 80, .. })
    ));
    let open = allocate_model(&AttackModel {
        devastating: false,
        ..huge
    })
    .unwrap();
    assert_eq!(open.models_destroyed_distribution.len(), 21);
}

#[test]
fn rejects_a_fractional_quantity_instead_of_rounding_it() {
    let err = allocate_model(&AttackModel {
        damage: vec![(1.5, 1.0)],
        ..model()
    })
    .expect_err("fractional Damage");
    assert!(matches!(
        err,
        AllocationError::NotWhole { what: "Damage", .. }
    ));
    let err = allocate_model(&AttackModel {
        attacks_bonus: 0.5,
        ..model()
    })
    .expect_err("fractional Attacks");
    assert!(matches!(
        err,
        AllocationError::NotWhole {
            what: "Attacks",
            ..
        }
    ));
}

#[test]
fn allocates_critical_wounds_with_their_own_save_and_damage() {
    use crate::cruncher::engine::CriticalWound;
    let base = AttackModel {
        models_firing: 3,
        attacks_stat: json!(2),
        hit: RollProbabilities {
            pass: 2.0 / 3.0,
            crit: 1.0 / 6.0,
        },
        sustained_stat: Some(json!(1)),
        wound: RollProbabilities {
            pass: 0.5,
            crit: 1.0 / 6.0,
        },
        unsaved: 0.5,
        wounds: 2,
        model_count: 5,
        ..model()
    };
    let plain = allocate_model(&base).unwrap();
    let same = allocate_model(&AttackModel {
        critical_wound: Some(CriticalWound {
            unsaved: 0.5,
            damage: base.damage.clone(),
        }),
        ..base.clone()
    })
    .unwrap();
    assert_close(same.damage_dealt, plain.damage_dealt, 1e-12);
    let harder = allocate_model(&AttackModel {
        critical_wound: Some(CriticalWound {
            unsaved: 1.0,
            damage: vec![(2.0, 1.0)],
        }),
        ..base.clone()
    })
    .unwrap();
    assert!(harder.damage_dealt > plain.damage_dealt + 0.05);
}
