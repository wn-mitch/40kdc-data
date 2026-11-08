//! A condition on each unit an effect reaches ("While an enemy unit is within 3\" of this unit,
//! that unit has -1 OC"). Mirrors `tools/src/translate/effect-recipient-gate.ts`.

use serde_json::Value;

use super::words::Ctx;
use crate::translate::condition::{
    condition_lead_in_for, is_defensive_effect, nn, unit_filter_phrase, P,
};

/// A gated effect's parts: the condition lead-in, the effect aimed at the recipient, and its context.
pub(super) struct RecipientGate {
    pub lead: String,
    pub inner: Value,
    pub ctx: Ctx,
}

/// The condition with every `recipient` subject read as "that unit" (`event-object`).
fn as_that_unit(c: &Value) -> Value {
    let Some(m) = c.as_object() else {
        return c.clone();
    };
    let mut out = m.clone();
    if let Some(Value::Object(p)) = m.get("parameters") {
        if p.get("subject").and_then(Value::as_str) == Some("recipient") {
            let mut p = p.clone();
            p.insert("subject".into(), Value::String("event-object".into()));
            out.insert("parameters".into(), Value::Object(p));
        }
    }
    if let Some(Value::Array(ops)) = m.get("operands") {
        out.insert(
            "operands".into(),
            Value::Array(ops.iter().map(as_that_unit).collect()),
        );
    }
    Value::Object(out)
}

fn names_recipient(c: &Value) -> bool {
    c.get("parameters")
        .and_then(|p| p.get("subject"))
        .and_then(Value::as_str)
        == Some("recipient")
        || c.get("operands")
            .and_then(Value::as_array)
            .is_some_and(|ops| ops.iter().any(names_recipient))
}

fn is_leaf(e: &P) -> bool {
    nn(e, "effect").is_none() && nn(e, "steps").is_none() && nn(e, "options").is_none()
}

/// The unit filter a leaf, or every step of a sequence of leaves, is aimed at; None when they do
/// not share one.
fn shared_filter(inner: &P) -> Option<P> {
    let sequence = inner.get("type").and_then(Value::as_str) == Some("sequence");
    let leaves: Vec<&P> = if sequence {
        nn(inner, "steps")?
            .as_array()?
            .iter()
            .map(Value::as_object)
            .collect::<Option<Vec<_>>>()?
    } else {
        vec![inner]
    };
    if leaves.is_empty() || !leaves.iter().all(|leaf| is_leaf(leaf)) {
        return None;
    }
    let target = nn(leaves[0], "target")?.as_object()?;
    leaves
        .iter()
        .all(|leaf| leaf.get("target") == Some(&Value::Object(target.clone())))
        .then(|| target.clone())
}

/// A condition on each unit the effect reaches (subject `recipient`) gating a leaf effect, or a
/// sequence of leaves, aimed at one unit filter. The condition names the unit with the filter's
/// phrase; its later mentions and the effects say "that unit" (or "that model"). None when the
/// shape is not that one.
pub(super) fn recipient_gate(e: &P, ctx: &Ctx) -> Option<RecipientGate> {
    let condition = nn(e, "condition")?;
    let inner_value = nn(e, "effect")?;
    let inner = inner_value.as_object()?;
    if !names_recipient(condition) {
        return None;
    }
    let filter = &shared_filter(inner)?;
    let sequence = inner.get("type").and_then(Value::as_str) == Some("sequence");
    let defended = if sequence {
        &inner["steps"][0]
    } else {
        inner_value
    };
    let model = filter.get("level").and_then(Value::as_str) == Some("model");
    let that = if model { "that model" } else { "that unit" };
    let lead = condition_lead_in_for(&as_that_unit(condition), is_defensive_effect(defended))
        .replace("that unit", that);
    let at = lead.find(that)?;
    let lead = format!(
        "{}{}{}",
        &lead[..at],
        unit_filter_phrase(filter),
        &lead[at + that.len()..]
    );
    let mut inner = inner.clone();
    let recipient = Value::String("recipient".into());
    if sequence {
        if let Some(Value::Array(steps)) = inner.get_mut("steps") {
            for step in steps.iter_mut().filter_map(Value::as_object_mut) {
                step.insert("target".into(), recipient.clone());
            }
        }
    } else {
        inner.insert("target".into(), recipient);
    }
    let mut ctx = ctx.clone();
    if model {
        ctx.each_model = true;
    } else {
        ctx.aura_recipient = true;
    }
    Some(RecipientGate {
        lead,
        inner: Value::Object(inner),
        ctx,
    })
}
