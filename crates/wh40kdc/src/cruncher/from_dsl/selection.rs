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
use crate::cruncher::buffs::AbilityKind;

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
    let friendly = is_str(selector, "owner", "friendly");
    if !friendly && !is_str(selector, "owner", "enemy") {
        return SelectionPlan::None;
    }
    if is_str(selector, "target_kind", "model")
        || present(selector, "model_names").is_some()
        || present(selector, "bind_as").is_some()
    {
        return SelectionPlan::None;
    }
    if !references_selected_unit(node.get("effect").unwrap_or(&Value::Null)) {
        return SelectionPlan::None;
    }
    let keywords = selector.get("keywords");
    let excluded = selector.get("excluded_keywords");
    let (Some(keywords), Some(excluded)) = (
        keywords.map_or(Some(None), |k| keyword_list(k).map(Some)),
        excluded.map_or(Some(None), |k| keyword_list(k).map(Some)),
    ) else {
        return SelectionPlan::Unsupported(
            "select-units: the selector's keyword lists are malformed",
        );
    };
    let mut selection = node.clone();
    selection.remove("effect");
    let mut requires = vec![Value::Object(selection)];

    let (mut effect, applicability, label) = if friendly {
        if excludes_ability_unit(selector.get("eligibility"))
            && opts.ability_kind != Some(AbilityKind::Support)
        {
            return SelectionPlan::Skip;
        }
        if keywords.is_some() || excluded.is_some() {
            let Some(own) = own_keywords(opts) else {
                return SelectionPlan::Unsupported(
                    "select-units: the crunched unit's keywords are unavailable for the selector",
                );
            };
            let holds = keywords
                .as_deref()
                .unwrap_or_default()
                .iter()
                .all(|k| includes_keyword(own, k))
                && !excluded
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .any(|k| includes_keyword(own, k));
            if !holds {
                return SelectionPlan::Skip;
            }
        }
        let effect = node.get("effect").cloned().unwrap_or(Value::Null);
        (effect, None, "Selected unit")
    } else {
        let other = if opts.perspective == Attacker {
            "defender"
        } else {
            "attacker"
        };
        let gate =
            match selected_enemy_gate(keywords.as_deref(), excluded.as_deref(), opts.perspective) {
                Ok(gate) => gate,
                Err(reason) => return SelectionPlan::Unsupported(reason),
            };
        let effect = retarget(node.get("effect").unwrap_or(&Value::Null), other);
        (effect, gate, "Selected enemy unit")
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

/// The keyword gate an enemy selector puts on the selected unit. When the crunched unit attacks,
/// the selected unit is the defender and the gate reads the target's keywords; when it is attacked,
/// only a single required keyword on the attacker can be gated.
fn selected_enemy_gate(
    keywords: Option<&[String]>,
    excluded: Option<&[String]>,
    perspective: TranslationPerspective,
) -> Result<Option<Obj>, &'static str> {
    let mut out = Obj::new();
    if let Some(keywords) = keywords.filter(|k| !k.is_empty()) {
        if keywords.len() > 1 {
            return Err("select-units: more than one required keyword on the selected enemy unit is not gated by the buff layer");
        }
        let key = if perspective == Attacker {
            "requiresTargetKeyword"
        } else {
            "requiresAttackerKeyword"
        };
        out.insert(key.into(), Value::from(keywords[0].clone()));
    }
    if let Some(excluded) = excluded.filter(|k| !k.is_empty()) {
        if perspective != Attacker {
            return Err(
                "select-units: excluded keywords on the attacking unit are not gated by the buff layer",
            );
        }
        out.insert(
            "excludedTargetKeywords".into(),
            Value::from(excluded.to_vec()),
        );
    }
    Ok((!out.is_empty()).then_some(out))
}

/// Does the effect name the selected unit as a target anywhere, outside a nested selection?
fn references_selected_unit(node: &Value) -> bool {
    match node {
        Value::Array(a) => a.iter().any(references_selected_unit),
        Value::Object(o) => {
            if is_str(o, "type", "select-units") {
                return false;
            }
            if is_str(o, "target", SELECTED_UNIT) {
                return true;
            }
            o.iter()
                .any(|(k, v)| k != "target" && references_selected_unit(v))
        }
        _ => false,
    }
}

/// Copy the effect with each `selected-unit` target replaced, leaving nested selections alone.
fn retarget(node: &Value, target: &str) -> Value {
    match node {
        Value::Array(a) => Value::Array(a.iter().map(|c| retarget(c, target)).collect()),
        Value::Object(o) if !is_str(o, "type", "select-units") => Value::Object(
            o.iter()
                .map(|(k, v)| {
                    let v = if k == "target" && v.as_str() == Some(SELECTED_UNIT) {
                        Value::from(target)
                    } else {
                        retarget(v, target)
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

/// TS `isKeywordList`: an array of non-empty strings.
fn keyword_list(v: &Value) -> Option<Vec<String>> {
    v.as_array()?
        .iter()
        .map(|k| k.as_str().filter(|s| !s.is_empty()).map(str::to_string))
        .collect()
}

fn includes_keyword(keywords: &[String], keyword: &str) -> bool {
    let lower = keyword.to_lowercase();
    keywords.iter().any(|k| k.to_lowercase() == lower)
}

/// The crunched side's own keywords under the walk's perspective.
fn own_keywords<'a>(opts: &WalkOpts<'a>) -> Option<&'a [String]> {
    if opts.perspective == Attacker {
        opts.context.attacker_keywords.as_deref()
    } else {
        opts.context.target_keywords.as_deref()
    }
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
    opts.ability_kind == Some(AbilityKind::Support)
        && node
            .get("target")
            .and_then(Value::as_str)
            .is_some_and(|t| PROVIDER_TARGETS.contains(&t))
}

/// Whether a friendly unit-filter target names keywords the crunched unit lacks. Only the plain
/// keyword fields are read; a filter of alternatives is left to the alternatives check, and an
/// unknown keyword list keeps the filter permissive.
pub(super) fn friendly_filter_excludes(node: &Obj, opts: &WalkOpts) -> bool {
    let Some(target) = object(node.get("target")) else {
        return false;
    };
    if !is_str(target, "owner", "friendly")
        || target.get("any_of_filters").is_some_and(Value::is_array)
    {
        return false;
    }
    let Some(own) = own_keywords(opts).filter(|k| k.iter().all(|s| !s.is_empty())) else {
        return false;
    };
    let read = |k: &str| target.get(k).and_then(keyword_list);
    let all = read("all_of").unwrap_or_default();
    let any = read("any_of");
    let none = read("none_of").unwrap_or_default();
    let holds = all.iter().all(|k| includes_keyword(own, k))
        && any
            .as_ref()
            .is_none_or(|any| any.iter().any(|k| includes_keyword(own, k)))
        && !none.iter().any(|k| includes_keyword(own, k));
    !holds
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
        cap_raise: Some((ability.to_string(), by as i64)),
    });
}
