//! Whole-ability rendering: the top-level sentence or block with trigger, usage and duration
//! woven in, the `Applies to:` line, and the public typed entry points. Mirrors
//! `renderTopLevel` / `describeAbility` in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::block::block;
use super::menu::{duration_clauses, normalize_triggers, usage_clause};
use super::words::*;
use super::{child, inline, is_container, join_nonempty, ty, P};
use crate::generated::{
    Ability, AbilityTrigger, AbilityUsage, EffectNode, KeywordPredicate, Scope,
};
use crate::translate::condition::{
    and_list, condition_lead_in_for, is_defensive_effect, nn, obj, or_list, truthy,
};
use crate::translate::dekebab;

/// Join non-empty clauses with ", ", merging adjacent `if` clauses, capitalize, and end with a period.
pub(super) fn assemble_sentence(parts: &[&str]) -> String {
    let non_empty: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
    if non_empty.is_empty() {
        return String::new();
    }
    let mut body = non_empty[0].to_string();
    for &next in &non_empty[1..] {
        let ends_with_if = body.rfind(", if ").is_some_and(|pos| {
            let tail = &body[pos + ", if ".len()..];
            !tail.is_empty() && !tail.contains('.')
        });
        if ends_with_if && next.starts_with("if ") {
            body.push_str(" and ");
            body.push_str(&next[3..]);
        } else {
            body.push_str(", ");
            body.push_str(next);
        }
    }
    let period = if body.ends_with('.') || body.ends_with(':') {
        ""
    } else {
        "."
    };
    format!("{}{period}", capitalize(&body))
}

fn starts_with_word(s: &str, words: &[&str]) -> bool {
    for &w in words {
        if let Some(rest) = s.strip_prefix(w) {
            let boundary = rest
                .chars()
                .next()
                .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_'));
            if boundary {
                return true;
            }
        }
    }
    false
}

fn contains_word_phrase(s: &str, phrase: &str) -> bool {
    let bytes = s.as_bytes();
    let mut from = 0;
    while let Some(pos) = s[from..].find(phrase) {
        let start = from + pos;
        let end = start + phrase.len();
        let before_ok =
            start == 0 || !(bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_');
        let after_ok =
            end == bytes.len() || !(bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_');
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// Weave `optional: true` cleanly without a clunky `You can: ` prefix.
fn with_optionality(rendered: &str) -> String {
    if rendered.is_empty() {
        return String::new();
    }
    if starts_with_word(rendered, &["You can", "Choose", "Select"])
        || contains_word_phrase(rendered, "you can")
    {
        return rendered.to_string();
    }
    if let Some(newline) = rendered.find('\n') {
        if newline > 0 {
            let first = &rendered[..newline];
            let rest = &rendered[newline..];
            if let Some(head) = first.strip_suffix(':') {
                return format!("{head}, you can use this ability:{rest}");
            }
        }
    }
    format!("You can use this ability: {rendered}")
}

const OPT_VERBS: &[&str] = &[
    "add", "subtract", "return", "remove", "destroy", "heal", "move", "place", "roll", "spend",
    "discard", "improve", "worsen", "set", "halve", "multiply", "reduce", "increase", "issue",
    "split",
];

fn opt_body(body: &str, optional: bool) -> String {
    if optional
        && !starts_with_word(body, &["you can", "choose", "select"])
        && starts_with_word(body, OPT_VERBS)
    {
        format!("you can {body}")
    } else {
        body.to_string()
    }
}

/// The inch range of a top-level `within` condition, else `None`.
pub(super) fn condition_within_range(c: &Value) -> Option<f64> {
    if c.get("type").and_then(Value::as_str) != Some("within") {
        return None;
    }
    c.get("parameters")?.get("range")?.get("inches")?.as_f64()
}

pub(super) fn render_top_level(
    e: &Value,
    scope: Option<&Value>,
    usage: Option<&Value>,
    trigger: Option<&Value>,
    optional: bool,
    self_id: Option<&str>,
) -> String {
    let mut ctx = Ctx {
        self_id: self_id.map(str::to_string),
        ..Ctx::default()
    };
    // Every trigger's object (subject) is a model: the effect's `event-object` reads "that model"
    // (`event-subject` "the triggering model").
    let rewritten = crate::translate::condition::model_event_refs(e, &normalize_triggers(trigger));
    let e = &rewritten;
    let e_map = obj(Some(e));
    let (dur_lead, trail) = duration_clauses(scope.and_then(|s| s.get("duration")));
    // An explicit usage limit supersedes the duration's coarse "once per battle" lead.
    let lead = match usage {
        Some(u) if u.is_array() => usage_clause(u),
        Some(u) if u.as_object().is_some_and(|o| nn(o, "frequency").is_some()) => usage_clause(u),
        _ => dur_lead.to_string(),
    };

    // A reactive trigger opens the sentence ("Each time …"). When a trigger's proximity just
    // restates a within-range condition on the effect, render the range once (drop it here).
    let cond_range = if ty(e_map) == "conditional" {
        condition_within_range(child(e_map, "condition"))
    } else {
        None
    };
    let triggers: Vec<&Value> = normalize_triggers(trigger)
        .into_iter()
        .filter(|t| t.get("event").is_some_and(|v| !v.is_null()))
        .collect();
    if triggers.iter().any(|t| {
        let ev = t.get("event").and_then(Value::as_str);
        ev == Some("destroyed") || ev == Some("model-destroyed")
    }) {
        ctx.destroyed_trigger = true;
    }
    if triggers
        .iter()
        .any(|t| t.get("event").and_then(Value::as_str) == Some("damage-allocated"))
    {
        ctx.allocated_trigger = true;
    }
    // When every trigger introduces a friendly filtered unit (e.g. a Stratagem's "When a friendly X unit is selected to fight"),
    // `this-unit` / `event-subject` in the effect body refers back to "that unit".
    if !triggers.is_empty()
        && triggers.iter().all(|t| {
            t.get("subject")
                .and_then(Value::as_object)
                .is_some_and(|s| s.get("owner").and_then(Value::as_str) == Some("friendly"))
        })
    {
        ctx.unit_subject = Some("that unit".to_string());
    }
    let mut phrases: Vec<String> = Vec::new();
    let triggers: Vec<Value> = triggers
        .into_iter()
        .map(|t| with_aura_recipient(t, e_map, &ctx))
        .collect();
    for phrase in triggers.iter().map(|t| {
        let prox = t
            .get("proximity")
            .and_then(|p| p.get("range"))
            .and_then(|r| r.get("inches"))
            .and_then(Value::as_f64);
        if cond_range.is_some() && prox == cond_range {
            let mut t2 = t.as_object().cloned().unwrap_or_default();
            t2.remove("proximity");
            crate::translate::trigger::describe_trigger_value(&Value::Object(t2))
        } else {
            crate::translate::trigger::describe_trigger_value(t)
        }
    }) {
        // Two triggers that read the same are one trigger in English ("when X or when X").
        if !phrase.is_empty() && !phrases.contains(&phrase) {
            phrases.push(phrase);
        }
    }
    let trig = phrases.join(" or ");

    if ty(e_map) == "conditional" {
        if let Some(g) = super::recipient_gate::recipient_gate(e_map, &ctx) {
            if ty(obj(Some(&g.inner))) == "sequence" {
                // "While a friendly X unit is …:" then that unit's effects.
                let header = join_nonempty(&[&trig, &lead, &g.lead, trail], ", ");
                return format!("{}:\n{}", capitalize(&header), block(&g.inner, 1, &g.ctx));
            }
            return assemble_sentence(&[&trig, &lead, &g.lead, trail, &inline(&g.inner, &g.ctx)]);
        }
        let (cond, inner) = super::flatten_conditional(e_map, &ctx);
        let lead_in = condition_lead_in_for(&cond, is_defensive_effect(&inner));
        let child_ctx = match super::attack_type_from_condition(&cond) {
            Some(t) => Ctx {
                suppress_weapon_type: Some(t.to_string()),
                ..ctx.clone()
            },
            None => ctx.clone(),
        };
        if is_container(obj(Some(&inner))) {
            let header = join_nonempty(&[&trig, &lead, &lead_in, trail], ", ");
            return format!("{}:\n{}", capitalize(&header), block(&inner, 1, &child_ctx));
        }
        let body = opt_body(&inline(&inner, &child_ctx), optional);
        return assemble_sentence(&[&trig, &lead, &lead_in, trail, &body]);
    }

    if is_container(e_map) || super::leaf_ability::is_defined_grant(e_map) {
        // A designation carrying its own `duration` renders that duration itself.
        let own_duration = matches!(ty(e_map), "designate-target" | "persistent-designation")
            && nn(e_map, "duration").is_some();
        let head = join_nonempty(&[&trig, &lead, if own_duration { "" } else { trail }], ", ");
        // Inline simple single-leaf `dice-gated` or `select-units` under a header instead of a 1-bullet list.
        if !head.is_empty() && ty(e_map) == "dice-gated" {
            return assemble_sentence(&[&head, &inline(e, &ctx)]);
        }
        if !head.is_empty()
            && ty(e_map) == "select-units"
            && !is_container(obj(Some(child(e_map, "effect"))))
        {
            let sel = obj(nn(e_map, "selector"));
            let plural = super::select::select_units_plural(sel);
            let nested = inline(
                child(e_map, "effect"),
                &super::select::selected_context_with_plural(&ctx, sel, plural),
            );
            return format!(
                "{}, select {}{}. {}.",
                capitalize(&head),
                super::select::select_units_subject_in(sel, ctx.each_model),
                super::select::selection_binding(sel),
                capitalize(&nested)
            );
        }
        // Under a header, the block's steps are indented as they are under a condition's lead-in.
        return if head.is_empty() {
            block(e, 0, &ctx)
        } else {
            format!("{}:\n{}", capitalize(&head), block(e, 1, &ctx))
        };
    }

    let body = opt_body(&inline(e, &ctx), optional);
    assemble_sentence(&[&trig, &lead, trail, &body])
}

pub(super) fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

/// Single-clause translation for leaf effects (lowercase-initial, no period).
pub fn describe_effect_inline(e: &EffectNode) -> String {
    inline(&to_value(e), &Ctx::default())
}

/// Block translation of a container effect tree (multi-line, two-space indentation).
pub fn describe_effect(e: &EffectNode) -> String {
    block(&to_value(e), 0, &Ctx::default())
}

/// The shared lifetime rendered as a standalone duration line.
pub fn describe_scope(s: &Scope) -> String {
    let value = to_value(s);
    let s = obj(Some(&value));
    let Some(duration) = nn(s, "duration") else {
        return String::new();
    };
    let trail = crate::translate::expiry::expiry_trail(Some(duration));
    let duration = if trail.is_empty() {
        dekebab(&jv(duration))
    } else {
        trail.to_string()
    };
    format!("Duration: {duration}.")
}

/// Effect text plus an optional trailing duration line.
pub fn describe_effect_with_scope(e: &EffectNode, scope: Option<&Scope>) -> String {
    let effect = describe_effect(e);
    match scope.map(describe_scope).filter(|s| !s.is_empty()) {
        Some(line) if effect.is_empty() => line,
        Some(line) => format!("{effect}\n{line}"),
        None => effect,
    }
}

/// `Applies to: units with Possessed.` Mirrors `describeAppliesTo`.
pub fn describe_applies_to(filter: Option<&KeywordPredicate>) -> String {
    let Some(filter) = filter.map(to_value) else {
        return String::new();
    };
    let filter = obj(Some(&filter));
    let required = map_arr(filter, "all_of", jv).unwrap_or_default();
    let any = map_arr(filter, "any_of", jv).unwrap_or_default();
    let excluded = map_arr(filter, "none_of", jv).unwrap_or_default();
    let not_all = map_arr(filter, "not_all_of", jv).unwrap_or_default();
    if required.is_empty() && any.is_empty() && excluded.is_empty() && not_all.is_empty() {
        return String::new();
    }
    let base = if !required.is_empty() && any.is_empty() {
        format!("{} units", required.join(" "))
    } else {
        let positive = [
            if required.is_empty() {
                String::new()
            } else {
                required.join(", ")
            },
            if any.is_empty() {
                String::new()
            } else {
                format!("the {} keyword", or_list(&any))
            },
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" and ");
        if positive.is_empty() {
            "all units".to_string()
        } else {
            format!("units with {positive}")
        }
    };
    let exc = if excluded.is_empty() {
        String::new()
    } else {
        format!(" (excluding {} units)", or_list(&excluded))
    };
    let partial = if not_all.is_empty() {
        String::new()
    } else {
        format!(" (excluding units with all of {})", and_list(&not_all))
    };
    format!("Applies to: {base}{exc}{partial}.")
}

/// Compose the full ability print: woven effect sentence + an optional `Applies to:` line.
/// Renders as a non-optional ability; see [`describe_ability_parts_with_optional`].
pub fn describe_ability_parts(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
) -> String {
    describe_ability_parts_with_optional(e, scope, applies_to, usage, trigger, false)
}

/// [`describe_ability_parts`] with the record's `optional`: an ability the player chooses to use
/// gains a leading `You can: `. The single assembler used by both [`describe_ability`] and the
/// runner's `translate_effect` op.
pub fn describe_ability_parts_with_optional(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
    optional: bool,
) -> String {
    describe_ability_parts_for(e, scope, applies_to, usage, trigger, optional, None)
}

/// [`describe_ability_parts_with_optional`] with the record's own `ability_id`: a Stratagem's
/// restriction on its own use reads "you cannot use this Stratagem".
pub fn describe_ability_parts_for(
    e: &EffectNode,
    scope: Option<&Scope>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&AbilityUsage>,
    trigger: Option<&AbilityTrigger>,
    optional: bool,
    ability_id: Option<&str>,
) -> String {
    describe_ability_value_for(
        &to_value(e),
        scope.map(to_value).as_ref(),
        applies_to,
        usage.map(to_value).as_ref(),
        trigger.map(to_value).as_ref(),
        optional,
        ability_id,
    )
}

/// [`describe_ability_parts_with_optional`] over the records' JSON form. Renders an effect the
/// generated types do not model, such as the cruncher's generated `dice-table-result` leaf.
pub fn describe_ability_value_with_optional(
    e: &Value,
    scope: Option<&Value>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&Value>,
    trigger: Option<&Value>,
    optional: bool,
) -> String {
    describe_ability_value_for(e, scope, applies_to, usage, trigger, optional, None)
}

/// [`describe_ability_value_with_optional`] with the record's own `ability_id` (see
/// [`describe_ability_parts_for`]).
pub fn describe_ability_value_for(
    e: &Value,
    scope: Option<&Value>,
    applies_to: Option<&KeywordPredicate>,
    usage: Option<&Value>,
    trigger: Option<&Value>,
    optional: bool,
    ability_id: Option<&str>,
) -> String {
    let rendered = render_top_level(e, scope, usage, trigger, optional, ability_id);
    let base = if optional {
        with_optionality(&rendered)
    } else {
        rendered
    };
    let applies = describe_applies_to(applies_to);
    [base, applies]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Full generated text for an ability. Mirrors `describeAbility`.
pub fn describe_ability(a: &Ability) -> String {
    describe_ability_parts_for(
        &a.effect,
        Some(&a.scope),
        a.applies_to.as_ref(),
        a.usage.as_ref(),
        a.trigger.as_ref(),
        a.optional == Some(true),
        Some(a.ability_id.as_str()),
    )
}

/// The first aura an effect applies through its conditions, sequences and parts.
fn first_aura(e: &P) -> Option<&P> {
    if ty(e) == "aura" {
        return nn(obj(e.get("modifier")), "range_bonus")
            .is_none()
            .then_some(e);
    }
    let steps = e.get("steps").and_then(Value::as_array);
    e.get("effect")
        .into_iter()
        .chain(steps.into_iter().flatten())
        .filter_map(Value::as_object)
        .find_map(first_aura)
}

/// A trigger whose subject is the aura's recipient names the unit the aura reaches ("an enemy
/// unit within 6\" of this unit"), carried to the trigger describer as `{aura_recipient}`.
pub(super) fn with_aura_recipient(t: &Value, effect: &P, ctx: &Ctx) -> Value {
    if t.get("subject").and_then(Value::as_str) != Some("recipient") {
        return t.clone();
    }
    let Some(aura) = first_aura(effect) else {
        return t.clone();
    };
    let (recipient, within) = super::aura_reach(aura, obj(aura.get("modifier")), ctx);
    let mut t2 = obj(Some(t)).clone();
    t2.insert(
        "subject".into(),
        serde_json::json!({ "aura_recipient": format!("{recipient} {within}") }),
    );
    Value::Object(t2)
}

/// A part's moment phrases, naming the unit its aura reaches when the moment is the recipient's.
pub(super) fn part_trigger_phrases(e: &P) -> String {
    // A part armed for the phase that fires when the phase ends fires once, at the end of this phase.
    if is_this_phase_end(e) {
        return "at the end of the phase".to_string();
    }
    let effect = obj(e.get("effect"));
    normalize_triggers(e.get("trigger"))
        .into_iter()
        .map(|t| {
            crate::translate::trigger::describe_trigger_value(&with_aura_recipient(
                t,
                effect,
                &Ctx::default(),
            ))
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" or ")
}

/// A part armed for the phase (`duration: "phase"`) whose trigger is only the end of a phase,
/// with no phase, turn or other gate named.
pub(super) fn is_this_phase_end(e: &P) -> bool {
    // The typed round-trip writes a trigger's default `optional: false`; it names no gate.
    let gates = |t: &P| {
        t.iter()
            .filter(|(k, v)| {
                !v.is_null() && (k.as_str() != "optional" || **v != Value::Bool(false))
            })
            .count()
    };
    sv(e, "duration") == Some("phase")
        && e.get("trigger")
            .and_then(Value::as_object)
            .is_some_and(|t| gates(t) == 1 && sv(t, "event") == Some("phase-ended"))
}

/// What leads a part: its moment, usage limit, duration, name, the choice to use it and its cost.
pub(super) fn part_head(e: &P) -> String {
    let moment = part_trigger_phrases(e);
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
    // Skip when the inner designate-target / persistent-designation already prints the same duration.
    let inner_map = obj(e.get("effect"));
    let own_desig_dur = matches!(ty(inner_map), "designate-target" | "persistent-designation")
        && nn(inner_map, "duration") == nn(e, "duration");
    let trail = if own_desig_dur || is_this_phase_end(e) {
        ""
    } else {
        duration_clauses(e.get("duration")).1
    };
    // A part's own control-lost duration leads it, with no objective marker before it for "it" to name.
    let trail = match trail.strip_suffix("control it") {
        Some(head) => format!("{head}control that objective marker"),
        None => trail.to_string(),
    };
    join_nonempty(&[&label, &moment, &usage, &trail, &named, &cost], ", ")
}
