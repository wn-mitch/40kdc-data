//! Player decisions enumerated as levers: each `choice` branch, each `dice-pool-allocation`
//! option (and a roll allocated like one), each named option, and each menu action. Mirrors the
//! option enumerators in the "Activatable-lever enumeration" section of
//! `tools/src/cruncher/from-dsl.ts`.

use serde_json::Value;

use super::super::applicability::label_for_buffs;
use super::super::gated::collect_option_buffs;
use super::super::js::*;
use super::super::{Lever, Out, WalkOpts};
use super::evaluate_condition;

/// `typeof n === "number" ? n : fallback` as an activation cap.
fn cap(v: Option<&Value>, fallback: i64) -> i64 {
    v.and_then(Value::as_f64).map_or(fallback, |n| n as i64)
}

/// One lever per buff-bearing choice, sharing the choice's selection cap.
pub(in crate::cruncher::from_dsl) fn enumerate_choice(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let max = cap(node.get("max_choices"), 1);
    for (i, opt) in list(node.get("options")).iter().enumerate() {
        let (buffs, gate) = collect_option_buffs(opt, opts, &mut out.unsupported);
        if buffs.is_empty() {
            continue;
        }
        out.activatable.push(Lever {
            id: format!("{}?{i}", opts.ability_id),
            label: label_for_buffs(&buffs),
            buffs,
            group: Some((format!("{}?choice", opts.ability_id), max)),
            requires: None,
            cap_raise: None,
            gate,
        });
    }
}

/// One lever per buff-bearing dice-pool option, capped by `max_activations`.
pub(in crate::cruncher::from_dsl) fn enumerate_dice_pool(
    node: &Obj,
    opts: &WalkOpts,
    out: &mut Out,
) {
    let options = list(node.get("options"));
    let max = cap(node.get("max_activations"), options.len() as i64);
    for opt in options {
        let Some(o) = opt.as_object() else {
            continue;
        };
        push_named(
            o.get("effect"),
            o.get("name"),
            opts,
            out,
            &opts.ability_id,
            max,
        );
    }
}

fn push_named(
    effect: Option<&Value>,
    name: Option<&Value>,
    opts: &WalkOpts,
    out: &mut Out,
    group: &str,
    max: i64,
) {
    let (buffs, gate) =
        collect_option_buffs(effect.unwrap_or(&Value::Null), opts, &mut out.unsupported);
    if buffs.is_empty() {
        return;
    }
    let name = name
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .map_or_else(|| label_for_buffs(&buffs), str::to_string);
    out.activatable.push(Lever {
        id: format!("{}#{name}", opts.ability_id),
        label: name,
        buffs,
        group: Some((group.to_string(), max)),
        requires: None,
        cap_raise: None,
        gate,
    });
}

/// A `roll` whose nested effect is a choice of dice gates on that roll (`from` +
/// `requirement`): the same levers a dice-pool allocation emits. `false` when it is not one.
pub(in crate::cruncher::from_dsl) fn enumerate_roll_allocation(
    node: &Obj,
    opts: &WalkOpts,
    out: &mut Out,
) -> bool {
    let Some(choice) = object(node.get("effect")) else {
        return false;
    };
    let Some(options) = choice.get("options").and_then(Value::as_array) else {
        return false;
    };
    if !is_str(choice, "type", "choice") {
        return false;
    }
    let mut gates = Vec::new();
    for opt in options {
        let part = opt
            .as_object()
            .filter(|o| is_str(o, "type", "ability-part"));
        let gate = match part {
            Some(p) => p.get("effect"),
            None => Some(opt),
        };
        let gate = gate.and_then(Value::as_object).filter(|g| {
            is_str(g, "type", "dice-gated")
                && present(g, "requirement").is_some()
                && object(g.get("from")).is_some_and(|f| f.get("roll_var") == node.get("roll_var"))
        });
        let Some(gate) = gate else {
            return false;
        };
        let name = part.and_then(|p| p.get("name")).filter(|n| n.is_string());
        gates.push((name, gate.get("on_success")));
    }
    let max = cap(choice.get("max_choices"), 1);
    for (name, effect) in gates {
        let (buffs, gate) =
            collect_option_buffs(effect.unwrap_or(&Value::Null), opts, &mut out.unsupported);
        if buffs.is_empty() {
            continue;
        }
        let name = name
            .and_then(Value::as_str)
            .map_or_else(|| label_for_buffs(&buffs), str::to_string);
        out.activatable.push(Lever {
            id: format!("{}#{name}", opts.ability_id),
            label: name,
            buffs,
            group: Some((opts.ability_id.to_owned(), max)),
            requires: None,
            cap_raise: None,
            gate,
        });
    }
    true
}

/// One opt-in lever per buff-bearing named option (stance-select / issue-orders).
pub(in crate::cruncher::from_dsl) fn enumerate_named_options(
    node: &Obj,
    opts: &WalkOpts,
    out: &mut Out,
    group: &str,
    max: i64,
) {
    for opt in list(node.get("options")) {
        let Some(o) = opt.as_object() else {
            continue;
        };
        if is_str(node, "type", "stance-select") {
            let Some(id) = o.get("id").and_then(Value::as_str) else {
                out.unsupported("stance-select: option lacks its stable id", o);
                continue;
            };
            let before = out.activatable.len();
            push_named(o.get("effect"), o.get("name"), opts, out, group, max);
            if out.activatable.len() > before {
                out.activatable[before].id = format!("{}#{id}", opts.ability_id);
            }
        } else {
            push_named(o.get("effect"), o.get("name"), opts, out, group, max);
        }
    }
}

/// Canonical menu actions retain their costs, timing and shared capacity requirements.
pub(in crate::cruncher::from_dsl) fn enumerate_menu_actions(
    node: &Obj,
    opts: &WalkOpts,
    out: &mut Out,
) {
    for action in list(node.get("actions")) {
        let Some(a) = action.as_object() else {
            continue;
        };
        let eligibility = object(a.get("eligibility"));
        if let Some(filter) = eligibility.and_then(|eligibility| eligibility.get("filter")) {
            match super::super::conditions::matches_unit_filter(
                filter,
                opts.context,
                opts.perspective,
                "friendly",
            ) {
                Some(false) => continue,
                None => {
                    out.unsupported("resource-action-menu eligibility filter is unresolved", a);
                    continue;
                }
                Some(true) => {}
            }
        }
        if list(eligibility.and_then(|eligibility| eligibility.get("requires")))
            .iter()
            .filter_map(Value::as_object)
            .any(|condition| evaluate_condition(condition, opts) == Some(false))
        {
            continue;
        }
        let Some(id) = a
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            out.unsupported("resource-action-menu action has no stable id", a);
            continue;
        };
        let (buffs, gate) = collect_option_buffs(
            a.get("effect").unwrap_or(&Value::Null),
            opts,
            &mut out.unsupported,
        );
        if buffs.is_empty() {
            continue;
        }
        let label = a
            .get("label")
            .and_then(Value::as_str)
            .filter(|label| !label.is_empty())
            .map_or_else(|| label_for_buffs(&buffs), str::to_string);
        let mut action = a.clone();
        action.remove("effect");
        let mut requirements: Obj = ["menu_id", "pool_id", "shared_usage", "capacity"]
            .into_iter()
            .filter_map(|key| node.get(key).map(|value| (key.into(), value.clone())))
            .collect();
        requirements.insert("action".into(), Value::Object(action));
        let group = node
            .get("shared_usage")
            .and_then(|usage| usage.get("unit_max_manoeuvres_per_phase"))
            .and_then(Value::as_i64)
            .map(|max| (format!("{}?menu", opts.ability_id), max));
        out.activatable.push(Lever {
            id: format!("{}#{id}", opts.ability_id),
            label,
            buffs,
            group,
            requires: Some(vec![Value::Object(requirements)]),
            cap_raise: None,
            gate,
        });
    }
}
