//! Plain-English translation of Ability-DSL `effect` trees — the Rust mirror of
//! `tools/src/translate/effect.ts` (the "ability.print()" of the dataset). Output is
//! subject-first GW-datasheet prose with duration woven in and single-leaf conditionals
//! inlined. **ASCII-only** and byte-for-byte identical to the TS oracle; the
//! `conformance/effect-translation` corpus pins both ports. Any phrasing change here is a
//! semantic corpus change (bump `conformance/SPEC_VERSION`).
//!
//! The describer reads the effect's JSON form, as the TS oracle does: the typed entry points
//! serialize once, and every container and leaf below works on `serde_json::Value`. This
//! module holds the containers; `leaf.rs` / `leaf_board.rs` render single effects and
//! `words.rs` holds the shared vocabulary.

mod ability;
mod block;
mod designation;
mod dice;
mod js;
mod leaf;
mod leaf_ability;
mod leaf_board;
mod leaf_move;
mod leaf_rules;
mod menu;
mod region;
mod select;
mod subject;
mod words;

pub use ability::{
    describe_ability, describe_ability_parts, describe_applies_to, describe_effect,
    describe_effect_inline, describe_effect_with_scope, describe_scope,
};

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::translate::condition::{condition_lead_in_value, nn, obj, truthy, P};
use designation::*;
use dice::*;
use leaf::{describe_leaf, LEAF_TYPES};
use menu::{duration_clauses, menu_inline, scaling_clause, trigger_phrases, usage_clause};
use region::{describe_named_region_conditional, describe_named_region_state};
use select::*;
pub(crate) use words::title_case;
use words::*;

const CONTAINER_TYPES: &[&str] = &[
    "sequence",
    "rules-bundle",
    "ability-part",
    "choice",
    "dice-gated",
    "dice-table",
    "dice-pool-allocation",
    "select-units",
    "for-each-unit",
    "designate-target",
    "persistent-designation",
    "stance-select",
    "risk-reward",
    "issue-orders",
    "resource-action-menu",
];

/// The shared `{}` a missing nested effect or condition reads as.
pub(crate) fn empty_value() -> &'static Value {
    static EMPTY: OnceLock<Value> = OnceLock::new();
    EMPTY.get_or_init(|| Value::Object(Map::new()))
}

fn ty(e: &P) -> &str {
    sv(e, "type").unwrap_or("")
}

fn is_container(e: &P) -> bool {
    CONTAINER_TYPES.contains(&ty(e))
}

/// `e.key ?? {}` for a nested effect or condition.
fn child<'a>(e: &'a P, k: &str) -> &'a Value {
    nn(e, k).unwrap_or(empty_value())
}

fn items<'a>(e: &'a P, k: &str) -> &'a [Value] {
    arr(e, k).map(Vec::as_slice).unwrap_or(&[])
}

fn join_nonempty(parts: &[&str], sep: &str) -> String {
    parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(sep)
}

/// Single-clause translation (lowercase-initial, no period), with any `scaling` block
/// woven on as a trailing "for every …" clause.
pub(crate) fn inline(e: &Value, ctx: &Ctx) -> String {
    let e = obj(Some(e));
    let mut base = inline_base(e, ctx);
    if ty(e) == "movement-modifier" && truthy_key(e, "after_move") {
        base.push_str(&format!(
            "; if it does, {}",
            inline(child(e, "after_move"), ctx)
        ));
    }
    if ty(e) == "mortal-wounds" && is_true(obj(e.get("modifier")), "in_addition_to_normal_damage") {
        base.push_str(", in addition to normal damage");
    }
    match e.get("scaling").filter(|s| truthy(Some(s))) {
        Some(s) => format!("{base} {}", scaling_clause(obj(Some(s)))),
        None => base,
    }
}

fn keyword_filter_clause(value: Option<&Value>, noun: &str) -> String {
    let Some(filter) = value.and_then(Value::as_object) else {
        return noun.to_string();
    };
    let required = map_arr(filter, "required_keywords", jv)
        .map(|k| k.join(" and "))
        .unwrap_or_default();
    let excluded = map_arr(filter, "excluded_keywords", jv)
        .map(|k| k.join(" or "))
        .unwrap_or_default();
    let mut s = noun.to_string();
    if !required.is_empty() {
        s.push_str(&format!(" with {required}"));
    }
    if !excluded.is_empty() {
        s.push_str(&format!(" without {excluded}"));
    }
    s
}

fn aura_eligible_subject(who: &str, eligible: Option<&Value>) -> String {
    let Some(e) = eligible.and_then(Value::as_object) else {
        return who.to_string();
    };
    let required = map_arr(e, "required_keywords", jv).unwrap_or_default();
    let excluded = map_arr(e, "excluded_keywords", jv).unwrap_or_default();
    let base = if required.is_empty() {
        who.to_string()
    } else {
        format!("{}{} unit", &who[..who.len() - 4], required.join(" "))
    };
    if excluded.is_empty() {
        base
    } else {
        format!("{base} (excluding {} units)", excluded.join(" "))
    }
}

fn aura_clause(e: &P, m: &P, ctx: &Ctx) -> String {
    // Range-extension of a named aura (e.g. Gift of Poxes: contagion +3").
    if let Some(bonus) = nn(m, "range_bonus") {
        let named = nn(m, "of")
            .map(|of| format!("{} ", title_case(&jv(of))))
            .unwrap_or_default();
        return format!(
            "the range of this model's {named}abilities is increased by {}\"",
            jv(bonus)
        );
    }
    let range_text = match nn(m, "range") {
        Some(Value::Array(r)) => format!(
            "{} (by battle round)",
            r.iter()
                .map(|x| format!("{}\"", jv(x)))
                .collect::<Vec<_>>()
                .join("/")
        ),
        Some(r) => format!("{}\"", jv(r)),
        None => "range".to_string(),
    };
    let who = if sv(e, "target") == Some("friendly-within-aura") {
        "a friendly unit"
    } else {
        "an enemy unit"
    };
    let eligible_who = aura_eligible_subject(who, m.get("eligible"));
    let recipient = if nn(m, "recipient_filter").is_some() {
        keyword_filter_clause(m.get("recipient_filter"), &eligible_who)
    } else {
        eligible_who
    };
    let emitter = if nn(m, "emitter_filter").is_some() {
        keyword_filter_clause(m.get("emitter_filter"), "this model")
    } else {
        "this model".to_string()
    };
    let effect_text = match nn(m, "effect") {
        Some(effect) => inline(
            effect,
            &Ctx {
                aura_recipient: true,
                ..ctx.clone()
            },
        ),
        None => "that unit is affected".to_string(),
    };
    format!("while {recipient} is within {range_text} of {emitter}, {effect_text}")
}

/// "select one", "select two", "select up to two" — how many menu options are picked.
fn stance_pick(e: &P) -> String {
    let min = num(Some(nn(e, "min_choices").unwrap_or(&Value::from(1))));
    let max = num(Some(nn(e, "max_choices").unwrap_or(&Value::from(1))));
    let n = |k: f64| -> String {
        match k {
            0.0 => "zero".to_string(),
            1.0 => "one".to_string(),
            2.0 => "two".to_string(),
            3.0 => "three".to_string(),
            4.0 => "four".to_string(),
            other => fnum(other),
        }
    };
    if min == max {
        return format!("select {}", n(max));
    }
    if min <= 1.0 {
        format!("select up to {}", n(max))
    } else {
        format!("select from {} to {}", n(min), n(max))
    }
}

fn choice_prompt(e: &P) -> String {
    if let Some(p) = sv(e, "choice_prompt").filter(|p| !p.trim().is_empty()) {
        return p.to_string();
    }
    let label = match sv(e, "choice_label").filter(|l| !l.is_empty()) {
        Some(l) => format!(" ({})", title_case(l)),
        None => String::new(),
    };
    if let (Some(min), Some(max)) = (nn(e, "min_choices"), nn(e, "max_choices")) {
        let quantity = if min.as_f64() == max.as_f64() {
            format!("exactly {}", jv(max))
        } else if min.as_f64() == Some(0.0) {
            format!("up to {}", jv(max))
        } else {
            format!("from {} through {}", jv(min), jv(max))
        };
        return format!("select {quantity} distinct options{label}");
    }
    format!("select one of the following{label}")
}

/// What leads a part: its moment, usage limit, name, the choice to use it and its cost.
fn part_head(e: &P) -> String {
    let moment = trigger_phrases(e.get("trigger"));
    let level = match nn(e, "level") {
        Some(l) if sv(e, "kind") == Some("psychic") => format!(" (Psychic level {})", jv(l)),
        _ => String::new(),
    };
    let optional = truthy_key(e, "optional");
    let named = if truthy_key(e, "name") {
        format!(
            "{}{}{level}",
            if optional { "you can use " } else { "use " },
            jstr(e.get("name"))
        )
    } else if optional {
        "you can".to_string()
    } else {
        String::new()
    };
    let cost = match e.get("cost").filter(|c| truthy(Some(c))) {
        Some(c) => format!("by paying this cost ({})", inline(c, &Ctx::default())),
        None => String::new(),
    };
    let usage = match e.get("usage").filter(|u| truthy(Some(u))) {
        Some(u) => usage_clause(obj(Some(u))),
        None => String::new(),
    };
    let (_, trail) = duration_clauses(e.get("duration"));
    join_nonempty(&[&moment, &usage, &named, &cost, trail], ", ")
}

fn part_inline(e: &P, ctx: &Ctx) -> String {
    let head = part_head(e);
    let body = inline(child(e, "effect"), ctx);
    if head.is_empty() {
        body
    } else {
        format!("{head}: {body}")
    }
}

fn inline_base(e: &P, ctx: &Ctx) -> String {
    let m = obj(e.get("modifier"));
    match ty(e) {
        "named-region-state" => describe_named_region_state(m, ctx),
        "aura" => aura_clause(e, m, ctx),
        "no-effect" => "nothing happens".to_string(),
        "conditional" => {
            let inner = obj(Some(child(e, "effect")));
            if ty(inner) == "named-region-state" {
                return describe_named_region_conditional(
                    obj(inner.get("modifier")),
                    child(e, "condition"),
                    ctx,
                );
            }
            format!(
                "{}, {}",
                condition_lead_in_value(child(e, "condition")),
                inline(child(e, "effect"), ctx)
            )
        }
        "rules-bundle" | "sequence" => {
            let steps = items(e, "steps");
            roll_with_rider(steps, ctx).unwrap_or_else(|| {
                steps
                    .iter()
                    .map(|s| inline(s, ctx))
                    .collect::<Vec<_>>()
                    .join("; ")
            })
        }
        "ability-part" => part_inline(e, ctx),
        "choice" => format!(
            "{}: {}",
            choice_prompt(e),
            items(e, "options")
                .iter()
                .map(|o| inline(o, ctx))
                .collect::<Vec<_>>()
                .join(" / ")
        ),
        "dice-gated" => {
            if truthy_key(e, "test") {
                return leadership_test(e, ctx);
            }
            format!("roll {}", dice_gated_body(e, ctx))
        }
        "dice-table" => dice_table_inline(e, ctx),
        "dice-pool-allocation" => {
            let opts = items(e, "options")
                .iter()
                .map(|o| {
                    let o = obj(Some(o));
                    format!(
                        "{} (requires {}): {}",
                        jstr(o.get("name")),
                        describe_requirement(o.get("requirement")),
                        inline(child(o, "effect"), ctx)
                    )
                })
                .collect::<Vec<_>>()
                .join(" / ");
            format!("roll {}: {opts}", pool_phrase(e))
        }
        "select-units" => select_units_inline(obj(nn(e, "selector")), child(e, "effect"), ctx),
        "leader-model-ability-grant" => leader_model_ability_grant_clause(e, ctx),
        "persistent-designation" => {
            if sv(e, "operation") == Some("replace") {
                return persistent_replacement(e);
            }
            if !persistent_supported(e) {
                return "[persistent-designation]".to_string();
            }
            format!(
                "{} {}, {}",
                persistent_lead(e),
                persistent_when(e),
                inline(child(obj(nn(e, "consumer")), "effect"), ctx)
            )
        }
        "for-each-unit" => {
            let sel = obj(nn(e, "selector"));
            format!(
                "for each {}: {}",
                for_each_unit_subject(sel),
                inline(child(e, "effect"), &selected_context(ctx, sel))
            )
        }
        "designate-target" => designate_target_inline(e, ctx),
        "stance-select" => format!(
            "{}: {}",
            stance_pick(e),
            items(e, "options")
                .iter()
                .map(|o| {
                    let o = obj(Some(o));
                    format!(
                        "{} ({})",
                        jstr(o.get("name")),
                        inline(child(o, "effect"), ctx)
                    )
                })
                .collect::<Vec<_>>()
                .join(" / ")
        ),
        "stance-selection-capacity" => {
            let n = num(m.get("additional_selections"));
            let n = if n.is_nan() || n == 0.0 { 1.0 } else { n };
            let times = if n == 1.0 {
                "one additional time".to_string()
            } else {
                format!("{} additional times", fnum(n))
            };
            let subject = match nn(m, "option_id") {
                Some(opt) if sv(m, "allocation") == Some("fixed-option") => title_case(&jv(opt)),
                _ => format!("one option of {}", title_case(&jstr(m.get("stance_id")))),
            };
            format!("you can select {subject} {times} per battle")
        }
        "risk-reward" => {
            let risk = obj(nn(e, "risk"));
            let on_fail = match risk.get("on_fail").filter(|f| truthy(Some(f))) {
                Some(f) => inline(f, ctx),
                None => "suffer a consequence".to_string(),
            };
            format!(
                "take a {} test (on a failure, {on_fail}), then {}",
                test_name(risk.get("test")),
                inline(child(e, "reward"), ctx)
            )
        }
        "issue-orders" => format!(
            "issue Orders, each one of: {}",
            items(e, "options")
                .iter()
                .map(|o| jstr(o.get("name")))
                .collect::<Vec<_>>()
                .join(" / ")
        ),
        "resource-action-menu" => menu_inline(e, ctx),
        t if LEAF_TYPES.contains(&t) => describe_leaf(e, ctx),
        "" => "[unknown]".to_string(),
        t => format!("[{t}]"),
    }
}
