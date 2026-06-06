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
//!
//! Leaf phrasing favors graceful omission over placeholders: optional modifier
//! fields that are absent (a CP amount, a move distance, a range) drop their
//! clause instead of rendering `?`.

use serde_json::{Map, Value};

use super::{dekebab, describe_condition};
use crate::generated::{
    Ability, DiceGatedEffect, DiceGatedEffectComparison, DiceGatedEffectThreshold,
    DicePoolAllocationEffect, EffectNode, Scope, SingleEffect, SingleEffectTarget,
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

/// `unit` → `the unit`, `self` → `this model`, etc. Mirrors `formatTarget`.
fn format_target(t: SingleEffectTarget) -> &'static str {
    use SingleEffectTarget as T;
    match t {
        T::Unit => "the unit",
        T::Self_ => "this model",
        T::Bearer => "the bearer",
        T::Attacker => "the attacker",
        T::Defender => "the defender",
        T::EnemyWithinAura => "enemy units in range",
        T::FriendlyWithinAura => "friendly units in range",
        T::AllFriendly => "all friendly units",
        T::AllEnemy => "all enemy units",
        T::AttachedUnit => "the attached unit",
    }
}

/// Targets that render as plural noun phrases and need plural verb forms.
fn is_plural_target(t: SingleEffectTarget) -> bool {
    use SingleEffectTarget as T;
    matches!(
        t,
        T::EnemyWithinAura | T::FriendlyWithinAura | T::AllFriendly | T::AllEnemy
    )
}

/// Pick the verb form agreeing with the target's number.
fn verb<'a>(pl: bool, singular: &'a str, plural_form: &'a str) -> &'a str {
    if pl {
        plural_form
    } else {
        singular
    }
}

/// `the unit` → `the unit's`; `all friendly units` → `all friendly units'`.
fn possessive(t: &str) -> String {
    if t.ends_with('s') {
        format!("{t}'")
    } else {
        format!("{t}'s")
    }
}

/// `1 mortal wound` / `D3 mortal wounds` — `1` is the only singular amount.
fn plural(amount: &str, noun: &str) -> String {
    if amount == "1" {
        format!("{amount} {noun}")
    } else {
        format!("{amount} {noun}s")
    }
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

/// `improve` / `worsen` — the verb form of `signed` when no value is present.
fn signed_verb(m: &Map<String, Value>) -> &'static str {
    let op = m.get("operation").and_then(Value::as_str);
    if op == Some("add") || op == Some("improve") {
        "improve"
    } else {
        "worsen"
    }
}

/// Datasheet stat abbreviations → words (unknown stats fall back to dekebab).
fn stat_name(stat: &str) -> String {
    match stat {
        "M" => "Move".to_string(),
        "T" => "Toughness".to_string(),
        "Sv" => "Save".to_string(),
        "W" => "Wounds".to_string(),
        "Ld" => "Leadership".to_string(),
        "OC" => "OC".to_string(),
        "A" => "Attacks".to_string(),
        "S" => "Strength".to_string(),
        "D" => "Damage".to_string(),
        "AP" => "AP".to_string(),
        "BS" => "BS".to_string(),
        "WS" => "WS".to_string(),
        other => dekebab(other),
    }
}

fn threshold_string(threshold: &DiceGatedEffectThreshold) -> (String, bool) {
    match threshold {
        DiceGatedEffectThreshold::Integer(i) => (i.to_string(), true),
        DiceGatedEffectThreshold::String(s) => (s.to_string(), false),
    }
}

fn format_comparison(
    comp: DiceGatedEffectComparison,
    threshold: &DiceGatedEffectThreshold,
) -> String {
    let (th, numeric) = threshold_string(threshold);
    match comp {
        DiceGatedEffectComparison::Gte => {
            if numeric {
                format!("{th}+")
            } else {
                format!("{th} or higher")
            }
        }
        DiceGatedEffectComparison::Lte => format!("{th} or less"),
        DiceGatedEffectComparison::Gt => format!("greater than {th}"),
        DiceGatedEffectComparison::Lt => format!("less than {th}"),
        DiceGatedEffectComparison::Eq => format!("exactly {th}"),
    }
}

/// The failing band of a comparison: `gte 4` fails on `below 4`. Mirrors
/// `formatComparisonInverse`.
fn format_comparison_inverse(
    comp: DiceGatedEffectComparison,
    threshold: &DiceGatedEffectThreshold,
) -> String {
    let (th, _) = threshold_string(threshold);
    match comp {
        DiceGatedEffectComparison::Gte => format!("below {th}"),
        DiceGatedEffectComparison::Lte => format!("above {th}"),
        DiceGatedEffectComparison::Gt => format!("{th} or less"),
        DiceGatedEffectComparison::Lt => format!("{th} or more"),
        DiceGatedEffectComparison::Eq => format!("not exactly {th}"),
    }
}

/// Known `ability-grant` grant types → readable clauses (the grant type is a
/// community-authored tag, so this list tracks authoring vocabulary). Unmapped
/// values fall back to `gains <dekebab>`. Mirrors `describeGrant`.
fn describe_grant(grant: &str, target: &str, capacity: Option<&Value>, pl: bool) -> String {
    let has = verb(pl, "has", "have");
    match grant {
        "benefit-of-cover" => format!("{target} {has} the Benefit of Cover"),
        "lone-operative" | "lone-op" => {
            if pl {
                format!("{target} are Lone Operatives")
            } else {
                format!("{target} is a Lone Operative")
            }
        }
        "leader" | "leader-attachment" => {
            format!("{target} can be attached to a unit as a Leader")
        }
        "fights-first" => format!("{target} {} first", verb(pl, "fights", "fight")),
        "firing-deck" => match capacity {
            Some(c) => format!("{target} {has} Firing Deck {}", jval(c)),
            None => format!("{target} {has} a Firing Deck"),
        },
        "deep-strike" => format!("{target} can deep strike"),
        "deep-strike-6inch-exclusion" => {
            format!("{target} can deep strike more than 6\" from enemy units")
        }
        "charge-after-advance" => format!("{target} can charge after advancing"),
        "advance-and-charge" => format!("{target} can advance and charge"),
        "reactive-overwatch" => format!("{target} can fire overwatch reactively"),
        "forced-attachment" => format!("{target} must be attached to a unit"),
        "attached-unit-eligibility" => {
            format!("{target} {has} special leader-attachment eligibility")
        }
        "transport-disembark-modifier" => format!("{target} {has} a special disembark rule"),
        "special-embark-rule" => format!("{target} {has} a special embark rule"),
        "once-per-battle-special" => format!("{target} {has} a once-per-battle special rule"),
        "once-per-round-special" => format!("{target} {has} a once-per-round special rule"),
        "post-attack-debuff" => format!(
            "{target} {} a debuff after attacking",
            verb(pl, "applies", "apply")
        ),
        "target-in-engagement" => {
            format!("{target} can shoot at targets within engagement range")
        }
        "extended-order-range" => format!("{target} {has} an extended order range"),
        "flavor-text" => format!("{target}: no game effect (flavor text)"),
        "faction-metadata" => format!("{target}: faction rule (see faction rules)"),
        other => {
            let cap = capacity
                .map(|c| format!(" ({})", jval(c)))
                .unwrap_or_default();
            format!(
                "{target} {} {}{cap}",
                verb(pl, "gains", "gain"),
                dekebab(other)
            )
        }
    }
}

/// Known `movement-modifier` kinds → readable clauses. A null/zero distance
/// omits the inches clause entirely (no `0"` noise). Unmapped kinds fall back
/// to `gains <dekebab>`. Mirrors `describeMove`.
fn describe_move(kind: &str, target: &str, dist: Option<&Value>, pl: bool) -> String {
    let has_dist = match dist {
        None => false,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => s != "0",
        Some(v) => !v.is_null(),
    };
    let d = dist.map(jval).unwrap_or_default();
    let inches = if has_dist {
        format!(" {d}\"")
    } else {
        String::new()
    };
    let up_to = if has_dist {
        format!(" of up to {d}\"")
    } else {
        String::new()
    };
    let has = verb(pl, "has", "have");
    match kind {
        "scouts" => format!("{target} {has} Scouts{inches}"),
        "infiltrate" => format!("{target} {has} Infiltrators"),
        "deep-strike" => format!("{target} can deep strike"),
        "hover" => format!("{target} can hover"),
        "reactive-move" => format!("{target} can make a reactive move{up_to}"),
        "shoot-and-scoot" | "move-after-shoot" => {
            format!("{target} can move{up_to} after shooting")
        }
        "redeploy-to-reserves" => format!("{target} can redeploy into reserves"),
        "into-strategic-reserves" => format!("{target} can move into strategic reserves"),
        "move-over-terrain" => format!("{target} can move over terrain"),
        "move-through" | "terrain-passthrough" => format!("{target} can move through terrain"),
        "pile-in-consolidation" => {
            if has_dist {
                format!(
                    "{target} {} in and {} up to {d}\"",
                    verb(pl, "piles", "pile"),
                    verb(pl, "consolidates", "consolidate")
                )
            } else {
                format!("{target} {has} extended pile-in and consolidation")
            }
        }
        "extended-consolidation" => {
            if has_dist {
                format!(
                    "{target} {} up to {d}\"",
                    verb(pl, "consolidates", "consolidate")
                )
            } else {
                format!("{target} {has} extended consolidation")
            }
        }
        "surge-move" => format!("{target} can make a surge move{up_to}"),
        "ignore-vertical" => format!(
            "{target} {} vertical distance when moving",
            verb(pl, "ignores", "ignore")
        ),
        "deep-strike-6inch-exclusion" => {
            format!("{target} can deep strike more than 6\" from enemy units")
        }
        "deep-strike-min-distance" | "deep-strike-exclusion-range" | "deep-strike-close" => {
            if has_dist {
                format!("{target} can deep strike more than {d}\" from enemy units")
            } else {
                format!("{target} has a modified deep strike distance")
            }
        }
        "normal" => format!("{target} can make a normal move{up_to}"),
        other => format!(
            "{target} {} {}{inches}",
            verb(pl, "gains", "gain"),
            dekebab(other)
        ),
    }
}

/// Known `attack-restriction` tags → readable clauses. Unmapped values fall
/// back to `<target>: <dekebab>`. Mirrors `describeRestriction`.
fn describe_restriction(what: &str, target: &str, pl: bool) -> String {
    let is = verb(pl, "is", "are");
    match what {
        "cannot-be-targeted-unless-closest-or-within-12" => {
            let it = if pl { "they are" } else { "it is" };
            format!("{target} cannot be targeted unless the attacker is within 12\" or {it} the closest eligible target")
        }
        "anti-fallback" => {
            format!("enemy units in engagement range of {target} cannot fall back")
        }
        "must-be-warlord" => format!("{target} must be your Warlord"),
        "cannot-be-warlord" => format!("{target} cannot be your Warlord"),
        "no-charge" | "cannot-charge" | "cannot-declare-charge" | "charge-blocked" | "charge" => {
            format!("{target} cannot declare a charge")
        }
        "no-advance" => format!("{target} cannot advance"),
        "reinforcement-denial" | "prevent-reserve-setup" => {
            format!("enemy reinforcements cannot be set up near {target}")
        }
        "prevents-enemy-reserves-within-12" => {
            format!("enemy reinforcements cannot be set up within 12\" of {target}")
        }
        "army-composition-rule" | "army-composition-constraint" => {
            format!("{target} {is} subject to an army composition rule")
        }
        "unique-unit-limit" => format!("{target} {is} limited to one per army"),
        "fire-overwatch" => format!("{target} can fire overwatch"),
        "cannot-target-bearer" => "enemy units cannot target the bearer".to_string(),
        "cannot-receive-enhancements" => format!("{target} cannot be given enhancements"),
        other => format!("{target}: {}", dekebab(other)),
    }
}

fn dice_gated_inline(d: &DiceGatedEffect) -> String {
    if d.on_success.is_none() {
        if let Some(f) = d.on_fail.as_deref() {
            let inv = format_comparison_inverse(d.comparison, &d.threshold);
            return format!("roll {}: on {inv}, {}", d.dice, describe_effect_inline(f));
        }
    }
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
    let target = format_target(e.target);
    let pl = is_plural_target(e.target);
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
            let stat = stat_name(&jv(m, "stat"));
            if m.get("operation").and_then(Value::as_str) == Some("set") {
                format!("set {stat} to {}{scope} for {target}", jv(m, "value"))
            } else if !notnull(m, "value") {
                format!("{} {stat}{scope} for {target}", signed_verb(m))
            } else {
                format!("{} {stat}{scope} for {target}", signed(m))
            }
        }
        T::RollModifier => {
            let ctx = if truthy(m, "context") {
                format!(" ({})", jv(m, "context"))
            } else {
                String::new()
            };
            if notnull(m, "critical_on") {
                format!(
                    "critical {}s on {}+{ctx} for {target}",
                    jv(m, "roll"),
                    jv(m, "critical_on")
                )
            } else if !notnull(m, "operation") && !notnull(m, "value") {
                format!("modify {} rolls{ctx} for {target}", jv(m, "roll"))
            } else if !notnull(m, "value") {
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
            let atk = if notnull(m, "attack_type") {
                format!("{} ", jv(m, "attack_type"))
            } else {
                String::new()
            };
            let roll = format!("{atk}{} rolls", jv(m, "roll"));
            match m.get("subset").and_then(Value::as_str) {
                Some("ones") => format!("re-roll {roll} of 1 for {target}"),
                Some("all-failures") => format!("re-roll failed {roll} for {target}"),
                Some(other) => format!("re-roll {roll} ({}) for {target}", dekebab(other)),
                None => format!("re-roll {roll} for {target}"),
            }
        }
        T::MortalWounds => {
            if notnull(m, "trigger") && notnull(m, "threshold") {
                return format!(
                    "{} triggers on {}+ for {target}",
                    dekebab(&jv(m, "trigger")),
                    jv(m, "threshold")
                );
            }
            let base = first(m, &["count", "amount"]);
            let amount = match (base, m.get("bonus").filter(|v| !v.is_null())) {
                (Some(b), Some(bonus)) => Some(format!("{}+{}", jval(b), jval(bonus))),
                (Some(b), None) => Some(jval(b)),
                (None, _) => None,
            };
            let range = first(m, &["range", "range_inches"]);
            // `enemy units in range (within 6")` is redundant — fold the inches in.
            let to = if e.target == SingleEffectTarget::EnemyWithinAura {
                range.map(|r| format!("enemy units within {}\"", jval(r)))
            } else {
                None
            };
            let within = if to.is_none() {
                range
                    .map(|r| format!(" (within {}\")", jval(r)))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let to_str = to.unwrap_or_else(|| target.to_string());
            match amount {
                None if notnull(m, "amount_table") => {
                    format!("deal mortal wounds (amount varies) to {to_str}{within}")
                }
                None => format!("deal mortal wounds to {to_str}{within}"),
                Some(a) => format!("deal {} to {to_str}{within}", plural(&a, "mortal wound")),
            }
        }
        T::FeelNoPain => format!(
            "{target} {} Feel No Pain {}+",
            verb(pl, "has", "have"),
            jv(m, "threshold")
        ),
        T::Ward => {
            let th = first(m, &["threshold", "value"])
                .map(jval)
                .unwrap_or_else(|| "?".to_string());
            format!("{target} {} Ward {th}+", verb(pl, "has", "have"))
        }
        T::InvulnerableSave => {
            let has = verb(pl, "has", "have");
            match first(m, &["invuln_sv", "value", "threshold"]) {
                None => format!("{target} {has} an invulnerable save"),
                Some(v) => format!("{target} {has} a {}+ invulnerable save", jval(v)),
            }
        }
        T::KeywordGrant => {
            let kw = match m.get("keywords") {
                Some(Value::Array(a)) => a.iter().map(jval).collect::<Vec<_>>().join(", "),
                _ => first(m, &["keyword"])
                    .map(jval)
                    .unwrap_or_else(|| "keywords".to_string()),
            };
            let poss = possessive(target);
            if notnull(m, "weapon_name") {
                format!("{poss} {} gains {kw}", jv(m, "weapon_name"))
            } else if notnull(m, "weapon_type") {
                format!("{poss} {} weapons gain {kw}", jv(m, "weapon_type"))
            } else {
                format!("{poss} weapons gain {kw}")
            }
        }
        T::AbilityGrant => match first(m, &["grant_type", "ability_id"]) {
            None => format!("{target} {} an ability", verb(pl, "gains", "gain")),
            Some(g) => describe_grant(
                &jval(g),
                target,
                m.get("capacity").filter(|v| !v.is_null()),
                pl,
            ),
        },
        T::MovementModifier => {
            let dist = first(m, &["distance", "value"]);
            match first(m, &["move_type", "type"]) {
                None => format!("{target} {} a movement effect", verb(pl, "gains", "gain")),
                Some(k) => describe_move(&jval(k), target, dist, pl),
            }
        }
        T::DamageReduction => match first(m, &["reduction", "amount", "value"]) {
            None => format!("reduce incoming damage to {target}"),
            Some(a) => format!("reduce incoming damage to {target} by {}", jval(a)),
        },
        T::Resurrection => {
            let count = first(m, &["count"])
                .map(jval)
                .unwrap_or_else(|| "1".to_string());
            let wounds = first(m, &["wounds_remaining"])
                .map(jval)
                .unwrap_or_else(|| "full".to_string());
            format!(
                "return {} to {target} with {wounds} wounds",
                plural(&count, "model")
            )
        }
        T::ModelDestruction => match first(m, &["count"]) {
            None => format!("destroy a non-leader model from {target}"),
            Some(c) => format!(
                "destroy {} from {target}",
                plural(&jval(c), "non-leader model")
            ),
        },
        T::CpGain => {
            let once = if m.get("type").and_then(Value::as_str) == Some("once-per-battle-resource")
            {
                " (once per battle)"
            } else {
                ""
            };
            if !notnull(m, "amount") {
                format!("gain CP{once}")
            } else {
                format!("gain {} CP{once}", jv(m, "amount"))
            }
        }
        T::CpRefund => {
            let once = if m.get("type").and_then(Value::as_str) == Some("once-per-battle-resource")
            {
                " (once per battle)"
            } else {
                ""
            };
            let strat = if notnull(m, "stratagem") {
                format!(" for {}", dekebab(&jv(m, "stratagem")))
            } else {
                String::new()
            };
            let freq = if notnull(m, "frequency") {
                format!(" ({})", dekebab(&jv(m, "frequency")))
            } else {
                String::new()
            };
            if !notnull(m, "amount") {
                format!("refund CP{strat}{freq}{once}")
            } else {
                format!("refund {} CP{strat}{freq}{once}", jv(m, "amount"))
            }
        }
        T::ResourceGain => {
            let what = first(m, &["pool_id", "resource"])
                .map(|p| {
                    let s = dekebab(&jval(p));
                    s.strip_suffix(" pool").map(str::to_string).unwrap_or(s)
                })
                .unwrap_or_else(|| "resource".to_string());
            if !notnull(m, "amount") {
                format!("gain {what}")
            } else {
                format!("gain {} {what}", jv(m, "amount"))
            }
        }
        T::ResourceSpend => {
            let what = first(m, &["pool_id", "resource"])
                .map(|p| {
                    let s = dekebab(&jval(p));
                    s.strip_suffix(" pool").map(str::to_string).unwrap_or(s)
                })
                .unwrap_or_else(|| "resource".to_string());
            if m.get("operation").and_then(Value::as_str) == Some("multiply") {
                format!(
                    "{what} costs are multiplied by {} for {target}",
                    jv(m, "value")
                )
            } else if !notnull(m, "amount") {
                format!("spend {what}")
            } else {
                format!("spend {} {what}", jv(m, "amount"))
            }
        }
        T::LeadershipModifier => {
            if notnull(m, "test") && !notnull(m, "operation") {
                format!("force a {} test on {target}", dekebab(&jv(m, "test")))
            } else if notnull(m, "test") {
                format!(
                    "{} {} tests for {target}",
                    dekebab(&jv(m, "operation")),
                    dekebab(&jv(m, "test"))
                )
            } else if notnull(m, "operation") && !notnull(m, "value") {
                format!("{} Leadership for {target}", signed_verb(m))
            } else if notnull(m, "operation") {
                format!("{} Leadership for {target}", signed(m))
            } else {
                format!("modify Leadership for {target}")
            }
        }
        T::FightFirst => format!("{target} {} first", verb(pl, "fights", "fight")),
        T::FightLast => format!("{target} {} last", verb(pl, "fights", "fight")),
        T::FightOnDeath => format!("{target} can fight after being destroyed"),
        T::ShootOnDeath => format!("{target} can shoot after being destroyed"),
        T::DeepStrike => format!("{target} can deep strike"),
        T::FallbackAndAct => format!("{target} can fall back and still act"),
        T::AttackRestriction => {
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
            match first(m, &["restriction", "restriction_type"]) {
                None if m.get("attack_type").and_then(Value::as_str) == Some("charge") => {
                    format!("{target} cannot declare a charge{range}{max}")
                }
                None if notnull(m, "attack_type") => format!(
                    "{target} cannot make {} attacks{range}{max}",
                    jv(m, "attack_type")
                ),
                None => format!("{target}: attack restriction{range}{max}"),
                Some(w) => format!("{}{range}{max}", describe_restriction(&jval(w), target, pl)),
            }
        }
        T::ObjectiveControlModifier => {
            if truthy(m, "sticky") {
                format!(
                    "objectives captured by {target} remain under your control after it moves away"
                )
            } else if notnull(m, "operation") && !notnull(m, "value") {
                format!("{} OC for {target}", signed_verb(m))
            } else if notnull(m, "operation") {
                format!("{} OC for {target}", signed(m))
            } else if !notnull(m, "value") {
                format!("modify OC of {target}")
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
            if d.on_success.is_none() {
                if let Some(f) = d.on_fail.as_deref() {
                    let inv = format_comparison_inverse(d.comparison, &d.threshold);
                    return format!(
                        "{indent}{arrow}Roll {}: on {inv}, {}",
                        d.dice,
                        describe_effect_inline(f)
                    );
                }
            }
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
                    "{indent}  - {}: needs a {} of {}+ -> {}",
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

/// `Scope: aura 6". Duration: phase.` Mirrors `describeScope`.
pub fn describe_scope(s: &Scope) -> String {
    let mut range = dekebab(&s.range.to_string());
    // `aura-6` carries its radius in the range tag itself — add the inch mark.
    if let Some(rest) = range.strip_prefix("aura ") {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            range = format!("aura {rest}\"");
        }
    }
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

/// Full generated text for an ability: the effect tree plus a trailing scope
/// line. This is the `ability.print()` consumers render when the dataset
/// carries no rules prose. Mirrors `describeAbility`.
pub fn describe_ability(a: &Ability) -> String {
    describe_effect_with_scope(&a.effect, Some(&a.scope))
}
