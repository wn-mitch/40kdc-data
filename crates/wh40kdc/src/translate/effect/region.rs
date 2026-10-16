//! The `named-region-state` container: a named region's producers (baseline zones, phase
//! extensions, unit-proximity additions) and its consumer's default and qualified branches.
//! Mirrors the `namedRegion*` helpers in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::inline;
use super::subject::filter_subject;
use super::words::*;
use crate::translate::condition::{describe_condition_value, nn, obj, operands, range_phrase, P};
use crate::translate::dekebab;
use crate::translate::expiry::expiry_trail;

fn title(v: Option<&Value>) -> String {
    title_case(&jstr(v))
}

fn relation(v: Option<&Value>) -> String {
    let r = jstr(v);
    if r == "wholly-within" {
        "wholly within".to_string()
    } else {
        dekebab(&r)
    }
}

fn entries<'a>(p: &'a P, k: &str) -> &'a [Value] {
    arr(p, k).map(Vec::as_slice).unwrap_or(&[])
}

fn region_name(v: Option<&Value>) -> String {
    region_phrase(obj(v))
}

fn prefix(m: &P) -> String {
    let region = title(obj(m.get("region_ref")).get("region_id"));
    let producer = obj(m.get("producer"));
    let mut sentences = Vec::new();
    for entry in entries(producer, "baseline") {
        let entry = obj(Some(entry));
        let source = capitalize(&region_name(entry.get("region")));
        let trail = expiry_trail(entry.get("duration"));
        sentences.push(format!(
            "{source} is within {region}{}.",
            if trail.is_empty() {
                String::new()
            } else {
                format!(" {trail}")
            }
        ));
    }
    for entry in entries(producer, "phase_extensions") {
        let entry = obj(Some(entry));
        let source = region_name(entry.get("region"));
        let condition = nn(entry, "condition")
            .map(|c| describe_condition_value(c))
            .unwrap_or_else(|| "?".to_string());
        let trigger = super::menu::normalize_triggers(entry.get("trigger"))
            .into_iter()
            .map(crate::translate::trigger::describe_trigger_value)
            .filter(|phrase| !phrase.is_empty())
            .collect::<Vec<_>>()
            .join(" or ");
        let trail = expiry_trail(entry.get("duration"));
        sentences.push(format!(
            "{}, if {condition}, {source} is within {region}{} (evaluated once at that time).",
            capitalize(&trigger),
            if trail.is_empty() {
                String::new()
            } else {
                format!(" {trail}")
            }
        ));
    }
    for entry in entries(producer, "additive_extensions") {
        let entry = obj(Some(entry));
        let filter = obj(entry.get("filter"));
        let source = filter_subject(filter, &Ctx::default());
        sentences.push(format!(
            "The area within {} of one or more {source} is within {region}, continuously as those units move.",
            range_phrase(entry.get("range"))
        ));
    }
    sentences.join(" ")
}

fn subject(m: &P) -> String {
    let consumer = obj(m.get("consumer"));
    let beneficiary = obj(consumer.get("beneficiary_filter"));
    filter_subject(beneficiary, &Ctx::default())
}

fn branch_text(m: &P, whole_unit: bool, qualified: bool, conditional: bool, ctx: &Ctx) -> String {
    let consumer = obj(m.get("consumer"));
    let branch = obj(consumer.get(if qualified {
        "qualified_branch"
    } else {
        "default_branch"
    }));
    let subject = subject(m);
    let effect_ctx = Ctx {
        unit_subject: Some(subject.clone()),
        ..ctx.clone()
    };
    let effect = inline(branch.get("effect").unwrap_or(&Value::Null), &effect_ctx);
    if conditional {
        return effect;
    }
    if !qualified {
        return format!("{}.", capitalize(&effect));
    }
    let condition = consumer
        .get("qualified_condition")
        .filter(|c| c.is_object());
    if let Some(c) = condition.filter(|c| !obj(Some(c)).is_empty()) {
        return format!("If {}, {effect} instead", describe_condition_value(c));
    }
    let membership = obj(consumer.get("membership"));
    let region = title(obj(m.get("region_ref")).get("region_id"));
    let rel = relation(membership.get("relation"));
    let who = if whole_unit {
        format!("If such a unit is {rel} {region},")
    } else {
        format!("If such a model is {rel} {region},")
    };
    format!("{who} {effect} instead")
}

fn whole_unit(m: &P) -> bool {
    let membership = obj(obj(m.get("consumer")).get("membership"));
    sv(membership, "unit_scope") == Some("whole-unit")
}

/// A `named-region-state` on its own.
pub(crate) fn describe_named_region_state(m: &P, ctx: &Ctx) -> String {
    let consumer = obj(m.get("consumer"));
    let whole = whole_unit(m);
    let gate = match consumer.get("attack_condition") {
        Some(c) if crate::translate::condition::truthy(Some(c)) => format!(
            "For each qualifying attack ({}): ",
            describe_condition_value(c)
        ),
        _ => String::new(),
    };
    format!(
        "{} {gate}{} {}",
        prefix(m),
        branch_text(m, whole, false, false, ctx),
        branch_text(m, whole, true, false, ctx)
    )
}

/// A `conditional` wrapping a `named-region-state`: the condition picks the branch.
pub(crate) fn describe_named_region_conditional(m: &P, condition: &Value, ctx: &Ctx) -> String {
    let whole = whole_unit(m);
    let negated = condition.get("operator").and_then(Value::as_str) == Some("not")
        && operands(condition).is_some_and(|o| o.len() == 1);
    let predicate = if negated {
        describe_condition_value(&operands(condition).unwrap()[0])
    } else {
        describe_condition_value(condition)
    };
    let default_text = branch_text(m, whole, false, true, ctx);
    let qualified_text = branch_text(m, whole, true, true, ctx);
    if negated {
        return format!(
            "{} Unless {predicate}, {default_text}. If {predicate}, {qualified_text}.",
            prefix(m)
        );
    }
    format!(
        "{} When {predicate}, {qualified_text}. Otherwise, {default_text}.",
        prefix(m)
    )
}
