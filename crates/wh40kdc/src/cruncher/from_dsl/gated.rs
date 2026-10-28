//! The buffs the body of a player gate contributes, and the stance options gating them. A
//! `rule-active` gate (or its negation) on a stance option the context's `active_rules` does not
//! declare follows the player's stance pick, so what it gives becomes a lever requiring (or
//! excluding) that option. Mirrors
//! `collectGatedBuffs`, `collectOptionBuffs`, `splitStanceOption` and `offerStanceGated` in
//! `tools/src/cruncher/from-dsl.ts`.

use std::collections::BTreeSet;

use serde_json::Value;

use super::applicability::{
    apply_applicability, combine, condition_to_applicability, label_for_buffs, App,
};
use super::js::*;
use super::levers::{activation_fragment, evaluate_condition, moment_gate_with_source};
use super::{walk, Lever, Out, StanceOptionRef, WalkOpts};

const MIXED_STANCE_REASON: &str = "activation mixes stance-gated buffs with other buffs";

/// A gate on a stance option: it holds while the option is picked, or, `negated`, while it is not.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StanceGate {
    pub(crate) option: StanceOptionRef,
    pub(crate) negated: bool,
}

/// A condition that is, or is an `and` with exactly one top-level operand that is, `rule-active`
/// on a stance option or its single-operand `not`; the second value holds the other operands.
pub(super) fn split_stance_option(condition: &Obj) -> Option<(StanceGate, Option<Value>)> {
    fn option_of(operand: &Value) -> Option<StanceOptionRef> {
        let operand = operand.as_object()?;
        if !is_str(operand, "type", "rule-active") {
            return None;
        }
        let rule = object(object(operand.get("parameters"))?.get("rule"))?;
        Some(StanceOptionRef {
            ability_id: rule.get("ability_id")?.as_str()?.to_owned(),
            option_id: rule.get("option_id")?.as_str()?.to_owned(),
        })
    }
    fn gate_of(operand: &Value) -> Option<StanceGate> {
        if let Some(option) = option_of(operand) {
            return Some(StanceGate {
                option,
                negated: false,
            });
        }
        let operand = operand.as_object()?;
        if !is_str(operand, "operator", "not") {
            return None;
        }
        match operand.get("operands")?.as_array()?.as_slice() {
            [only] => option_of(only).map(|option| StanceGate {
                option,
                negated: true,
            }),
            _ => None,
        }
    }
    if let Some(gate) = gate_of(&Value::Object(condition.clone())) {
        return Some((gate, None));
    }
    if !is_str(condition, "operator", "and") {
        return None;
    }
    let operands = condition.get("operands")?.as_array()?;
    let mut matches = operands
        .iter()
        .enumerate()
        .filter_map(|(i, operand)| gate_of(operand).map(|gate| (i, gate)));
    let (index, gate) = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    let rest: Vec<Value> = operands
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, operand)| operand.clone())
        .collect();
    let rest = match rest.as_slice() {
        [only] if only.is_object() => only.clone(),
        _ => serde_json::json!({ "operator": "and", "operands": rest }),
    };
    Some((gate, Some(rest)))
}

/// What the effect (under any remaining condition) gives becomes a lever requiring the stance
/// option, or, for a negated gate, excluding it. Buffs under the same gate within one ability
/// share one lever.
pub(super) fn offer_stance_gated(
    node: &Obj,
    gate: StanceGate,
    rest: Option<Value>,
    opts: &WalkOpts,
    out: &mut Out,
) {
    let mut sub = Out::default();
    match rest {
        Some(rest) => {
            // The clone keeps any activation source the node carries.
            let mut gated = node.clone();
            gated.insert("condition".into(), rest);
            walk(&Value::Object(gated), opts, &mut sub);
        }
        None => walk(node.get("effect").unwrap_or(&Value::Null), opts, &mut sub),
    }
    out.unsupported.extend(sub.unsupported);
    for mut lever in sub.activatable {
        lever.gate = Some(gate.clone());
        out.activatable.push(lever);
    }
    if sub.applied.is_empty() {
        return;
    }
    let name = if gate.negated {
        format!("not-{}", gate.option.option_id)
    } else {
        gate.option.option_id.clone()
    };
    let id = format!("{}#{name}", opts.ability_id);
    if let Some(existing) = out.activatable.iter_mut().find(|lever| lever.id == id) {
        existing.buffs.extend(sub.applied);
        existing.label = format!("{name}: {}", label_for_buffs(&existing.buffs));
        return;
    }
    out.activatable.push(Lever {
        id,
        label: format!("{name}: {}", label_for_buffs(&sub.applied)),
        buffs: sub.applied,
        group: None,
        requires: None,
        cap_raise: None,
        gate: Some(gate),
    });
}

/// The tags `effect` designates on the units holding the ability (`this-unit`, `ability-unit`, or
/// a friendly filter naming the ability in `has_ability`): Martial Katah readies every such unit.
pub(super) fn self_designations(effect: &Value, ability_id: &str) -> BTreeSet<String> {
    fn visit(node: &Value, ability_id: &str, tags: &mut BTreeSet<String>) {
        match node {
            Value::Array(items) => items.iter().for_each(|item| visit(item, ability_id, tags)),
            Value::Object(n) => {
                if is_str(n, "type", "designate") {
                    if let Some(modifier) = object(n.get("modifier")) {
                        let tag = modifier.get("tag").and_then(Value::as_str);
                        let clear = modifier.get("clear") == Some(&Value::Bool(true));
                        let holders = match n.get("target") {
                            Some(Value::String(target)) => {
                                target == "this-unit" || target == "ability-unit"
                            }
                            Some(Value::Object(target)) => {
                                is_str(target, "owner", "friendly")
                                    && target
                                        .get("has_ability")
                                        .and_then(Value::as_array)
                                        .is_some_and(|ids| {
                                            ids.iter().any(|id| id.as_str() == Some(ability_id))
                                        })
                            }
                            _ => false,
                        };
                        if let (Some(tag), false, true) = (tag, clear, holders) {
                            tags.insert(tag.to_owned());
                        }
                    }
                }
                n.values().for_each(|value| visit(value, ability_id, tags));
            }
            _ => {}
        }
    }
    let mut tags = BTreeSet::new();
    visit(effect, ability_id, &mut tags);
    tags
}

/// The tag of a `this-unit` designation gate the ability itself grants its holders, when the
/// context does not declare the unit's designations: the player readies the unit, so the gate is
/// the player's to open.
pub(super) fn self_designation_gate<'c>(condition: &'c Obj, opts: &WalkOpts) -> Option<&'c str> {
    if opts.context.attacker_designations.is_some() || !is_str(condition, "type", "matches") {
        return None;
    }
    let parameters = object(condition.get("parameters"))?;
    if !is_str(parameters, "subject", "this-unit") {
        return None;
    }
    let filter = object(parameters.get("filter"))?;
    if filter.len() != 1 {
        return None;
    }
    let tag = filter.get("designated")?.as_str()?;
    opts.self_designations.contains(tag).then_some(tag)
}

/// What a self-designation gate opens becomes opt-in levers requiring that designation.
pub(super) fn offer_self_designated(node: &Obj, tag: &str, opts: &WalkOpts, out: &mut Out) {
    let mut sub = Out::default();
    walk(node.get("effect").unwrap_or(&Value::Null), opts, &mut sub);
    out.unsupported.extend(sub.unsupported);
    let requirement = serde_json::json!({ "designated": tag });
    for mut lever in sub.activatable {
        let mut requires = vec![requirement.clone()];
        requires.extend(lever.requires.take().unwrap_or_default());
        lever.requires = Some(requires);
        out.activatable.push(lever);
    }
    if sub.applied.is_empty() {
        return;
    }
    out.activatable.push(Lever {
        id: format!("{}#{tag}", opts.ability_id),
        label: format!("{tag}: {}", label_for_buffs(&sub.applied)),
        buffs: sub.applied,
        group: None,
        requires: Some(vec![requirement]),
        cap_raise: None,
        gate: None,
    });
}

/// Buffs an activation gives only under a stance gate, and the gates on them.
#[derive(Default)]
struct StanceGated {
    buffs: Vec<Value>,
    gates: Vec<StanceGate>,
}

/// Where collected buffs land: the plain list, or (under a stance gate) the stance list.
struct Sink<'a> {
    plain: &'a mut Vec<Value>,
    stance: Option<&'a mut StanceGated>,
    into_stance: bool,
}

impl Sink<'_> {
    fn reborrow(&mut self, into_stance: bool) -> Sink<'_> {
        Sink {
            plain: self.plain,
            stance: self.stance.as_deref_mut(),
            into_stance,
        }
    }

    fn push(&mut self, buff: Value) {
        match (&mut self.stance, self.into_stance) {
            (Some(stance), true) => stance.buffs.push(buff),
            _ => self.plain.push(buff),
        }
    }
}

/// The buffs a gate's body contributes, with no inherited applicability.
pub(super) fn gated(node: &Value, opts: &WalkOpts) -> Vec<Value> {
    let mut buffs = Vec::new();
    let mut diagnostics = Vec::new();
    let mut sink = Sink {
        plain: &mut buffs,
        stance: None,
        into_stance: false,
    };
    collect(node, opts, &Obj::new(), &mut sink, &mut diagnostics);
    buffs
}

/// The buffs one activation gives, as [`collect`] finds them. Buffs under a gate on a stance
/// option the context does not declare make the activation carry that gate when they are all it
/// gives; mixed with ungated buffs, or under different gates, they are reported and left out.
pub(super) fn collect_option_buffs(
    node: &Value,
    opts: &WalkOpts,
    diagnostics: &mut Vec<(String, Value)>,
) -> (Vec<Value>, Option<StanceGate>) {
    let mut buffs = Vec::new();
    let mut stance = StanceGated::default();
    let mut sink = Sink {
        plain: &mut buffs,
        stance: Some(&mut stance),
        into_stance: false,
    };
    collect(node, opts, &Obj::new(), &mut sink, diagnostics);
    if stance.buffs.is_empty() {
        return (buffs, None);
    }
    let gate = stance.gates[0].clone();
    let single = stance.gates.iter().all(|other| *other == gate);
    if buffs.is_empty() && single {
        return (stance.buffs, Some(gate));
    }
    diagnostics.push((MIXED_STANCE_REASON.into(), node.clone()));
    (buffs, None)
}

/// Walk the body of a player gate, collecting the buffs it would contribute. Conditions defer
/// to `applicableWhen` where expressible; nested decisions and stochastic rolls are not modelled.
fn collect(
    node: &Value,
    opts: &WalkOpts,
    app: &Obj,
    sink: &mut Sink,
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
            let split = match (&mut sink.stance, &opts.context.active_rules) {
                (Some(_), None) => split_stance_option(condition),
                _ => None,
            };
            if let Some((gate, rest)) = split {
                if let Some(stance) = sink.stance.as_deref_mut() {
                    stance.gates.push(gate);
                }
                let gated = match rest {
                    Some(rest) => {
                        let mut gated = n.clone();
                        gated.insert("condition".into(), rest);
                        Value::Object(gated)
                    }
                    None => n.get("effect").cloned().unwrap_or(Value::Null),
                };
                collect(&gated, opts, app, &mut sink.reborrow(true), diagnostics);
                return;
            }
            let effect = n.get("effect").unwrap_or(&Value::Null);
            match condition_to_applicability(
                condition,
                opts.perspective,
                opts.context.attacker_toughness,
            ) {
                // A nested timing gate: opting into the activation satisfies it.
                App::Gate => collect(effect, opts, app, sink, diagnostics),
                // No declarative gate: descend only when the context says it is active.
                App::Context => match evaluate_condition(condition, opts) {
                    Some(true) => collect(effect, opts, app, sink, diagnostics),
                    None => diagnostics.push((
                        "activation condition cannot be evaluated against current context".into(),
                        Value::Object(activation_fragment(n).unwrap_or(n).clone()),
                    )),
                    Some(false) => {}
                },
                App::When(a) => collect(effect, opts, &combine(app, &a), sink, diagnostics),
            }
        }
        Some("rules-bundle" | "sequence") => {
            for step in list(n.get("steps")) {
                collect(step, opts, app, sink, diagnostics);
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
                collect(&gated, &part_opts, app, sink, diagnostics);
            }
        }
        // A decision or stochastic roll nested inside an activation is not modelled.
        Some("choice" | "dice-pool-allocation" | "dice-gated") => {}
        _ => {
            let mut tmp = Out::default();
            walk(node, opts, &mut tmp);
            diagnostics.extend(tmp.unsupported);
            for buff in tmp.applied {
                sink.push(apply_applicability(buff, app));
            }
        }
    }
}
