//! Player-controlled gates as opt-in levers: a `timing-is` the context cannot pin down, each
//! `dice-pool-allocation` option, each `choice` branch, each named option and menu action.
//! Each lever reuses the leaf translators, and the conditions a branch still carries become
//! the buffs' `applicableWhen`. Mirrors the "Activatable-lever enumeration" section of
//! `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Map, Value};

use super::applicability::{condition_to_applicability, label_for_buffs, App};
use super::attack_scope::{is_weapon_scoped_condition, split_attack_scoped, walk_gated};
use super::conditions::evaluate_condition_for_source;
use super::gated::{
    gated, offer_self_designated, offer_stance_gated, self_designation_gate, split_stance_option,
};
use super::js::*;
use super::{walk, Lever, Out, WalkOpts, STOCHASTIC_DICE_GATED};
use crate::cruncher::condition_facts::{condition_needs, ConditionNeed};

mod options;

pub(super) use options::{
    enumerate_choice, enumerate_dice_pool, enumerate_menu_actions, enumerate_named_options,
    enumerate_roll_allocation,
};

/// Rolls inside every attack: a trigger on one applies to each attack it modifies.
pub(super) fn evaluate_condition(condition: &Obj, opts: &WalkOpts) -> Option<bool> {
    evaluate_condition_for_source(
        condition,
        opts.context,
        opts.perspective,
        (!opts.granted_holder).then_some(opts.source_meta),
    )
}

/// The leaves of an undecided condition, as [`UnsupportedFragment::needs`]. A `timing-is` leaf
/// is the activation's own moment, which the player opts into as a lever, so it is never a need.
///
/// [`UnsupportedFragment::needs`]: super::UnsupportedFragment::needs
pub(super) fn undecided_needs(condition: &Obj, opts: &WalkOpts) -> Vec<ConditionNeed> {
    condition_needs(condition, opts.perspective, |node| {
        evaluate_condition(node, opts)
    })
    .into_iter()
    .filter(|need| !is_str(&need.condition, "type", "timing-is"))
    .collect()
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

pub(super) fn activation_fragment(node: &Obj) -> Option<&Obj> {
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

/// Timing conditions that, around a stance or order choice, say when the choice is made.
const SELECTION_WINDOW: [&str; 3] = ["phase-is", "player-turn-is", "battle-round"];

/// A stance or order choice's guard without its selection window. The phase, player turn and
/// battle round operands time the choice, and the chosen option lasts past them, so they do not
/// gate its effect; other operands still do. `None` when there is nothing to drop; `Some(None)`
/// when only the window was there. Mirrors TS `withoutSelectionWindow`.
fn without_selection_window(condition: &Obj, effect: Option<&Value>) -> Option<Option<Value>> {
    let kind = effect.and_then(|e| e.get("type")).and_then(Value::as_str);
    if !matches!(kind, Some("stance-select" | "issue-orders")) {
        return None;
    }
    fn operands(node: &Obj) -> Vec<&Obj> {
        match (
            node.get("operator").and_then(Value::as_str),
            node.get("operands").and_then(Value::as_array),
        ) {
            (Some("and"), Some(items)) => items
                .iter()
                .filter_map(Value::as_object)
                .flat_map(operands)
                .collect(),
            _ => vec![node],
        }
    }
    let every = operands(condition);
    let kept: Vec<Value> = every
        .iter()
        .filter(|operand| {
            !operand
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| SELECTION_WINDOW.contains(&kind))
        })
        .map(|operand| Value::Object((*operand).clone()))
        .collect();
    if kept.len() == every.len() {
        return None;
    }
    Some(match kept.len() {
        0 => None,
        1 => kept.into_iter().next(),
        _ => Some(json!({ "operator": "and", "operands": kept })),
    })
}

pub(super) fn conditional(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(condition) = object(node.get("condition")) else {
        return;
    };
    if let Some(guard) = without_selection_window(condition, node.get("effect")) {
        match guard {
            None => walk(node.get("effect").unwrap_or(&Value::Null), opts, out),
            Some(guard) => {
                let mut narrowed = node.clone();
                narrowed.insert("condition".to_string(), guard);
                conditional(&narrowed, opts, out);
            }
        }
        return;
    }
    if is_weapon_scoped_condition(condition) {
        if let App::When(applicability) =
            condition_to_applicability(condition, opts.perspective, opts.context.attacker_toughness)
        {
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
    // A designation the ability grants its own holders, undeclared by the context, is the
    // player's to ready.
    if let Some(tag) = self_designation_gate(condition, opts) {
        offer_self_designated(node, tag, opts, out);
        return;
    }
    // A gate on a stance option the context does not declare follows the player's stance pick.
    if opts.context.active_rules.is_none() {
        if let Some((gate, rest)) = split_stance_option(condition) {
            offer_stance_gated(node, gate, rest, opts, out);
            return;
        }
    }
    // An attack-scoped gate beside predicates on the units: the units decide whether the effect
    // applies at all, and the attack-scoped gate rides on its buffs.
    if !synthetic_timing_gate(node) {
        if let Some((applicability, rest)) =
            split_attack_scoped(condition, opts.perspective, opts.context.attacker_toughness)
        {
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
                out.unsupported.push((
                    format!(
                        "conditional: cannot evaluate condition \"{}\" against current context",
                        js_string(
                            condition
                                .get("type")
                                .filter(|kind| !kind.is_null())
                                .or_else(|| condition.get("operator"))
                        )
                    ),
                    Value::Object(activation_fragment(node).unwrap_or(node).clone()),
                    Some(undecided_needs(evaluated, opts)),
                ));
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
            gate: None,
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
        .extend(sub.unsupported.into_iter().filter(|(reason, fragment, _)| {
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
            gate: None,
        });
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
