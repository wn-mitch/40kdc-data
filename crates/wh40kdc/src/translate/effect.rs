//! Plain-English translation of Ability-DSL `effect` trees — the Rust mirror
//! of `tools/src/translate/effect.ts` (the "ability.print()" of the dataset).
//! Output is an *approximation* generated purely from the structured data (no
//! external rules text), **ASCII-only**, and must be byte-for-byte identical
//! to the TS oracle; the `conformance/effect-translation` corpus pins both
//! ports. Any phrasing change here is a semantic corpus change (bump
//! `conformance/SPEC_VERSION`).
//!
//! Container nodes (`sequence`, `conditional`, `choice`, `dice-gated`,
//! `dice-pool-allocation`) render block-style with two-space indentation and
//! an ASCII `-> ` arrow; leaves render as single clauses. Unrecognized
//! modifier shapes degrade to a deterministic form rather than failing.

use serde_json::{Map, Value};

use super::{dekebab, describe_condition};
use crate::generated::{
    Ability, AbilityAppliesTo, DiceGatedEffect, DiceGatedEffectComparison,
    DiceGatedEffectThreshold, DicePoolAllocationEffect, EffectNode, Scope, SingleEffect,
    SingleEffectType,
};

/// JS-template stringification (`String(v)` semantics; numbers print without
/// a trailing `.0`, `null`/missing prints `?`, arrays join with `, `).
pub(super) fn jval(v: &Value) -> String {
    match v {
        Value::Null => "?".to_string(),
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                let f = n.as_f64().unwrap_or(0.0);
                if f.fract() == 0.0 && f.is_finite() && f.abs() < 9e15 {
                    format!("{}", f as i64)
                } else {
                    format!("{f}")
                }
            }
        }
        Value::Bool(b) => b.to_string(),
        Value::Array(a) => a.iter().map(jval).collect::<Vec<_>>().join(", "),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `jstr(m.key)` — `?` when the key is absent or null (TS `jstr(undefined)`).
fn jv(m: &Map<String, Value>, k: &str) -> String {
    m.get(k).map(jval).unwrap_or_else(|| "?".to_string())
}

/// TS `m.key != null` (present and not null).
fn notnull(m: &Map<String, Value>, k: &str) -> bool {
    matches!(m.get(k), Some(v) if !v.is_null())
}

/// TS truthiness for `m.key ? ... : ...` sites.
fn truthy(m: &Map<String, Value>, k: &str) -> bool {
    match m.get(k) {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// TS `m.a ?? m.b` over the modifier map (first present-and-not-null value).
fn first<'a>(m: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().filter_map(|k| m.get(*k)).find(|v| !v.is_null())
}

/// `+3` / `-1` — sign from `operation` (`add`/`improve` positive), value via
/// JS stringification (`?` when missing).
fn signed(m: &Map<String, Value>) -> String {
    let op = m.get("operation").and_then(Value::as_str);
    let sign = if op == Some("add") || op == Some("improve") {
        "+"
    } else {
        "-"
    };
    format!("{sign}{}", jv(m, "value"))
}

fn format_comparison(
    comp: DiceGatedEffectComparison,
    threshold: &DiceGatedEffectThreshold,
) -> String {
    let th = match threshold {
        DiceGatedEffectThreshold::Integer(i) => i.to_string(),
        DiceGatedEffectThreshold::String(s) => s.to_string(),
    };
    match comp {
        DiceGatedEffectComparison::Gte => format!("{th}+"),
        DiceGatedEffectComparison::Lte => format!("{th} or less"),
        DiceGatedEffectComparison::Gt => format!("greater than {th}"),
        DiceGatedEffectComparison::Lt => format!("less than {th}"),
        DiceGatedEffectComparison::Eq => format!("exactly {th}"),
    }
}

fn dice_gated_inline(d: &DiceGatedEffect) -> String {
    let comp = format_comparison(d.comparison, &d.threshold);
    let success = d
        .on_success
        .as_deref()
        .map(describe_effect_inline)
        .unwrap_or_else(|| "nothing".to_string());
    let fail = d
        .on_fail
        .as_deref()
        .map(|f| format!(", otherwise {}", describe_effect_inline(f)))
        .unwrap_or_default();
    format!("roll {}: on {comp}, {success}{fail}", d.dice)
}

fn dice_pool_options_inline(d: &DicePoolAllocationEffect) -> String {
    d.options
        .iter()
        .map(|o| {
            format!(
                "{} ({}+): {}",
                o.name,
                o.requirement.min_value,
                describe_effect_inline(&o.effect)
            )
        })
        .collect::<Vec<_>>()
        .join(" / ")
}

/// Single-clause translation for leaf effects (and inline container forms).
/// Mirrors `describeEffectInline` in `tools/src/translate/effect.ts`.
pub fn describe_effect_inline(e: &EffectNode) -> String {
    match e {
        EffectNode::SingleEffect(s) => describe_single(s),
        EffectNode::ConditionalEffect(c) => format!(
            "if {}: {}",
            describe_condition(&c.condition),
            describe_effect_inline(&c.effect)
        ),
        EffectNode::SequenceEffect(s) => s
            .steps
            .iter()
            .map(describe_effect_inline)
            .collect::<Vec<_>>()
            .join("; "),
        EffectNode::ChoiceEffect(c) => {
            let label = c
                .choice_label
                .as_deref()
                .map(|l| format!(" ({l})"))
                .unwrap_or_default();
            format!(
                "choose one{label}: {}",
                c.options
                    .iter()
                    .map(describe_effect_inline)
                    .collect::<Vec<_>>()
                    .join(" / ")
            )
        }
        EffectNode::DiceGatedEffect(d) => dice_gated_inline(d),
        EffectNode::DicePoolAllocationEffect(d) => {
            format!(
                "roll {}{}: {}",
                d.pool.count,
                d.pool.die,
                dice_pool_options_inline(d)
            )
        }
    }
}

fn describe_single(e: &SingleEffect) -> String {
    let m = &e.modifier;
    let target = dekebab(&e.target.to_string());
    use SingleEffectType as T;

    match e.type_ {
        T::StatModifier => {
            let scope = if truthy(m, "attack_type") {
                format!(" ({})", jv(m, "attack_type"))
            } else {
                String::new()
            };
            if !notnull(m, "stat") {
                return format!("modify stats for {target}");
            }
            if m.get("operation").and_then(Value::as_str) == Some("set") {
                format!(
                    "set {} to {}{scope} for {target}",
                    jv(m, "stat"),
                    jv(m, "value")
                )
            } else {
                format!("{} {}{scope} for {target}", signed(m), jv(m, "stat"))
            }
        }
        T::RollModifier => {
            let ctx = if truthy(m, "context") {
                format!(" ({})", jv(m, "context"))
            } else {
                String::new()
            };
            if !notnull(m, "value") {
                format!(
                    "{} {} rolls{ctx} for {target}",
                    dekebab(&jv(m, "operation")),
                    jv(m, "roll")
                )
            } else {
                format!("{} to {} rolls{ctx} for {target}", signed(m), jv(m, "roll"))
            }
        }
        T::ReRoll => {
            let subset = if truthy(m, "subset") {
                format!(" ({})", dekebab(&jv(m, "subset")))
            } else {
                String::new()
            };
            let atk = if truthy(m, "attack_type") {
                format!(" ({})", jv(m, "attack_type"))
            } else {
                String::new()
            };
            format!("re-roll {} rolls{subset}{atk} for {target}", jv(m, "roll"))
        }
        T::MortalWounds => {
            let amount = first(m, &["count", "amount"]).map(jval).unwrap_or_else(|| {
                if truthy(m, "amount_table") {
                    "variable".to_string()
                } else {
                    "?".to_string()
                }
            });
            let within = first(m, &["range", "range_inches"])
                .map(|r| format!(" (within {}\")", jval(r)))
                .unwrap_or_default();
            format!("deal {amount} mortal wounds to {target}{within}")
        }
        T::FeelNoPain => format!("{target} gains Feel No Pain {}+", jv(m, "threshold")),
        T::Ward => {
            let th = first(m, &["threshold", "value"])
                .map(jval)
                .unwrap_or_else(|| "?".to_string());
            format!("{target} gains Ward {th}+")
        }
        T::InvulnerableSave => format!(
            "{target} gains a {}+ invulnerable save",
            jv(m, if notnull(m, "invuln_sv") { "invuln_sv" } else { "value" })
        ),
        T::KeywordGrant => {
            let kw = match m.get("keywords") {
                Some(Value::Array(a)) => a.iter().map(jval).collect::<Vec<_>>().join(", "),
                _ => first(m, &["keyword"])
                    .map(jval)
                    .unwrap_or_else(|| "keywords".to_string()),
            };
            if notnull(m, "weapon_name") {
                format!("{target}'s {} gains {kw}", jv(m, "weapon_name"))
            } else if notnull(m, "weapon_type") {
                format!("{target}'s {} weapons gain {kw}", jv(m, "weapon_type"))
            } else {
                format!("{target}'s weapons gain {kw}")
            }
        }
        T::AbilityGrant => {
            let grant = first(m, &["grant_type", "ability_id"])
                .map(|g| dekebab(&jval(g)))
                .unwrap_or_else(|| "an ability".to_string());
            let cap = if notnull(m, "capacity") {
                format!(" ({})", jv(m, "capacity"))
            } else {
                String::new()
            };
            format!("{target} gains {grant}{cap}")
        }
        T::MovementModifier => {
            let kind = first(m, &["move_type", "type"])
                .map(|k| dekebab(&jval(k)))
                .unwrap_or_else(|| "a movement effect".to_string());
            let inches = first(m, &["distance", "value"])
                .map(|d| format!(" {}\"", jval(d)))
                .unwrap_or_default();
            format!("{target} gains {kind}{inches}")
        }
        T::DamageReduction => {
            let amount = first(m, &["amount", "value"])
                .map(jval)
                .unwrap_or_else(|| "?".to_string());
            format!("reduce incoming damage to {target} by {amount}")
        }
        T::Resurrection => {
            let count = first(m, &["count"])
                .map(jval)
                .unwrap_or_else(|| "1".to_string());
            let wounds = first(m, &["wounds_remaining"])
                .map(jval)
                .unwrap_or_else(|| "full".to_string());
            format!("return {count} model(s) to {target} with {wounds} wounds")
        }
        T::ModelDestruction => {
            format!(
                "destroy {} non-leader model(s) from {target}",
                jv(m, "count")
            )
        }
        T::CpGain => format!("gain {} CP", jv(m, "amount")),
        T::CpRefund => format!("refund {} CP", jv(m, "amount")),
        T::ResourceGain => format!("gain {} to {}", jv(m, "amount"), jv(m, "pool_id")),
        T::ResourceSpend => format!("spend {} from {}", jv(m, "amount"), jv(m, "pool_id")),
        T::LeadershipModifier => {
            if notnull(m, "test") && !notnull(m, "operation") {
                format!("force a {} test on {target}", dekebab(&jv(m, "test")))
            } else if notnull(m, "test") {
                format!(
                    "{} {} tests for {target}",
                    dekebab(&jv(m, "operation")),
                    dekebab(&jv(m, "test"))
                )
            } else if notnull(m, "operation") {
                format!("{} Leadership for {target}", signed(m))
            } else {
                format!("modify Leadership for {target}")
            }
        }
        T::FightFirst => format!("{target} fights first"),
        T::FightLast => format!("{target} fights last"),
        T::FightOnDeath => format!("{target} fights on death"),
        T::ShootOnDeath => format!("{target} shoots on death"),
        T::DeepStrike => format!("{target} can deep strike"),
        T::FallbackAndAct => format!("{target} can fall back and act"),
        T::AttackRestriction => {
            let what = first(m, &["restriction", "restriction_type"])
                .map(|w| dekebab(&jval(w)))
                .unwrap_or_else(|| "attack restriction".to_string());
            let range = if notnull(m, "range") {
                format!(" (within {}\")", jv(m, "range"))
            } else {
                String::new()
            };
            let max = if notnull(m, "max_models") {
                format!(" (max {} models)", jv(m, "max_models"))
            } else {
                String::new()
            };
            format!("{target}: {what}{range}{max}")
        }
        T::ObjectiveControlModifier => {
            if notnull(m, "operation") {
                format!("{} OC for {target}", signed(m))
            } else {
                format!("modify OC of {target} by {}", jv(m, "value"))
            }
        }
        T::BsModifier => format!("{} BS for {target}", signed(m)),
        T::ChargeRollModifier => format!("{} to charge rolls for {target}", signed(m)),
        T::EngagementPassthrough => format!("{target} can move through engagement range"),
        T::TerrainAreaTag => format!("tag the terrain area as {}", dekebab(&jv(m, "tag"))),
        T::ObjectiveTag => format!("tag the objective as {}", dekebab(&jv(m, "tag"))),
        T::UnitTag => format!("tag {target} as {}", dekebab(&jv(m, "tag"))),
    }
}

/// Block translation of an effect tree. Containers expand over multiple lines
/// with two-space indentation; leaves delegate to [`describe_effect_inline`].
/// Mirrors `describeEffect` in `tools/src/translate/effect.ts`.
pub fn describe_effect(e: &EffectNode) -> String {
    describe_effect_at(e, 0)
}

fn describe_effect_at(e: &EffectNode, depth: usize) -> String {
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };

    match e {
        EffectNode::ConditionalEffect(c) => format!(
            "{indent}If {}:\n{}",
            describe_condition(&c.condition),
            describe_effect_at(&c.effect, depth + 1)
        ),
        EffectNode::SequenceEffect(s) => s
            .steps
            .iter()
            .map(|step| describe_effect_at(step, depth))
            .collect::<Vec<_>>()
            .join("\n"),
        EffectNode::ChoiceEffect(c) => {
            let label = c
                .choice_label
                .as_deref()
                .map(|l| format!(" ({l})"))
                .unwrap_or_default();
            let options = c
                .options
                .iter()
                .enumerate()
                .map(|(i, o)| format!("{indent}  {}. {}", i + 1, describe_effect_inline(o)))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{indent}{arrow}Choose one{label}:\n{options}")
        }
        EffectNode::DiceGatedEffect(d) => {
            let comp = format_comparison(d.comparison, &d.threshold);
            let success = d
                .on_success
                .as_deref()
                .map(describe_effect_inline)
                .unwrap_or_else(|| "nothing".to_string());
            let fail = d
                .on_fail
                .as_deref()
                .map(|f| format!(", otherwise {}", describe_effect_inline(f)))
                .unwrap_or_default();
            format!("{indent}{arrow}Roll {}: on {comp}, {success}{fail}", d.dice)
        }
        EffectNode::DicePoolAllocationEffect(d) => {
            let mut lines = vec![format!(
                "{indent}{arrow}Roll {}{} (max {} activations):",
                d.pool.count, d.pool.die, d.max_activations
            )];
            for opt in &d.options {
                lines.push(format!(
                    "{indent}  - {}: need {} of {}+ -> {}",
                    opt.name,
                    opt.requirement.type_,
                    opt.requirement.min_value,
                    describe_effect_inline(&opt.effect)
                ));
            }
            lines.join("\n")
        }
        EffectNode::SingleEffect(_) => {
            format!("{indent}{arrow}{}", describe_effect_inline(e))
        }
    }
}

/// `Scope: aura (6"). Duration: phase.` Mirrors `describeScope`.
pub fn describe_scope(s: &Scope) -> String {
    let range = dekebab(&s.range.to_string());
    let inches = s
        .range_inches
        .map(|r| {
            let v = if r.fract() == 0.0 && r.is_finite() && r.abs() < 9e15 {
                format!("{}", r as i64)
            } else {
                format!("{r}")
            };
            format!(" ({v}\")")
        })
        .unwrap_or_default();
    let duration = dekebab(&s.duration.to_string());
    format!("Scope: {range}{inches}. Duration: {duration}.")
}

/// Effect text plus an optional trailing scope line — the composition rule
/// shared with TS `describeAbility`.
pub fn describe_effect_with_scope(e: &EffectNode, scope: Option<&Scope>) -> String {
    let effect = describe_effect(e);
    match scope {
        Some(s) => {
            let scope_line = describe_scope(s);
            if effect.is_empty() {
                scope_line
            } else {
                format!("{effect}\n{scope_line}")
            }
        }
        None => effect,
    }
}

/// `Applies to: units with Possessed.` — the roster-highlighting audience named
/// by a curated `applies_to` filter. Empty string when the filter is absent or
/// carries no keywords. `required_keywords` reads as an AND set; any
/// `excluded_keywords` render as a trailing `(excluding …)`. Mirrors
/// `describeAppliesTo`.
pub fn describe_applies_to(filter: Option<&AbilityAppliesTo>) -> String {
    let Some(filter) = filter else {
        return String::new();
    };
    let required: Vec<&str> = filter
        .required_keywords
        .iter()
        .flat_map(|kl| kl.0.iter())
        .map(|k| k.as_str())
        .collect();
    let excluded: Vec<&str> = filter
        .excluded_keywords
        .iter()
        .flat_map(|kl| kl.0.iter())
        .map(|k| k.as_str())
        .collect();
    if required.is_empty() && excluded.is_empty() {
        return String::new();
    }
    let base = if required.is_empty() {
        "all units".to_string()
    } else {
        format!("units with {}", required.join(", "))
    };
    let exc = if excluded.is_empty() {
        String::new()
    } else {
        format!(" (excluding {})", excluded.join(", "))
    };
    format!("Applies to: {base}{exc}.")
}

/// Compose the full ability print from its parts: the effect tree, an optional
/// scope line, and an optional `Applies to:` line. The single assembler used by
/// both [`describe_ability`] and the runner's `translate_effect` op (which has
/// no full [`Ability`] to hand), keeping the join order in one place.
pub fn describe_ability_parts(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&AbilityAppliesTo>,
) -> String {
    let base = describe_effect_with_scope(e, scope);
    let applies = describe_applies_to(applies_to);
    if applies.is_empty() {
        base
    } else if base.is_empty() {
        applies
    } else {
        format!("{base}\n{applies}")
    }
}

/// Full generated text for an ability: the effect tree, a trailing scope line,
/// and a trailing `Applies to:` line when a curated `applies_to` filter is
/// present. This is the `ability.print()` consumers render when the dataset
/// carries no rules prose. Mirrors `describeAbility`.
pub fn describe_ability(a: &Ability) -> String {
    describe_ability_parts(&a.effect, Some(&a.scope), a.applies_to.as_ref())
}
