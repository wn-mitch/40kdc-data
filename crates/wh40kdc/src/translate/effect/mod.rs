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
mod bind;
mod block;
mod designation;
mod dice;
mod js;
mod leaf;
mod leaf_ability;
mod leaf_board;
mod leaf_move;
mod leaf_rules;
mod leaf_shapes;
mod menu;
mod placement;
mod quantity;
mod region;
mod select;
mod subject;
mod words;

pub use ability::{
    describe_ability, describe_ability_parts, describe_ability_parts_with_optional,
    describe_applies_to, describe_effect, describe_effect_inline, describe_effect_with_scope,
    describe_scope,
};

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::translate::condition::{
    condition_lead_in_for, is_defensive_effect, nn, obj, range_phrase, truthy, P,
};
use designation::*;
use dice::*;
use leaf::{describe_leaf, LEAF_TYPES};
pub(crate) use menu::usage_clause;
use menu::{duration_clauses, menu_inline, scaling_clause, trigger_phrases};
use region::{describe_named_region_conditional, describe_named_region_state};
use select::*;
use words::*;
pub(crate) use words::{bracket_keyword, dice_case, title_case, weapon_noun};

const CONTAINER_TYPES: &[&str] = &[
    "roll",
    "select-objective",
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

/// Who an aura is measured from. A filter that names an owner is army-wide: any of that side's
/// models with its keywords ("one or more friendly DEATH GUARD models"; owner any names no side).
/// Without one it narrows the aura's own origin (this model, or this unit).
fn aura_emitter(filter: &P, origin: &str, ctx: &Ctx) -> String {
    let Some(owner) = sv(filter, "owner") else {
        return aura_role_filter(filter, origin, ctx);
    };
    let side = if owner == "any" {
        String::new()
    } else {
        format!(" {owner}")
    };
    let keywords = map_arr(filter, "all_of", jv)
        .map(|keywords| {
            keywords
                .iter()
                .map(|keyword| format!(" {keyword}"))
                .collect::<String>()
        })
        .unwrap_or_default();
    let mut rest = filter.clone();
    rest.remove("owner");
    rest.remove("all_of");
    aura_role_filter(&rest, &format!("one or more{side}{keywords} models"), ctx)
}

fn aura_role_filter(filter: &P, noun: &str, ctx: &Ctx) -> String {
    let all = map_arr(filter, "all_of", jv)
        .map(|keywords| format!(" with {}", keywords.join(" and ")))
        .unwrap_or_default();
    let any = map_arr(filter, "any_of", jv)
        .map(|keywords| {
            format!(
                " with at least one of {}",
                crate::translate::condition::or_list(&keywords)
            )
        })
        .unwrap_or_default();
    let none = map_arr(filter, "none_of", jv)
        .map(|keywords| {
            format!(
                " without {}",
                crate::translate::condition::or_list(&keywords)
            )
        })
        .unwrap_or_default();
    let not_all = map_arr(filter, "not_all_of", jv)
        .map(|keywords| format!(" without all of {}", keywords.join(" and ")))
        .unwrap_or_default();
    let mut relations = filter.clone();
    for key in ["all_of", "any_of", "none_of", "not_all_of"] {
        relations.remove(key);
    }
    if sv(&relations, "owner") == Some("any") {
        relations.remove("owner");
    }
    if sv(&relations, "level") == Some("unit") {
        relations.remove("level");
    }
    relations.retain(|_, value| match value {
        Value::Null => false,
        Value::Array(items) => !items.is_empty(),
        Value::Object(object) => !object.is_empty(),
        _ => true,
    });
    let other = if relations.is_empty() {
        String::new()
    } else {
        format!(" matching {}", subject::filter_subject(&relations, ctx))
    };
    format!("{noun}{all}{any}{none}{not_all}{other}")
}

fn aura_clause(e: &P, m: &P, ctx: &Ctx) -> String {
    if let Some(bonus) = nn(m, "range_bonus") {
        let named = nn(m, "of")
            .map(|of| format!("{} ", title_case(&jv(of))))
            .unwrap_or_default();
        return format!(
            "the range of this model's {named}abilities is increased by {}{}",
            range_phrase(Some(bonus)),
            nn(m, "range_cap")
                .map(|c| format!(" (to a maximum of {})", range_phrase(Some(c))))
                .unwrap_or_default()
        );
    }
    let range_text = nn(m, "range")
        .map(|range| range_phrase(Some(range)))
        .unwrap_or_else(|| "range".to_string());
    let owner = if sv(e, "target") == Some("friendly-within-aura") {
        "friendly"
    } else {
        "enemy"
    };
    let recipient_filter = obj(m.get("eligible").or_else(|| m.get("recipient_filter")));
    let mut filter = recipient_filter.clone();
    filter.insert("owner".into(), Value::from(owner));
    let rendered = subject::filter_subject(&filter, ctx);
    let subject = rendered
        .strip_prefix("all ")
        .unwrap_or(&rendered)
        .replacen(" units", " unit", 1)
        .replacen(" models", " model", 1)
        .replacen(" that are", " that is", 1);
    let eligible_who = format!(
        "{} {subject}",
        if subject
            .chars()
            .next()
            .is_some_and(|character| "aeiouAEIOU".contains(character))
        {
            "an"
        } else {
            "a"
        }
    );
    let recipient = if nn(m, "eligible").is_some() && nn(m, "recipient_filter").is_some() {
        aura_role_filter(obj(m.get("recipient_filter")), &eligible_who, ctx)
    } else {
        eligible_who
    };
    // Without a range bonus, of names the unit the range is measured from; this model by default.
    let origin = if sv(m, "of") == Some("this-unit") {
        "this unit"
    } else {
        "this model"
    };
    let emitter = nn(m, "emitter_filter")
        .map(|filter| aura_emitter(obj(Some(filter)), origin, ctx))
        .unwrap_or_else(|| origin.to_string());
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
    let capped = nn(m, "range_cap")
        .map(|c| {
            format!(
                " (to a maximum of {}, extensions included)",
                range_phrase(Some(c))
            )
        })
        .unwrap_or_default();
    let wholly = if is_true(m, "wholly") { "wholly " } else { "" };
    format!("while {recipient} is {wholly}within {range_text}{capped} of {emitter}, {effect_text}")
}

/// " (in addition to any already active)" when a stance pick joins the active options.
fn stance_additive(e: &P) -> &'static str {
    if is_true(e, "additive") {
        " (in addition to any already active)"
    } else {
        ""
    }
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
    // A named part that always applies is a labelled rule ("Kine Shield: ..."), not one to use.
    let label = if truthy_key(e, "name") && moment.is_empty() && !optional {
        format!("{}{level}", jstr(e.get("name")))
    } else {
        String::new()
    };
    let named = if !label.is_empty() {
        String::new()
    } else if truthy_key(e, "name") {
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
        Some(u) => usage_clause(u),
        None => String::new(),
    };
    let (_, trail) = duration_clauses(e.get("duration"));
    // A part's own control-lost duration leads it, with no objective marker before it for "it" to name.
    let trail = match trail.strip_suffix("control it") {
        Some(head) => format!("{head}control that objective marker"),
        None => trail.to_string(),
    };
    join_nonempty(&[&label, &moment, &usage, &named, &cost, &trail], ", ")
}

fn part_inline(e: &P, ctx: &Ctx) -> String {
    let head = part_head(e);
    let body = inline(child(e, "effect"), ctx);
    // An optional part whose effect already reads "you can ..." needs no "you can:" before it.
    if head.is_empty() || (head == "you can" && body.starts_with("you can ")) {
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
            if ty(inner) == "named-region-state"
                && nn(obj(inner.get("modifier")), "consumer").is_some()
            {
                return describe_named_region_conditional(
                    obj(inner.get("modifier")),
                    child(e, "condition"),
                    ctx,
                );
            }
            format!(
                "{}, {}",
                condition_lead_in_for(
                    child(e, "condition"),
                    is_defensive_effect(child(e, "effect"))
                ),
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
            dice_gate(e, ctx)
        }
        "roll" => format!(
            "{}; then {}",
            bind::roll_head(e),
            inline(child(e, "effect"), ctx)
        ),
        "select-objective" => bind::select_objective_inline(e, ctx),
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
        "stance-select" => {
            let consumable = if sv(e, "mode") == Some("consumable") {
                " (each may be chosen once per battle)"
            } else {
                ""
            };
            format!(
                "{}{}{}: {}",
                stance_pick(e),
                consumable,
                stance_additive(e),
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
            )
        }
        "stance-selection-capacity" => {
            let n = num(m.get("additional_selections"));
            let n = if n.is_nan() || n == 0.0 { 1.0 } else { n };
            let times = if n == 1.0 {
                "one additional time".to_string()
            } else {
                format!("{} additional times", fnum(n))
            };
            // A shared allowance narrowed to some options: spent on any one of them, not one of each.
            if sv(m, "allocation") != Some("fixed-option") {
                if let Some(options) = arr(m, "options") {
                    let names: Vec<String> = options
                        .iter()
                        .map(|option| title_case(&jstr(obj(Some(option)).get("option_id"))))
                        .collect();
                    return format!(
                        "you can select {} {times} per battle, shared between them",
                        crate::translate::condition::or_list(&names)
                    );
                }
            }
            let subject = match sv(obj(m.get("option")), "option_id") {
                Some(option) if sv(m, "allocation") == Some("fixed-option") => title_case(option),
                _ => format!("one option of {}", title_case(&jstr(m.get("ability_id")))),
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
        "issue-orders" if nn(e, "menu_from").is_some() => format!(
            "issue Orders from {}{}",
            ability_label(nn(e, "menu_from")),
            block::only_orders(e)
        ),
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
