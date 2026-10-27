//! Player-controlled gates as opt-in levers: a `timing-is` the context cannot pin down, each
//! `dice-pool-allocation` option, each `choice` branch, each named option and menu action.
//! Each lever reuses the leaf translators, and the conditions a branch still carries become
//! the buffs' `applicableWhen`. Mirrors the "Activatable-lever enumeration" section of
//! `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Map, Value};

use super::applicability::{
    apply_applicability, combine, condition_to_applicability, label_for_buffs, App,
};
use super::attack_scope::{is_weapon_scoped_condition, split_attack_scoped, walk_gated};
use super::conditions::evaluate_condition_for_source;
use super::js::*;
use super::{walk, Lever, Out, WalkOpts, STOCHASTIC_DICE_GATED};

/// Rolls inside every attack: a trigger on one applies to each attack it modifies.
fn evaluate_condition(condition: &Obj, opts: &WalkOpts) -> Option<bool> {
    evaluate_condition_for_source(
        condition,
        opts.context,
        opts.perspective,
        (!opts.granted_holder).then_some(opts.source_meta),
    )
}
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

/// Reported for a moment after the triggering unit's own attacks: it acts only on later attacks.
pub const POST_ATTACK_MOMENT: &str =
    "post-attack moment: applies only to attacks made after the triggering unit's";

/// Whether every alternative trigger fires just after the ability's own side resolved its attacks
/// (`attacks-resolved` with no subject, `this-unit`, `this-model` or a friendly filter). The attacks
/// that fire it are already resolved, so nothing it grants changes them.
pub fn is_post_own_attack_moment(trigger: &Value) -> bool {
    let triggers: Vec<&Obj> = match trigger {
        Value::Array(items) => items.iter().filter_map(Value::as_object).collect(),
        other => other.as_object().into_iter().collect(),
    };
    !triggers.is_empty()
        && triggers.iter().all(|item| {
            if !is_str(item, "event", "attacks-resolved") {
                return false;
            }
            match item.get("subject") {
                None | Some(Value::Null) => true,
                Some(Value::String(subject)) => subject == "this-unit" || subject == "this-model",
                Some(Value::Object(subject)) => is_str(subject, "owner", "friendly"),
                Some(_) => false,
            }
        })
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

/// Reserved metadata attached to synthetic conditional nodes. The TS implementation keeps this
/// in a WeakMap; Rust carries the trigger and canonical source fragment beside the temporary JSON
/// node so activation requirements survive the value-based walk without entering the public DSL.
const ACTIVATION_SOURCE: &str = "__activation_source";

fn activation_source(node: &Obj) -> Option<&Obj> {
    node.get(ACTIVATION_SOURCE).and_then(Value::as_object)
}

fn activation_trigger(node: &Obj) -> Option<&Value> {
    activation_source(node)?.get("trigger")
}

fn activation_fragment(node: &Obj) -> Option<&Obj> {
    activation_source(node)?
        .get("fragment")
        .and_then(Value::as_object)
}

fn activation_requirement(fragment: &Obj) -> Value {
    fn strip_defaults(value: &mut Value) {
        match value {
            Value::Array(items) => items.iter_mut().for_each(strip_defaults),
            Value::Object(object) => {
                object.values_mut().for_each(strip_defaults);
                if object.get("optional").and_then(Value::as_bool) == Some(false) {
                    object.remove("optional");
                }
            }
            _ => {}
        }
    }
    let mut requirement = Value::Object(fragment.clone());
    if let Some(requirement) = requirement.as_object_mut() {
        requirement.remove("effect");
    }
    strip_defaults(&mut requirement);
    requirement
}

/// Whether a conditional was synthesized from a trigger by [`moment_gate_with_source`].
fn synthetic_timing_gate(node: &Obj) -> bool {
    activation_source(node).is_some()
}

const ACTIVATION_TIMING: &str = "activation";

/// Replace only clock atoms whose activation lifetime has outlived that clock.
fn activation_condition(condition: &Obj, duration: Option<&Value>) -> Value {
    let expiry = duration.and_then(Value::as_str).unwrap_or_default();
    let spans_phases = matches!(
        expiry,
        "turn"
            | "battle-round"
            | "battle"
            | "permanent"
            | "while-leading"
            | "one-use"
            | "control-lost"
    ) || expiry.starts_with("until-");
    let clock = condition.get("type").and_then(Value::as_str);
    if spans_phases
        && (clock == Some("phase-is")
            || (clock == Some("player-turn-is") && expiry != "turn")
            || (clock == Some("battle-round") && expiry != "turn" && expiry != "battle-round"))
    {
        return json!({
            "type": "timing-is",
            "parameters": { "timing": ACTIVATION_TIMING },
        });
    }
    if condition.get("operator").is_some_and(Value::is_string) {
        if let Some(operands) = condition.get("operands").and_then(Value::as_array) {
            let mut rewritten = condition.clone();
            rewritten.insert(
                "operands".into(),
                Value::Array(
                    operands
                        .iter()
                        .map(|operand| {
                            operand.as_object().map_or_else(
                                || operand.clone(),
                                |operand| activation_condition(operand, duration),
                            )
                        })
                        .collect(),
                ),
            );
            return Value::Object(rewritten);
        }
    }
    Value::Object(condition.clone())
}

/// Conditions for one or more trigger alternatives. Attack-step conditions stay current;
/// activation clocks are rewritten only when the resulting effect outlives them.
fn moment_condition(trigger: Option<&Value>, duration: Option<&Value>) -> Option<Value> {
    let all: Vec<&Value> = match trigger {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(item) => vec![item],
        None => Vec::new(),
    };
    let triggers: Vec<&Obj> = all
        .into_iter()
        .filter_map(Value::as_object)
        .filter(|item| item.get("event").is_some_and(Value::is_string))
        .collect();
    if triggers.is_empty() {
        return None;
    }
    let mut gates = Vec::with_capacity(triggers.len());
    for item in triggers {
        let own = object(item.get("condition"));
        if is_attack_step(&Value::Object(item.clone())) {
            gates.push(Value::Object(own?.clone()));
            continue;
        }
        let moment = own_move_fact(item).unwrap_or_else(
            || json!({ "type": "timing-is", "parameters": { "timing": moment_key(item) } }),
        );
        gates.push(own.map_or(moment.clone(), |condition| {
            json!({
                "operator": "and",
                "operands": [moment, activation_condition(condition, duration)],
            })
        }));
    }
    Some(if gates.len() == 1 {
        gates.remove(0)
    } else {
        json!({ "operator": "or", "operands": gates })
    })
}

/// An effect gated on a trigger (one, or several alternatives) the way a `timing-is` gates it,
/// so the moment is a player-controlled gate. `None` when nothing gates the effect (the TS
/// function then returns the effect itself).
pub fn moment_gate(trigger: Option<&Value>, effect: &Value) -> Option<Value> {
    moment_gate_with_source(trigger, effect, None)
}

/// Internal variant of [`moment_gate`] which preserves the canonical source fragment used for
/// activation requirements. This mirrors the TS `activationSources` WeakMap.
pub(crate) fn moment_gate_with_source(
    trigger: Option<&Value>,
    effect: &Value,
    source_fragment: Option<&Obj>,
) -> Option<Value> {
    if effect.is_null() {
        return None;
    }
    let condition = moment_condition(trigger, None)?;
    let fragment = source_fragment.cloned().unwrap_or_else(|| {
        let mut fragment = Obj::new();
        fragment.insert("type".into(), Value::from("ability-part"));
        fragment.insert("trigger".into(), trigger.cloned().unwrap_or(Value::Null));
        fragment.insert("effect".into(), effect.clone());
        fragment
    });
    let mut gated = json!({ "type": "conditional", "condition": condition, "effect": effect });
    gated[ACTIVATION_SOURCE] = json!({
        "trigger": trigger.cloned().unwrap_or(Value::Null),
        "fragment": fragment,
    });
    Some(gated)
}

pub(super) fn conditional(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(condition) = object(node.get("condition")) else {
        return;
    };
    if is_weapon_scoped_condition(condition) {
        if let App::When(applicability) = condition_to_applicability(condition, opts.perspective) {
            walk_gated(
                node.get("effect").unwrap_or(&Value::Null),
                &applicability,
                opts,
                out,
            );
            return;
        }
    }
    if synthetic_timing_gate(node)
        && activation_trigger(node).is_some_and(is_post_own_attack_moment)
    {
        out.unsupported(
            POST_ATTACK_MOMENT,
            activation_fragment(node).unwrap_or(node),
        );
        return;
    }
    // An attack-scoped gate beside predicates on the units: the units decide whether the effect
    // applies at all, and the attack-scoped gate rides on its buffs.
    if !synthetic_timing_gate(node) {
        if let Some((applicability, rest)) = split_attack_scoped(condition, opts.perspective) {
            match evaluate_condition(&rest, opts) {
                Some(true) => {
                    walk_gated(
                        node.get("effect").unwrap_or(&Value::Null),
                        &applicability,
                        opts,
                        out,
                    );
                    return;
                }
                Some(false) => return,
                None => {}
            }
        }
    }
    let evaluated = if synthetic_timing_gate(node) {
        opts.duration
            .as_ref()
            .and_then(|duration| moment_condition(activation_trigger(node), Some(duration)))
            .unwrap_or_else(|| Value::Object(condition.clone()))
    } else {
        Value::Object(condition.clone())
    };
    let evaluated = evaluated
        .as_object()
        .expect("activation conditions are objects");
    match evaluate_condition(evaluated, opts) {
        None => {
            if condition_mentions_timing(condition) {
                enumerate_timing_gate(node, opts, out);
            } else {
                out.unsupported(
                    format!(
                        "conditional: cannot evaluate condition \"{}\" against current context",
                        js_string(
                            condition
                                .get("type")
                                .filter(|kind| !kind.is_null())
                                .or_else(|| condition.get("operator"))
                        )
                    ),
                    activation_fragment(node).unwrap_or(node),
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
    if let Some(reason) = super::recipient_snapshot_reason(node.get("trigger"), &effect) {
        out.unsupported(reason, node);
        return;
    }
    let activation = is_true(node, "optional")
        || present(node, "cost").is_some()
        || present(node, "trigger").is_some()
        || present(node, "usage").is_some();
    if !activation {
        walk(&effect, opts, out);
        return;
    }
    let body =
        if let Some(condition) = moment_condition(node.get("trigger"), opts.duration.as_ref()) {
            let condition_object = condition
                .as_object()
                .expect("activation conditions are objects");
            let verdict = evaluate_condition(condition_object, opts);
            if condition_mentions_timing(condition_object) && verdict != Some(false) {
                effect.clone()
            } else {
                json!({ "type": "conditional", "condition": condition, "effect": effect })
            }
        } else {
            effect.clone()
        };
    let requirements = Some(vec![activation_requirement(node)]);
    let mut sub = Out::default();
    walk(&body, opts, &mut sub);
    out.unsupported.extend(sub.unsupported);
    for mut lever in sub.activatable {
        if let Some(requirements) = &requirements {
            let mut combined = requirements.clone();
            combined.extend(lever.requires.take().unwrap_or_default());
            lever.requires = Some(combined);
        }
        out.activatable.push(lever);
    }
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
            requires: requirements,
            cap_raise: None,
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
        let buffs = gated_with_diagnostics(opt, opts, &mut out.unsupported);
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
    let buffs = gated_with_diagnostics(effect.unwrap_or(&Value::Null), opts, &mut out.unsupported);
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
        let buffs =
            gated_with_diagnostics(effect.unwrap_or(&Value::Null), opts, &mut out.unsupported);
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
pub(super) fn enumerate_menu_actions(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    for action in list(node.get("actions")) {
        let Some(a) = action.as_object() else {
            continue;
        };
        let eligibility = object(a.get("eligibility"));
        if let Some(filter) = eligibility.and_then(|eligibility| eligibility.get("filter")) {
            match super::conditions::matches_unit_filter(
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
        let mut buffs = Vec::new();
        collect_gated_buffs(
            a.get("effect").unwrap_or(&Value::Null),
            opts,
            &Obj::new(),
            &mut buffs,
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
    let requirement = activation_fragment(node).map(activation_requirement);
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
    if let Some(requirement) = &requirement {
        for mut lever in sub.activatable {
            let mut requirements = vec![requirement.clone()];
            requirements.extend(lever.requires.take().unwrap_or_default());
            lever.requires = Some(requirements);
            out.activatable.push(lever);
        }
    } else {
        out.activatable.extend(sub.activatable);
    }
    if !buffs.is_empty() {
        let timing = extract_timing(condition).unwrap_or_else(|| "timing".to_string());
        out.activatable.push(Lever {
            id: format!("{}@{timing}", opts.ability_id),
            label: label_for_buffs(&buffs),
            buffs,
            group: None,
            requires: requirement.map(|value| vec![value]),
            cap_raise: None,
        });
    }
}

/// The buffs a gate's body contributes, with no inherited applicability.
fn gated(node: &Value, opts: &WalkOpts) -> Vec<Value> {
    let mut diagnostics = Vec::new();
    gated_with_diagnostics(node, opts, &mut diagnostics)
}

fn gated_with_diagnostics(
    node: &Value,
    opts: &WalkOpts,
    diagnostics: &mut Vec<(String, Value)>,
) -> Vec<Value> {
    let mut buffs = Vec::new();
    collect_gated_buffs(node, opts, &Obj::new(), &mut buffs, diagnostics);
    buffs
}

/// Walk the body of a player gate, collecting the buffs it would contribute. Conditions defer
/// to `applicableWhen` where expressible; nested decisions and stochastic rolls are not modelled.
fn collect_gated_buffs(
    node: &Value,
    opts: &WalkOpts,
    app: &Obj,
    out_buffs: &mut Vec<Value>,
    diagnostics: &mut Vec<(String, Value)>,
) {
    let Some(n) = node.as_object() else {
        return;
    };
    match n.get("type").and_then(Value::as_str) {
        Some("conditional") => {
            let Some(condition) = object(n.get("condition")) else {
                return;
            };
            let effect = n.get("effect").unwrap_or(&Value::Null);
            match condition_to_applicability(condition, opts.perspective) {
                // A nested timing gate: opting into the activation satisfies it.
                App::Gate => collect_gated_buffs(effect, opts, app, out_buffs, diagnostics),
                // No declarative gate: descend only when the context says it is active.
                App::Context => match evaluate_condition(condition, opts) {
                    Some(true) => collect_gated_buffs(effect, opts, app, out_buffs, diagnostics),
                    None => diagnostics.push((
                        "activation condition cannot be evaluated against current context".into(),
                        Value::Object(activation_fragment(n).unwrap_or(n).clone()),
                    )),
                    Some(false) => {}
                },
                App::When(a) => {
                    collect_gated_buffs(effect, opts, &combine(app, &a), out_buffs, diagnostics)
                }
            }
        }
        Some("rules-bundle" | "sequence") => {
            for step in list(n.get("steps")) {
                collect_gated_buffs(step, opts, app, out_buffs, diagnostics);
            }
        }
        Some("ability-part") => {
            let mut part_opts = opts.clone();
            if let Some(duration) = present(n, "duration") {
                part_opts.duration = Some(duration.clone());
            }
            let activation = is_true(n, "optional")
                || present(n, "cost").is_some()
                || present(n, "usage").is_some();
            if present(n, "trigger").is_some() || !activation {
                let effect = n.get("effect").cloned().unwrap_or(Value::Null);
                let gated =
                    moment_gate_with_source(n.get("trigger"), &effect, Some(n)).unwrap_or(effect);
                collect_gated_buffs(&gated, &part_opts, app, out_buffs, diagnostics);
            }
        }
        // A decision or stochastic roll nested inside an activation is not modelled.
        Some("choice" | "dice-pool-allocation" | "dice-gated") => {}
        _ => {
            let mut tmp = Out::default();
            walk(node, opts, &mut tmp);
            diagnostics.extend(tmp.unsupported);
            for buff in tmp.applied {
                out_buffs.push(apply_applicability(buff, app));
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
