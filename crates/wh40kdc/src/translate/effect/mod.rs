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
mod move_type;
mod orders;
mod placement;
mod quantity;
mod recipient_gate;
mod region;
mod ritual;
mod select;
mod subject;
pub(crate) mod words;

use ability::part_head;
pub use ability::{
    describe_ability, describe_ability_parts, describe_ability_parts_for,
    describe_ability_parts_with_optional, describe_ability_value_for,
    describe_ability_value_with_optional, describe_applies_to, describe_effect,
    describe_effect_inline, describe_effect_with_scope, describe_scope,
};

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::translate::condition::{
    condition_lead_in_for, is_defensive_effect, nn, obj, range_phrase, truthy, P,
};
use designation::*;
pub(crate) use dice::dice_table_result_label;
use dice::*;
use leaf::{describe_leaf, LEAF_TYPES};
pub(crate) use menu::usage_clause;
use menu::{menu_inline, scaling_clause};
use region::{describe_named_region_conditional, describe_named_region_state};
use select::*;
use words::*;
pub(crate) use words::{bracket_keyword, dice_case, resource_noun, title_case, weapon_noun};

const CONTAINER_TYPES: &[&str] = &[
    "roll",
    "select-objective",
    "ritual-menu",
    "move-type",
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
        return aura_role_filter(filter, origin, &[], ctx);
    };
    let side = if owner == "any" {
        String::new()
    } else {
        format!(" {owner}")
    };
    let mut all_list = map_arr(filter, "all_of", jv).unwrap_or_default();
    let none_list = map_arr(filter, "none_of", jv).unwrap_or_default();
    let mut any_list = map_arr(filter, "any_of", jv).unwrap_or_default();
    if any_list.iter().any(|k| all_list.contains(k)) {
        any_list.clear();
    } else if !none_list.is_empty() {
        any_list.retain(|k| !none_list.contains(k));
    }
    if any_list.len() == 1 {
        all_list.push(any_list.remove(0));
    }
    let keywords: String = all_list.iter().map(|k| format!(" {k}")).collect();
    let mut remaining = filter.clone();
    remaining.remove("owner");
    remaining.remove("all_of");
    remaining.remove("any_of");
    remaining.remove("none_of");
    if !any_list.is_empty() {
        remaining.insert(
            "any_of".into(),
            Value::Array(any_list.into_iter().map(Value::String).collect()),
        );
    }
    if !none_list.is_empty() {
        remaining.insert(
            "none_of".into(),
            Value::Array(none_list.into_iter().map(Value::String).collect()),
        );
    }
    aura_role_filter(
        &remaining,
        &format!("one or more{side}{keywords} models"),
        &all_list,
        ctx,
    )
}

fn aura_role_filter(filter: &P, noun: &str, already_all: &[String], ctx: &Ctx) -> String {
    let mut all_list: Vec<String> = already_all.to_vec();
    let mut extra_all = map_arr(filter, "all_of", jv).unwrap_or_default();
    all_list.extend(extra_all.iter().cloned());
    let none_list = map_arr(filter, "none_of", jv).unwrap_or_default();
    let mut any_list = map_arr(filter, "any_of", jv).unwrap_or_default();
    if any_list.iter().any(|k| all_list.contains(k)) {
        any_list.clear();
    } else if !none_list.is_empty() {
        any_list.retain(|k| !none_list.contains(k));
    }
    if any_list.len() == 1 {
        extra_all.push(any_list.remove(0));
    }
    let all = if extra_all.is_empty() {
        String::new()
    } else {
        format!(" with {}", extra_all.join(" and "))
    };
    let any = if any_list.is_empty() {
        String::new()
    } else {
        format!(
            " with the {} keyword",
            crate::translate::condition::or_list(&any_list)
        )
    };
    let none = if none_list.is_empty() {
        String::new()
    } else {
        format!(
            " (excluding {} models)",
            crate::translate::condition::or_list(&none_list)
        )
    };
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

/// Who an aura reaches and where: ("an enemy unit", "within 6\" of this unit").
pub(super) fn aura_reach(e: &P, m: &P, ctx: &Ctx) -> (String, String) {
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
        aura_role_filter(obj(m.get("recipient_filter")), &eligible_who, &[], ctx)
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
    let capped = nn(m, "range_cap")
        .map(|c| {
            format!(
                " (to a maximum of {}, extensions included)",
                range_phrase(Some(c))
            )
        })
        .unwrap_or_default();
    let wholly = if is_true(m, "wholly") { "wholly " } else { "" };
    (
        recipient,
        format!("{wholly}within {range_text}{capped} of {emitter}"),
    )
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
    let (recipient, within) = aura_reach(e, m, ctx);
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
    format!("while {recipient} is {within}, {effect_text}")
}

/// " (in addition to any already active)" when a stance pick joins the active options.
/// "or, instead of selecting, roll two D6: …": the pick rolled instead, each face applying the
/// option it numbers, or "".
fn stance_random(e: &P) -> String {
    let Some(random) = nn(e, "or_random").map(|value| obj(Some(value))) else {
        return String::new();
    };
    let faces: Vec<String> = items(random, "faces")
        .iter()
        .enumerate()
        .map(|(at, id)| {
            let id = id.as_str().unwrap_or_default();
            let name = items(e, "options")
                .iter()
                .map(|o| obj(Some(o)))
                .find(|o| sv(o, "id") == Some(id) && nn(o, "name").is_some())
                .map(|o| jstr(o.get("name")))
                .unwrap_or_else(|| title_case(id));
            format!("{} {name}", at + 1)
        })
        .collect();
    let count = match nn(random, "count").and_then(|value| value.as_f64()) {
        Some(n) if n == 1.0 => "one".to_string(),
        Some(n) if n == 2.0 => "two".to_string(),
        Some(n) if n == 3.0 => "three".to_string(),
        _ => jstr(random.get("count")),
    };
    format!(
        "or, instead of selecting, roll {count} {}: each result applies the option it numbers ({}); a result already active has no additional effect",
        jstr(random.get("dice")),
        faces.join(", ")
    )
}

fn stance_additive(e: &P) -> &'static str {
    if is_true(e, "additive") {
        " (in addition to any already active)"
    } else {
        ""
    }
}

/// "at the start of the battle, Aegis Protocol is active": the option in force before any
/// selection, or "".
fn stance_initial(e: &P) -> String {
    let Some(initial) = sv(e, "initial") else {
        return String::new();
    };
    let name = items(e, "options")
        .iter()
        .map(|o| obj(Some(o)))
        .find(|o| sv(o, "id") == Some(initial) && nn(o, "name").is_some())
        .map(|o| jstr(o.get("name")))
        .unwrap_or_else(|| title_case(initial));
    format!("at the start of the battle, {name} is active")
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

/// "secondary effect (extra CP): " before the option a choice marks as the Stratagem's secondary effect.
pub(super) fn secondary_lead(e: &P, index: usize) -> &'static str {
    match e.get("secondary_option").and_then(Value::as_f64) {
        Some(n) if n == index as f64 => "secondary effect (extra CP): ",
        _ => "",
    }
}

/// The prompt of a choice, with the player who picks: the opponent when `chosen_by` says so.
fn choice_prompt(e: &P) -> String {
    let own = own_choice_prompt(e);
    if sv(e, "chosen_by") != Some("opponent") {
        return own;
    }
    if let Some(rest) = own.strip_prefix("choose ") {
        return format!("your opponent chooses {rest}");
    }
    match own.strip_prefix("select ") {
        Some(rest) => format!("your opponent selects {rest}"),
        None => format!("your opponent: {own}"),
    }
}

fn own_choice_prompt(e: &P) -> String {
    if let Some(p) = sv(e, "choice_prompt").filter(|p| !p.trim().is_empty()) {
        return p.to_string();
    }
    let raw_label = sv(e, "choice_label")
        .filter(|l| !l.is_empty())
        .map(title_case)
        .unwrap_or_default();
    let label = if !raw_label.is_empty() && raw_label.to_lowercase() != "one of the following" {
        format!(" ({raw_label})")
    } else {
        String::new()
    };
    if let (Some(min), Some(max)) = (nn(e, "min_choices"), nn(e, "max_choices")) {
        if min.as_f64() == Some(1.0) && max.as_f64() == Some(1.0) {
            return format!("choose one of the following{label}");
        }
        let quantity = if min.as_f64() == max.as_f64() {
            jv(max)
        } else if min.as_f64() == Some(0.0) {
            format!("up to {}", jv(max))
        } else {
            format!("{} to {}", jv(min), jv(max))
        };
        return format!("choose {quantity} of the following{label}");
    }
    format!("choose one of the following{label}")
}

/// Whether an ability-part's own trigger already names a destruction or allocation event.
pub(super) fn part_trigger_ctx(e: &P, ctx: &Ctx) -> Ctx {
    let ts = menu::normalize_triggers(e.get("trigger"));
    let destroyed = ts.iter().any(|t| {
        matches!(
            t.get("event").and_then(Value::as_str),
            Some("destroyed" | "model-destroyed")
        )
    });
    let allocated = ts
        .iter()
        .any(|t| t.get("event").and_then(Value::as_str) == Some("damage-allocated"));
    if !destroyed && !allocated {
        return ctx.clone();
    }
    let mut out = ctx.clone();
    if destroyed {
        out.destroyed_trigger = true;
    }
    if allocated {
        out.allocated_trigger = true;
    }
    out
}
/// A part with its own trigger: its effect's event refs read as that trigger's model, if it names one.
pub(super) fn part_with_model_refs(e: &P) -> P {
    let triggers = menu::normalize_triggers(e.get("trigger"));
    let mut part = e.clone();
    if !triggers.is_empty() {
        if let Some(effect) = e.get("effect").filter(|v| !v.is_null()) {
            part.insert(
                "effect".into(),
                crate::translate::condition::model_event_refs(effect, &triggers),
            );
        }
    }
    part
}

fn part_inline(e: &P, ctx: &Ctx) -> String {
    let e = &part_with_model_refs(e);
    let child_ctx = part_trigger_ctx(e, ctx);
    let head = part_head(e);
    let body = inline(child(e, "effect"), &child_ctx);
    // An optional part whose effect already reads "you can ..." needs no "you can:" before it.
    if head.is_empty() || (head == "you can" && body.starts_with("you can ")) {
        body
    } else if head.ends_with("you can use this ability") {
        format!("{head}: {body}")
    } else if !truthy_key(e, "name") && !head.ends_with("you can") {
        format!("{head}, {body}")
    } else {
        format!("{head}: {body}")
    }
}

/// Flatten nested `conditional(c1, conditional(c2, inner))` when neither is a `recipient_gate`.
pub(super) fn flatten_conditional(e: &P, ctx: &Ctx) -> (Value, Value) {
    let mut conds: Vec<Value> = Vec::new();
    let mut cur_val = Value::Object(e.clone());
    loop {
        let cur = obj(Some(&cur_val));
        if ty(cur) != "conditional"
            || nn(cur, "condition").is_none()
            || nn(cur, "effect").is_none()
            || recipient_gate::recipient_gate(cur, ctx).is_some()
        {
            break;
        }
        conds.push(nn(cur, "condition").unwrap().clone());
        cur_val = nn(cur, "effect").unwrap().clone();
    }
    if conds.is_empty() {
        return (child(e, "condition").clone(), child(e, "effect").clone());
    }
    let condition = if conds.len() == 1 {
        conds.remove(0)
    } else {
        serde_json::json!({ "operator": "and", "operands": conds })
    };
    (condition, cur_val)
}

/// Extract bare `ranged` / `melee` attack_type from a condition so nested leaves don't repeat it.
pub(super) fn attack_type_from_condition(c: &Value) -> Option<&'static str> {
    let c = c.as_object()?;
    if sv(c, "operator") == Some("and") {
        if let Some(ops) = arr(c, "operands") {
            for op in ops {
                if let Some(found) = attack_type_from_condition(op) {
                    return Some(found);
                }
            }
        }
        return None;
    }
    if sv(c, "type") == Some("attack-is") {
        let params = obj(c.get("parameters"));
        if nn(params, "weapons").is_none() {
            return match sv(params, "attack_type") {
                Some("ranged") => Some("ranged"),
                Some("melee") => Some("melee"),
                _ => None,
            };
        }
    }
    None
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
            if let Some(g) = recipient_gate::recipient_gate(e, ctx) {
                return format!("{}, {}", g.lead, inline(&g.inner, &g.ctx));
            }
            let (cond, eff) = flatten_conditional(e, ctx);
            let child_ctx = match attack_type_from_condition(&cond) {
                Some(t) => Ctx {
                    suppress_weapon_type: Some(t.to_string()),
                    ..ctx.clone()
                },
                None => ctx.clone(),
            };
            format!(
                "{}, {}",
                condition_lead_in_for(&cond, is_defensive_effect(&eff)),
                inline(&eff, &child_ctx)
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
                .enumerate()
                .map(|(i, o)| format!("{}{}", secondary_lead(e, i), inline(o, ctx)))
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
        "ritual-menu" => ritual::ritual_menu_inline(e, ctx),
        "move-type" => move_type::move_type_inline(e, ctx),
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
                "for each {}{}: {}",
                for_each_unit_subject(sel),
                for_each_cap(nn(e, "max_affected")),
                inline(child(e, "effect"), &each_context(ctx, sel))
            )
        }
        "designate-target" => designate_target_inline(e, ctx),
        "stance-select" => {
            let consumable = if sv(e, "mode") == Some("consumable") {
                " (each can be chosen once per battle)"
            } else {
                ""
            };
            let initial = stance_initial(e);
            let random = stance_random(e);
            format!(
                "{}{}{}{}: {}{}",
                if initial.is_empty() {
                    String::new()
                } else {
                    format!("{initial}; ")
                },
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
                    .join(" / "),
                if random.is_empty() {
                    String::new()
                } else {
                    format!("; {random}")
                }
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
                _ => format!("one option of {}", ability_label(m.get("ability_id"))),
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
        "issue-orders" if e.get("same_order") == Some(&Value::Bool(true)) => format!(
            "issue the same Order to another eligible unit{}{}",
            block::order_limit(e),
            orders::as_if_phase(e)
        ),
        "issue-orders" if nn(e, "menu_from").is_some() => format!(
            "issue Orders from {}{}{}{}{}",
            ability_label(nn(e, "menu_from")),
            block::order_recipient(e),
            block::only_orders(e),
            block::order_limit(e),
            orders::as_if_phase(e)
        ),
        "issue-orders" => format!(
            "issue Orders{}{}, each one of: {}",
            block::order_recipient(e),
            block::order_limit(e),
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
