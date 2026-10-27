//! The canonical `attack-compare` condition as a buff gate: the attack's Strength against a
//! unit's Toughness. Mirrors `AttackComparison` and `attackComparisonHolds` in
//! `tools/src/cruncher/buffs.ts`.

use serde::{Deserialize, Serialize};

use super::buffs::{BuffApplicability, EngineContext};

/// The unit a comparison operand reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttackSide {
    Attacker,
    Defender,
}

/// Which of a unit's profiles an operand reads: the highest or the lowest.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StatReduce {
    Max,
    Min,
}

/// One side of an [`AttackComparison`]: a characteristic of the attacking or the defending unit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AttackStatOperand {
    pub of: AttackSide,
    pub stat: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduce: Option<StatReduce>,
}

/// The right-hand side of an [`AttackComparison`]: a characteristic or a fixed value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AttackOperand {
    Stat(AttackStatOperand),
    Value { value: f64 },
}

/// The comparison an [`AttackComparison`] makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Comparison {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
}

/// The canonical `attack-compare` condition: `left` `comparison` `right`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AttackComparison {
    pub left: AttackStatOperand,
    pub comparison: Comparison,
    pub right: AttackOperand,
}

/// The characteristic an operand names, or `None` when the context lacks it.
fn attack_stat(operand: &AttackStatOperand, ctx: &EngineContext) -> Option<f64> {
    match operand.of {
        AttackSide::Attacker => match (operand.stat.as_str(), operand.reduce) {
            ("S", None) => ctx.attack_strength,
            ("T", reduce) if reduce != Some(StatReduce::Min) => ctx.attacker_toughness,
            _ => None,
        },
        AttackSide::Defender if operand.stat == "T" => match operand.reduce {
            Some(StatReduce::Max) => ctx.target_toughness_max,
            Some(StatReduce::Min) => ctx.target_toughness_min,
            None => ctx.target_toughness,
        },
        AttackSide::Defender => None,
    }
}

/// Whether an attack comparison holds; a missing characteristic does not establish it.
pub fn attack_comparison_holds(comparison: &AttackComparison, ctx: &EngineContext) -> bool {
    let right = match &comparison.right {
        AttackOperand::Stat(operand) => attack_stat(operand, ctx),
        AttackOperand::Value { value } => Some(*value),
    };
    let (Some(left), Some(right)) = (attack_stat(&comparison.left, ctx), right) else {
        return false;
    };
    match comparison.comparison {
        Comparison::Gt => left > right,
        Comparison::Gte => left >= right,
        Comparison::Lt => left < right,
        Comparison::Lte => left <= right,
        Comparison::Eq => left == right,
    }
}

/// Whether every comparison a gate carries holds (vacuously, when it carries none).
pub(super) fn comparisons_hold(gate: &BuffApplicability, ctx: &EngineContext) -> bool {
    gate.attack_comparisons.as_ref().is_none_or(|comparisons| {
        comparisons
            .iter()
            .all(|comparison| attack_comparison_holds(comparison, ctx))
    })
}

/// Whether a gate, or a weapon requirement nested in it, compares the attack's characteristics.
pub(super) fn has_attack_comparison(gate: Option<&BuffApplicability>) -> bool {
    gate.is_some_and(|gate| {
        gate.attack_comparisons.is_some()
            || gate
                .weapon_requirements
                .iter()
                .flatten()
                .any(|required| has_attack_comparison(Some(required)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Phase;

    fn comparison(json: serde_json::Value) -> AttackComparison {
        serde_json::from_value(json).expect("comparison deserializes")
    }

    fn context() -> EngineContext {
        let mut ctx = EngineContext::new(Phase::Shooting);
        ctx.attack_strength = Some(5.0);
        ctx.target_toughness = Some(4.0);
        ctx.target_toughness_max = Some(6.0);
        ctx.target_toughness_min = Some(3.0);
        ctx
    }

    #[test]
    fn strength_against_toughness_reads_the_attacked_profile_and_the_reduced_extremes() {
        let ctx = context();
        let s_gt_t = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "S"}, "comparison": "gt",
            "right": {"of": "defender", "stat": "T"},
        }));
        assert!(attack_comparison_holds(&s_gt_t, &ctx));
        let s_gt_max = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "S"}, "comparison": "gt",
            "right": {"of": "defender", "stat": "T", "reduce": "max"},
        }));
        assert!(!attack_comparison_holds(&s_gt_max, &ctx));
        let s_eq_value = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "S"}, "comparison": "eq",
            "right": {"value": 5},
        }));
        assert!(attack_comparison_holds(&s_eq_value, &ctx));
    }

    #[test]
    fn a_missing_or_unsupported_characteristic_never_holds() {
        let mut ctx = context();
        // Reduced attacker Strength is not a characteristic the engine supplies.
        let reduced_s = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "S", "reduce": "max"}, "comparison": "gte",
            "right": {"value": 0},
        }));
        assert!(!attack_comparison_holds(&reduced_s, &ctx));
        // `lt` against an unknown attacker Toughness is not vacuously true.
        let attacker_t = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "T"}, "comparison": "lt",
            "right": {"value": 100},
        }));
        assert!(!attack_comparison_holds(&attacker_t, &ctx));
        ctx.attacker_toughness = Some(4.0);
        assert!(attack_comparison_holds(&attacker_t, &ctx));
        ctx.attack_strength = None;
        let s_lt = comparison(serde_json::json!({
            "left": {"of": "attacker", "stat": "S"}, "comparison": "lt",
            "right": {"value": 100},
        }));
        assert!(!attack_comparison_holds(&s_lt, &ctx));
    }
}
