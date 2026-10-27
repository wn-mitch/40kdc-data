//! Player levers the translator offers beyond a choice or a dice pool: a unit selection that
//! reaches the `selected-unit`, a capped scaling read at its cap, and a change that adds
//! selections to another ability. Also the gates that keep an ability another unit provides off
//! the provider's own unit, and a friendly filter off a unit without its keywords. Mirrors
//! `tools/src/cruncher/from-dsl-selection.ts` and `offerLever`, `translateSelection`,
//! `scaledToCap`, `translateAbilityModifier`, `isProvidedByAnotherUnit` and
//! `friendlyFilterExcludes` in `tools/src/cruncher/from-dsl.ts`.
//!
//! Which unit is selected, whether the range and visibility hold, whether a gating roll succeeded
//! and how many models a scaling counts are not known to the cruncher. Each lever records what the
//! player vouches for in its `requires`, in the order those fragments apply.

use serde_json::Value;

use super::applicability::{apply_applicability, label_for_buffs};
use super::js::*;
use super::TranslationPerspective::{self, Attacker};
use super::{applies_to_buffed_unit, walk, Lever, Out, WalkOpts};
use crate::cruncher::buffs::{AbilityKind, EngineContext};

const SELECTED_UNIT: &str = "selected-unit";

/// The `modifier` fields a leaf's size is read from.
const SIZED_FIELDS: &[&str] = &["value", "count", "amount"];

/// Self targets that, in an ability another unit provides, name that provider.
const PROVIDER_TARGETS: &[&str] = &["this-unit", "ability-unit", "this-model"];

/// What a `select-units` node contributes to the crunched unit.
pub(super) enum SelectionPlan {
    /// Not a selection lever: the translator keeps its general handling.
    None,
    /// The crunched unit cannot be the selected unit, so nothing reaches it.
    Skip,
    Unsupported(&'static str),
    Lever {
        /// The nested effect with `selected-unit` read from the crunched unit's side.
        effect: Value,
        /// Gates on the selected unit's keywords, when it is the other side of the attack.
        applicability: Option<Obj>,
        /// DSL fragments the player vouches for: the selection, then any gating roll.
        requires: Vec<Value>,
        /// Lever label prefix.
        label: &'static str,
    },
}

/// Plan a `select-units` node for the crunched unit.
///
/// A friendly selection reaches the crunched unit when its keywords match the selector; when the
/// eligibility excludes the ability's own unit, the lever exists only when another unit provides
/// the ability (`abilityKind: "support"`). An enemy selection reaches the other side of the
/// attack. A top-level dice gate with no failure branch becomes the lever's content and its roll
/// joins `requires`. Selections that bind models, named models or a named binding, and selections
/// whose effect never names the selected unit, stay on the general path.
pub(super) fn plan_selection(node: &Obj, opts: &WalkOpts) -> SelectionPlan {
    let Some(selector) = object(node.get("selector")) else {
        return SelectionPlan::None;
    };
    let Some(filter) = object(selector.get("filter")) else {
        return SelectionPlan::None;
    };
    let friendly = is_str(filter, "owner", "friendly");
    if !friendly && !is_str(filter, "owner", "enemy") {
        return SelectionPlan::None;
    }
    if is_str(filter, "level", "model") || present(filter, "model_names").is_some() {
        return SelectionPlan::None;
    }
    let binding = selector.get("bind_as").and_then(Value::as_str);
    if !references_selected_unit(node.get("effect").unwrap_or(&Value::Null), binding) {
        return SelectionPlan::None;
    }
    if selector
        .get("count")
        .and_then(|count| count.get("max"))
        .and_then(Value::as_u64)
        == Some(0)
    {
        return SelectionPlan::Skip;
    }
    let predicates: Obj = filter
        .iter()
        .filter(|(key, _)| !matches!(key.as_str(), "within" | "visible" | "excluding"))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let mut selection = node.clone();
    selection.remove("effect");
    let mut requires = vec![Value::Object(selection)];

    let (mut effect, applicability, label) = if friendly {
        if (excludes_ability_unit(selector.get("eligibility"))
            || matches!(
                filter.get("excluding").and_then(Value::as_str),
                Some("this-unit" | "ability-unit")
            ))
            && opts.ability_kind != Some(AbilityKind::Support)
        {
            return SelectionPlan::Skip;
        }
        match super::conditions::matches_unit_filter(
            &Value::Object(predicates),
            opts.context,
            opts.perspective,
            "friendly",
        ) {
            Some(false) => return SelectionPlan::Skip,
            None => {
                return SelectionPlan::Unsupported(
                    "select-units: candidate identity or state is unavailable",
                )
            }
            Some(true) => {}
        }
        let effect = retarget(
            node.get("effect").unwrap_or(&Value::Null),
            SELECTED_UNIT,
            binding,
        );
        (effect, None, "Selected unit")
    } else {
        let other = if opts.perspective == Attacker {
            "defender"
        } else {
            "attacker"
        };
        let mut gate = Obj::new();
        gate.insert(
            if opts.perspective == Attacker {
                "targetFilter"
            } else {
                "attackerFilter"
            }
            .into(),
            Value::Object(predicates),
        );
        let effect = retarget(node.get("effect").unwrap_or(&Value::Null), other, binding);
        (effect, Some(gate), "Selected enemy unit")
    };

    if let Some(gated) = effect
        .as_object()
        .filter(|e| is_str(e, "type", "dice-gated"))
    {
        if present(gated, "on_fail").is_some() {
            return SelectionPlan::Unsupported(
                "select-units: a dice gate with a failure branch is not a single lever",
            );
        }
        let mut roll = gated.clone();
        let on_success = roll.remove("on_success").unwrap_or(Value::Null);
        roll.remove("on_fail");
        requires.push(Value::Object(roll));
        effect = on_success;
    }
    SelectionPlan::Lever {
        effect,
        applicability,
        requires,
        label,
    }
}

/// Every matching model pool receives a quantified recipient effect; this is not a player choice.
pub(super) fn bind_each_recipient(node: &Obj) -> Option<Value> {
    bind_recipient(node, None)
}

pub(crate) fn bind_recipient(node: &Obj, target: Option<&Value>) -> Option<Value> {
    let selector = object(node.get("selector"))?;
    let filter = target.or_else(|| selector.get("filter").filter(|filter| filter.is_object()))?;
    if target.is_none() && selector.contains_key("eligibility") {
        return None;
    }
    fn bind(
        value: &Value,
        filter: &Value,
        binding: Option<&str>,
        found: &mut bool,
        other: &mut bool,
    ) -> Value {
        match value {
            Value::Array(values) => Value::Array(
                values
                    .iter()
                    .map(|value| bind(value, filter, binding, found, other))
                    .collect(),
            ),
            Value::Object(node)
                if !matches!(
                    node.get("type").and_then(Value::as_str),
                    Some("select-units" | "for-each-unit")
                ) =>
            {
                Value::Object(
                    node.iter()
                        .map(|(key, value)| {
                            let recipient = value.as_str() == Some("recipient")
                                || binding.is_some_and(|binding| {
                                    value.get("selection_var").and_then(Value::as_str)
                                        == Some(binding)
                                });
                            if key == "target" {
                                *found |= recipient;
                                *other |= !recipient;
                            }
                            let value = if key == "target" && recipient {
                                filter.clone()
                            } else {
                                bind(value, filter, binding, found, other)
                            };
                            (key.clone(), value)
                        })
                        .collect(),
                )
            }
            _ => value.clone(),
        }
    }
    let mut found = false;
    let mut other = false;
    let effect = bind(
        node.get("effect")?,
        filter,
        selector.get("bind_as").and_then(Value::as_str),
        &mut found,
        &mut other,
    );
    (found && !other).then_some(effect)
}

/// The unit-ref naming the unit whose action fired the enclosing trigger.
const EVENT_SUBJECT: &str = "event-subject";

/// Internal binding: the event's subject is another unit, so the effect never reaches the buffed
/// unit.
const OTHER_UNIT: &str = "other-unit";

/// Bind `event-subject` effects when the trigger says who acts. `this-unit` names the ability's
/// own unit. A friendly unit filter the buffed unit matches names the buffed unit; one it fails
/// names another unit. Seen from the target, an enemy unit filter the attacker matches names the
/// attacker (the enemy whose action fired the trigger is the one attacking); one it fails names
/// another unit. The binding is left in place (`None`) when the subject is absent, an enemy seen
/// from the attacker, differs across alternative triggers, or cannot be checked, so the
/// translator reports it. A nested ability part with its own trigger binds its own subject. Mirrors TS
/// `bindEventSubject`; `Some` carries the rebound effect only when a target changed.
pub(crate) fn bind_event_subject(
    trigger: Option<&Value>,
    effect: &Value,
    context: &EngineContext,
    perspective: TranslationPerspective,
) -> Option<Value> {
    let triggers: Vec<&Obj> = match trigger {
        Some(Value::Array(alternatives)) => {
            alternatives.iter().filter_map(Value::as_object).collect()
        }
        other => object(other).into_iter().collect(),
    };
    let subject = triggers.first()?.get("subject");
    if triggers.iter().any(|item| item.get("subject") != subject) {
        return None;
    }
    if subject.and_then(Value::as_str) == Some("this-unit") {
        return rebind_event_subject(effect, "this-unit");
    }
    if let Some(filter) =
        subject.filter(|s| object(Some(s)).is_some_and(|f| is_str(f, "owner", "enemy")))
    {
        if perspective == TranslationPerspective::Target {
            let attacker =
                super::conditions::matches_unit_filter(filter, context, Attacker, "enemy")?;
            return rebind_event_subject(effect, if attacker { "attacker" } else { OTHER_UNIT });
        }
    }
    let filter =
        subject.filter(|s| object(Some(s)).is_some_and(|f| is_str(f, "owner", "friendly")))?;
    let verdict = super::conditions::matches_unit_filter(filter, context, perspective, "friendly")?;
    // `selected-unit`, not `this-unit`: in a supporting unit's ability `this-unit` names the provider.
    rebind_event_subject(effect, if verdict { SELECTED_UNIT } else { OTHER_UNIT })
}

/// The effect with each `event-subject` target rebound to `to`, or `None` when it holds none.
fn rebind_event_subject(node: &Value, to: &str) -> Option<Value> {
    match node {
        Value::Array(children) => {
            let rebound: Vec<Option<Value>> = children
                .iter()
                .map(|child| rebind_event_subject(child, to))
                .collect();
            rebound.iter().any(Option::is_some).then(|| {
                Value::Array(
                    rebound
                        .into_iter()
                        .zip(children)
                        .map(|(bound, child)| bound.unwrap_or_else(|| child.clone()))
                        .collect(),
                )
            })
        }
        Value::Object(o)
            if !(is_str(o, "type", "ability-part") && present(o, "trigger").is_some()) =>
        {
            let mut changed = false;
            let out: Obj = o
                .iter()
                .map(|(key, value)| {
                    let bound = if key == "target" && value.as_str() == Some(EVENT_SUBJECT) {
                        Some(Value::from(to))
                    } else {
                        rebind_event_subject(value, to)
                    };
                    changed |= bound.is_some();
                    (key.clone(), bound.unwrap_or_else(|| value.clone()))
                })
                .collect();
            changed.then_some(Value::Object(out))
        }
        _ => None,
    }
}

/// Does the effect name the selected unit as a target anywhere, outside a nested selection?
fn references_selected_unit(node: &Value, binding: Option<&str>) -> bool {
    match node {
        Value::Array(a) => a
            .iter()
            .any(|child| references_selected_unit(child, binding)),
        Value::Object(o) => {
            if is_str(o, "type", "select-units") {
                return false;
            }
            let selected = |value: &Value| {
                value.as_str() == Some(SELECTED_UNIT)
                    || binding.is_some_and(|binding| {
                        value.get("selection_var").and_then(Value::as_str) == Some(binding)
                    })
            };
            if o.get("target").is_some_and(|target| {
                selected(target) || target.get("member_of").is_some_and(selected)
            }) {
                return true;
            }
            o.iter()
                .any(|(k, v)| k != "target" && references_selected_unit(v, binding))
        }
        _ => false,
    }
}

/// Copy the effect with each `selected-unit` target replaced, leaving nested selections alone.
fn retarget(node: &Value, target: &str, binding: Option<&str>) -> Value {
    match node {
        Value::Array(a) => Value::Array(a.iter().map(|c| retarget(c, target, binding)).collect()),
        Value::Object(o) if !is_str(o, "type", "select-units") => Value::Object(
            o.iter()
                .map(|(k, v)| {
                    let v = if k == "target"
                        && (v.as_str() == Some(SELECTED_UNIT)
                            || binding.is_some_and(|binding| {
                                v.get("selection_var").and_then(Value::as_str) == Some(binding)
                            })) {
                        Value::from(target)
                    } else if k == "member_of"
                        && (v.as_str() == Some(SELECTED_UNIT)
                            || binding.is_some_and(|binding| {
                                v.get("selection_var").and_then(Value::as_str) == Some(binding)
                            }))
                    {
                        Value::from(if target == SELECTED_UNIT {
                            "this-unit"
                        } else {
                            target
                        })
                    } else {
                        retarget(v, target, binding)
                    };
                    (k.clone(), v)
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Does the eligibility forbid selecting the unit that holds the ability (`not same-unit
/// ability-unit`)?
fn excludes_ability_unit(condition: Option<&Value>) -> bool {
    let Some(c) = object(condition) else {
        return false;
    };
    let Some(operands) = c.get("operands").and_then(Value::as_array) else {
        return false;
    };
    if is_str(c, "operator", "not") {
        return operands.iter().any(|operand| {
            object(Some(operand)).is_some_and(|o| {
                is_str(o, "type", "same-unit")
                    && object(o.get("parameters")).is_some_and(|p| is_str(p, "as", "ability-unit"))
            })
        });
    }
    if is_str(c, "operator", "and") {
        return operands.iter().any(|o| excludes_ability_unit(Some(o)));
    }
    false
}

/// Offer a planned unit selection as one lever (`<abilityId>#selected`).
pub(super) fn translate_selection(plan: SelectionPlan, node: &Obj, opts: &WalkOpts, out: &mut Out) {
    match plan {
        SelectionPlan::None | SelectionPlan::Skip => {}
        SelectionPlan::Unsupported(reason) => out.unsupported(reason, node),
        SelectionPlan::Lever {
            effect,
            applicability,
            requires,
            label,
        } => offer_lever(
            &effect,
            opts,
            out,
            format!("{}#selected", opts.ability_id),
            label,
            requires,
            applicability.as_ref(),
        ),
    }
}

/// Translate `effect` and offer what it gives the crunched unit as one opt-in lever requiring
/// `requires`. Levers nested in the effect keep their own choice and add those requirements to
/// theirs; `applicability` gates every buff.
pub(super) fn offer_lever(
    effect: &Value,
    opts: &WalkOpts,
    out: &mut Out,
    id: String,
    label: &str,
    requires: Vec<Value>,
    applicability: Option<&Obj>,
) {
    let mut sub = Out::default();
    walk(effect, opts, &mut sub);
    let gate = |b: Value| match applicability {
        Some(app) => apply_applicability(b, app),
        None => b,
    };
    out.unsupported.extend(sub.unsupported);
    for nested in sub.activatable {
        let mut all = requires.clone();
        all.extend(nested.requires.unwrap_or_default());
        out.activatable.push(Lever {
            buffs: nested.buffs.into_iter().map(gate).collect(),
            requires: Some(all),
            ..nested
        });
    }
    if !sub.applied.is_empty() {
        let buffs: Vec<Value> = sub.applied.into_iter().map(gate).collect();
        out.activatable.push(Lever {
            id,
            label: format!("{label}: {}", label_for_buffs(&buffs)),
            buffs,
            group: None,
            requires: Some(requires),
            cap_raise: None,
            requires_option: None,
        });
    }
}

/// A scaled leaf with a cap, as the leaf at that cap: the scaled field set to `max_value` and the
/// scaling removed. `None` when the scaling has no positive integer cap, the scaled field is not a
/// plain number, or another size is bound.
pub(super) fn scaled_to_cap(node: &Obj) -> Option<Obj> {
    let scaling = object(node.get("scaling"))?;
    let modifier = object(node.get("modifier"))?;
    let cap = scaling.get("max_value")?;
    let n = cap.as_f64()?;
    if n.fract() != 0.0 || n <= 0.0 {
        return None;
    }
    let field = match scaling.get("field") {
        None => "value",
        Some(f) => f.as_str()?,
    };
    if !SIZED_FIELDS.contains(&field) || !modifier.get(field).is_some_and(Value::is_number) {
        return None;
    }
    if SIZED_FIELDS
        .iter()
        .any(|other| object(modifier.get(*other)).is_some())
    {
        return None;
    }
    let mut capped = modifier.clone();
    capped.insert(field.into(), cap.clone());
    let mut rest = node.clone();
    rest.remove("scaling");
    rest.insert("modifier".into(), Value::Object(capped));
    Some(rest)
}

/// In an ability another unit provides, effects on its own unit or model name that provider.
pub(super) fn targets_provider(node: &Obj, opts: &WalkOpts) -> bool {
    !opts.granted_holder
        && opts.ability_kind == Some(AbilityKind::Support)
        && node
            .get("target")
            .and_then(Value::as_str)
            .is_some_and(|t| PROVIDER_TARGETS.contains(&t))
}

/// A change to another ability. Adding selections to the crunched unit's own ability raises the
/// cap of the lever pool that ability offers (`<abilityId>#cap`, no buffs); other aspects are not
/// modelled.
pub(super) fn ability_modifier(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let m = object(node.get("modifier"));
    let raise = m.and_then(|m| {
        let ability = m.get("ability").and_then(Value::as_str)?;
        let by = m.get("value").and_then(Value::as_f64)?;
        (is_str(m, "aspect", "selections")
            && is_str(m, "operation", "add")
            && by.fract() == 0.0
            && by > 0.0)
            .then_some((ability, by))
    });
    let Some((ability, by)) = raise else {
        out.unsupported(
            "effect type \"ability-modifier\" is not modelled by the buff layer",
            node,
        );
        return;
    };
    if !applies_to_buffed_unit(node, opts.perspective) {
        return;
    }
    let label = if by == 1.0 {
        format!("One more {ability} selection")
    } else {
        format!("{} more {ability} selections", fmt_num(by))
    };
    out.activatable.push(Lever {
        id: format!("{}#cap", opts.ability_id),
        label,
        buffs: Vec::new(),
        group: None,
        requires: None,
        requires_option: None,
        cap_raise: Some(super::CapRaise {
            ability: ability.to_string(),
            by: by as i64,
            ..Default::default()
        }),
    });
}

/// Extra stance capacity keeps typed authored option references intact.
pub(super) fn stance_capacity(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let Some(modifier) = object(node.get("modifier")) else {
        return;
    };
    let Some(ability) = modifier.get("ability_id").and_then(Value::as_str) else {
        return;
    };
    let Some(by) = modifier
        .get("additional_selections")
        .and_then(Value::as_i64)
        .filter(|by| *by > 0)
    else {
        return;
    };
    let option = modifier
        .get("option")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose();
    let options = modifier
        .get("options")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose();
    let (Ok(option), Ok(options)) = (option, options) else {
        out.unsupported(
            "stance-selection-capacity: malformed stable option reference",
            node,
        );
        return;
    };
    out.activatable.push(Lever {
        id: format!("{}#cap", opts.ability_id),
        label: format!("{by} more {ability} selections"),
        buffs: Vec::new(),
        group: None,
        requires: None,
        requires_option: None,
        cap_raise: Some(super::CapRaise {
            ability: ability.into(),
            by,
            allocation: modifier
                .get("allocation")
                .and_then(Value::as_str)
                .map(str::to_owned),
            option,
            options,
        }),
    });
}
