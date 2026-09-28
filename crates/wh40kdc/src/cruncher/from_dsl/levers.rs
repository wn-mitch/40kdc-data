//! Player-controlled gates as opt-in levers: a `timing-is` the context cannot pin down, each
//! `dice-pool-allocation` option, each `choice` branch, each named option and menu action.
//! Each lever reuses the leaf translators, and the conditions a branch still carries become
//! the buffs' `applicableWhen`. Mirrors the "Activatable-lever enumeration" section of
//! `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Map, Value};

use super::applicability::{
    apply_applicability, combine, condition_to_applicability, label_for_buffs, App,
};
use super::conditions::evaluate_condition;
use super::js::*;
use super::{walk, Lever, Out, WalkOpts, STOCHASTIC_DICE_GATED};

/// Rolls inside every attack: a trigger on one applies to each attack it modifies.
fn attack_step_roll(roll: &str) -> bool {
    matches!(roll, "hit" | "wound" | "save" | "damage")
}

/// A trigger on a step of every attack (a hit, wound, save or damage roll, or allocating damage).
pub fn is_attack_step(trigger: &Value) -> bool {
    let Some(t) = trigger.as_object() else {
        return false;
    };
    if is_str(t, "event", "damage-allocated") {
        return true;
    }
    let roll = object(t.get("filter"))
        .and_then(|f| f.get("roll"))
        .and_then(Value::as_str);
    (is_str(t, "event", "before-roll") || is_str(t, "event", "after-roll"))
        && roll.is_some_and(attack_step_roll)
}

/// The lever key of a trigger: its event family and the filter value that tells moments apart.
pub fn moment_key(trigger: &Map<String, Value>) -> String {
    let empty = Obj::new();
    let f = object(trigger.get("filter")).unwrap_or(&empty);
    let moves = f.get("move_types").and_then(Value::as_array).map(|m| {
        Value::from(
            m.iter()
                .map(|x| js_string(Some(x)))
                .collect::<Vec<_>>()
                .join("+"),
        )
    });
    let detail = [
        f.get("to").cloned(),
        f.get("kind").cloned(),
        f.get("roll").cloned(),
        moves,
        f.get("from").cloned(),
    ]
    .into_iter()
    .flatten()
    .find_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_string));
    let event = js_string(trigger.get("event"));
    match detail {
        Some(d) => format!("{event}:{d}"),
        None => event,
    }
}

/// The unit's own move the engine context records: a Charge move is "charged this turn".
fn own_move_fact(trigger: &Obj) -> Option<Value> {
    if !is_str(trigger, "event", "move-ended") {
        return None;
    }
    if present(trigger, "subject").is_some() && !is_str(trigger, "subject", "this-unit") {
        return None;
    }
    let types = list(object(trigger.get("filter")).and_then(|f| f.get("move_types")));
    match types {
        [only] if matches!(only.as_str(), Some("charge" | "advance")) => Some(json!({
            "type": "happened",
            "parameters": { "event": "move-ended", "filter": { "move_types": types }, "window": "turn" },
        })),
        _ => None,
    }
}

/// An effect gated on a trigger (one, or several alternatives) the way a `timing-is` gates it,
/// so the moment is a player-controlled gate. `None` when nothing gates the effect (the TS
/// function then returns the effect itself).
pub fn moment_gate(trigger: Option<&Value>, effect: &Value) -> Option<Value> {
    if effect.is_null() {
        return None;
    }
    let all: Vec<&Value> = match trigger {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(t) => vec![t],
        None => Vec::new(),
    };
    let triggers: Vec<&Obj> = all
        .into_iter()
        .filter_map(Value::as_object)
        .filter(|t| t.get("event").is_some_and(Value::is_string))
        .collect();
    if triggers.is_empty() {
        return None;
    }
    let mut gates = Vec::new();
    for t in &triggers {
        let own = object(t.get("condition")).map(|c| Value::Object(c.clone()));
        if is_attack_step(&Value::Object((*t).clone())) {
            // Met by every attack: only its own condition gates the effect.
            gates.push(own?);
            continue;
        }
        // A unit's own Charge or Advance move is a fact the context carries, not a choice.
        let moment = own_move_fact(t).unwrap_or_else(
            || json!({ "type": "timing-is", "parameters": { "timing": moment_key(t) } }),
        );
        gates.push(match own {
            Some(own) => json!({ "operator": "and", "operands": [moment, own] }),
            None => moment,
        });
    }
    let condition = if gates.len() == 1 {
        gates.remove(0)
    } else {
        json!({ "operator": "or", "operands": gates })
    };
    Some(json!({ "type": "conditional", "condition": condition, "effect": effect }))
}

pub(super) fn conditional(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(condition) = object(node.get("condition")) else {
        return;
    };
    match evaluate_condition(condition, opts.context) {
        None => {
            // A timing the player controls is an activation, not a wall.
            if condition_mentions_timing(condition) {
                enumerate_timing_gate(node, opts, out);
            } else {
                out.unsupported(
                    format!(
                        "conditional: cannot evaluate condition \"{}\" against current context",
                        js_string(condition.get("type"))
                    ),
                    node,
                );
            }
        }
        Some(true) => walk(node.get("effect").unwrap_or(&Value::Null), opts, out),
        Some(false) => {}
    }
}

/// A named rule is transparent unless using it requires an activation.
pub(super) fn named_effect(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let effect = node.get("effect").cloned().unwrap_or(Value::Null);
    let activation = is_true(node, "optional")
        || present(node, "cost").is_some()
        || present(node, "trigger").is_some()
        || present(node, "usage").is_some();
    if !activation {
        walk(&effect, opts, out);
        return;
    }
    let triggers: Vec<&Value> = match node.get("trigger") {
        Some(Value::Array(a)) => a.iter().collect(),
        None | Some(Value::Null) => Vec::new(),
        Some(t) => vec![t],
    };
    let conditions: Vec<Value> = triggers
        .iter()
        .filter_map(|t| t.as_object())
        .filter_map(|t| t.get("condition").filter(|c| c.is_object()).cloned())
        .collect();
    let body = if !conditions.is_empty() && conditions.len() == triggers.len() {
        let condition = if conditions.len() == 1 {
            conditions[0].clone()
        } else {
            json!({ "operator": "or", "operands": conditions })
        };
        json!({ "type": "conditional", "condition": condition, "effect": effect })
    } else {
        effect
    };
    let mut sub = Out::default();
    walk(&body, opts, &mut sub);
    out.unsupported.extend(sub.unsupported);
    out.activatable.extend(sub.activatable);
    if !sub.applied.is_empty() {
        let name = node
            .get("name")
            .and_then(Value::as_str)
            .map_or_else(|| label_for_buffs(&sub.applied), str::to_string);
        out.activatable.push(Lever {
            id: format!("{}#{name}", opts.ability_id),
            label: name,
            buffs: sub.applied,
            group: None,
        });
    }
}

/// `typeof n === "number" ? n : fallback` as an activation cap.
fn cap(v: Option<&Value>, fallback: i64) -> i64 {
    v.and_then(Value::as_f64).map_or(fallback, |n| n as i64)
}

/// One lever per buff-bearing choice, sharing the choice's selection cap.
pub(super) fn enumerate_choice(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let max = cap(node.get("max_choices"), 1);
    for (i, opt) in list(node.get("options")).iter().enumerate() {
        let buffs = gated(opt, opts);
        if buffs.is_empty() {
            continue;
        }
        out.activatable.push(Lever {
            id: format!("{}?{i}", opts.ability_id),
            label: label_for_buffs(&buffs),
            buffs,
            group: Some((format!("{}?choice", opts.ability_id), max)),
        });
    }
}

/// One lever per buff-bearing dice-pool option, capped by `max_activations`.
pub(super) fn enumerate_dice_pool(node: &Obj, opts: &WalkOpts, out: &mut Out) {
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
    let buffs = gated(effect.unwrap_or(&Value::Null), opts);
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
    });
}

/// A `roll` whose nested effect is a choice of dice gates on that roll (`from` +
/// `requirement`): the same levers a dice-pool allocation emits. `false` when it is not one.
pub(super) fn enumerate_roll_allocation(node: &Obj, opts: &WalkOpts, out: &mut Out) -> bool {
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
        let buffs = gated(effect.unwrap_or(&Value::Null), opts);
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
            group: Some((opts.ability_id.clone(), max)),
        });
    }
    true
}

/// One opt-in lever per buff-bearing named option (stance-select / issue-orders).
pub(super) fn enumerate_named_options(
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
        push_named(o.get("effect"), o.get("name"), opts, out, group, max);
    }
}

/// One independent lever per buff-bearing `resource-action-menu` action (no shared cap).
pub(super) fn enumerate_menu_actions(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    for action in list(node.get("actions")) {
        let Some(a) = action.as_object() else {
            continue;
        };
        let required = object(a.get("eligibility")).map(|e| list(e.get("requires_keyword")));
        let mut app = Obj::new();
        if let Some([only]) = required {
            if let Some(k) = only.as_str() {
                app.insert("requiresAttackerKeyword".into(), Value::from(k));
            }
        }
        let mut buffs = Vec::new();
        collect_gated_buffs(
            a.get("effect").unwrap_or(&Value::Null),
            opts,
            &app,
            &mut buffs,
        );
        if buffs.is_empty() {
            continue;
        }
        let label = a
            .get("label")
            .and_then(Value::as_str)
            .filter(|l| !l.is_empty())
            .map_or_else(|| label_for_buffs(&buffs), str::to_string);
        let id = a
            .get("id")
            .and_then(Value::as_str)
            .filter(|i| !i.is_empty())
            .map_or_else(|| label.clone(), str::to_string);
        out.activatable.push(Lever {
            id: format!("{}#{id}", opts.ability_id),
            label,
            buffs,
            group: None,
        });
    }
}

/// A timing-gated activation: inner decisions pass through as their own levers, inner
/// always-on buffs bundle into one lever gated only on the timing.
fn enumerate_timing_gate(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(condition) = object(node.get("condition")) else {
        return;
    };
    let effect = node.get("effect").unwrap_or(&Value::Null);
    let buffs = gated(effect, opts);
    let mut sub = Out::default();
    walk(effect, opts, &mut sub);
    // A stochastic branch contributes nothing to a timing activation.
    out.unsupported
        .extend(sub.unsupported.into_iter().filter(|(reason, fragment)| {
            reason != STOCHASTIC_DICE_GATED
                || !fragment
                    .as_object()
                    .is_some_and(|f| is_str(f, "type", "dice-gated"))
        }));
    out.activatable.extend(sub.activatable);
    if !buffs.is_empty() {
        let timing = extract_timing(condition).unwrap_or_else(|| "timing".to_string());
        out.activatable.push(Lever {
            id: format!("{}@{timing}", opts.ability_id),
            label: label_for_buffs(&buffs),
            buffs,
            group: None,
        });
    }
}

/// The buffs a gate's body contributes, with no inherited applicability.
fn gated(node: &Value, opts: &WalkOpts) -> Vec<Value> {
    let mut buffs = Vec::new();
    collect_gated_buffs(node, opts, &Obj::new(), &mut buffs);
    buffs
}

/// Walk the body of a player gate, collecting the buffs it would contribute. Conditions defer
/// to `applicableWhen` where expressible; nested decisions and stochastic rolls are not modelled.
fn collect_gated_buffs(node: &Value, opts: &WalkOpts, app: &Obj, out_buffs: &mut Vec<Value>) {
    let Some(n) = node.as_object() else {
        return;
    };
    match n.get("type").and_then(Value::as_str) {
        Some("conditional") => {
            let Some(condition) = object(n.get("condition")) else {
                return;
            };
            let effect = n.get("effect").unwrap_or(&Value::Null);
            match condition_to_applicability(condition) {
                // A nested timing gate: opting into the activation satisfies it.
                App::Gate => collect_gated_buffs(effect, opts, app, out_buffs),
                // No declarative gate: descend only when the context says it is active.
                App::Context => {
                    if evaluate_condition(condition, opts.context) == Some(true) {
                        collect_gated_buffs(effect, opts, app, out_buffs);
                    }
                }
                App::When(a) => collect_gated_buffs(effect, opts, &combine(app, &a), out_buffs),
            }
        }
        Some("rules-bundle" | "sequence") => {
            for step in list(n.get("steps")) {
                collect_gated_buffs(step, opts, app, out_buffs);
            }
        }
        Some("ability-part") => {
            let activation = is_true(n, "optional")
                || present(n, "cost").is_some()
                || present(n, "usage").is_some();
            if present(n, "trigger").is_some() || !activation {
                let effect = n.get("effect").cloned().unwrap_or(Value::Null);
                let gated = moment_gate(n.get("trigger"), &effect).unwrap_or(effect);
                collect_gated_buffs(&gated, opts, app, out_buffs);
            }
        }
        // A decision or stochastic roll nested inside an activation is not modelled.
        Some("choice" | "dice-pool-allocation" | "dice-gated") => {}
        _ => {
            let mut tmp = Out::default();
            walk(node, opts, &mut tmp);
            for b in tmp.applied {
                out_buffs.push(apply_applicability(b, app));
            }
        }
    }
}

/// Does this condition (or any operand) gate on a player-controlled timing?
fn condition_mentions_timing(condition: &Obj) -> bool {
    if is_str(condition, "type", "timing-is") {
        return true;
    }
    if condition.get("operator").is_some_and(Value::is_string) {
        if let Some(ops) = condition.get("operands").and_then(Value::as_array) {
            return ops
                .iter()
                .any(|o| o.as_object().is_some_and(condition_mentions_timing));
        }
    }
    false
}

/// The first `timing-is` timing value in a (possibly compound) condition.
fn extract_timing(condition: &Obj) -> Option<String> {
    if is_str(condition, "type", "timing-is") {
        return object(condition.get("parameters"))
            .and_then(|p| p.get("timing"))
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    list(condition.get("operands"))
        .iter()
        .filter_map(Value::as_object)
        .find_map(|o| extract_timing(o).filter(|t| !t.is_empty()))
}
