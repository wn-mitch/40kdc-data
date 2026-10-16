//! The designation containers: `designate-target` and `persistent-designation`, with their
//! target phrases, consumer clauses and lifecycle sentences. Mirrors the matching helpers in
//! `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::menu::duration_clauses;
use super::select::*;
use super::words::*;
use super::{empty_value, inline};
use crate::translate::condition::{nn, obj, P};

/// "(your Suppressed target)" — a designate-target mark's parenthetical.
pub(crate) fn designation_label(designation: Option<&Value>) -> String {
    let label = title_case(&jstr(designation));
    if has_word_suffix(&label, "Target") {
        format!(" (your {label})")
    } else {
        format!(" (your {label} target)")
    }
}

/// `/\b<word>$/.test(s)`.
pub(super) fn has_word_suffix(s: &str, word: &str) -> bool {
    s.strip_suffix(word).is_some_and(|head| {
        !head
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

pub(crate) fn designation_target_subject(sel: &P) -> String {
    let selector = obj(sel.get("selector"));
    if sv(sel, "kind") == Some("objective") {
        super::bind::objective_selector_phrase(selector)
    } else {
        format!(
            "{}{}",
            select_units_subject(selector),
            selection_binding(selector)
        )
    }
}

pub(crate) fn designation_attacker_phrase(applies: &P, block: bool) -> String {
    let model_filter = nn(applies, "attacker_filter").map(|value| obj(Some(value)));
    let unit_filter = nn(applies, "attacker_unit_filter").map(|value| obj(Some(value)));
    let subject = |filter: &P, model: bool, own_unit: bool| {
        let mut filter = filter.clone();
        if own_unit {
            filter.insert("owner".into(), Value::from("any"));
            filter.insert("level".into(), Value::from("model"));
        } else {
            filter.entry("owner").or_insert(Value::from("friendly"));
            if model {
                filter.entry("level").or_insert(Value::from("model"));
            }
        }
        let mut selector = P::new();
        selector.insert("filter".into(), Value::Object(filter));
        selector_subject(&selector, false)
    };
    let attacker = match (model_filter, unit_filter) {
        (Some(model), Some(unit)) => format!(
            "a {} in a {}",
            subject(model, true, true),
            subject(unit, false, false)
        ),
        (None, Some(unit)) => format!("a model in a {}", subject(unit, false, false)),
        (Some(model), None) => format!("a {}", subject(model, true, false)),
        _ => "a friendly unit".to_string(),
    };
    format!(
        "each time {attacker} {}",
        if block {
            "makes an attack against it"
        } else {
            "attacks it"
        }
    )
}

pub(crate) fn designated_attack_when(applies: &P) -> String {
    let source = selection_ref_name(applies.get("beneficiary"), "the selected beneficiary unit");
    let target = selection_ref_name(applies.get("reference"), "the selected designated target");
    format!("each time {source} makes an attack against {target}")
}

pub(crate) fn designated_recipient_context(applies: &P, ctx: &Ctx) -> Ctx {
    if sv(applies, "to") != Some("bound-unit-attacks-reference") {
        return ctx.clone();
    }
    Ctx {
        unit_subject: Some(selection_ref_name(
            applies.get("beneficiary"),
            "the selected beneficiary unit",
        )),
        ..ctx.clone()
    }
}

/// The select map of a designation (`typeof e.select === "object" ? e.select : {}`).
pub(crate) fn select_of(e: &P) -> &P {
    obj(e.get("select").filter(|s| s.is_object()))
}

/// "Select" or "select" lead of a canonical designation.
pub(crate) fn designation_select_lead(_sel: &P, capital: bool) -> String {
    if capital {
        "Select".to_string()
    } else {
        "select".to_string()
    }
}

/// The "when" clause of a designate-target consumer.
pub(crate) fn designate_when(applies: &P, block: bool) -> String {
    match sv(applies, "to") {
        Some("target") => "while it is your target".to_string(),
        Some("bearer-attacks-target") => if block {
            "each time this unit makes an attack against it"
        } else {
            "each time this unit attacks it"
        }
        .to_string(),
        Some("bound-unit-attacks-reference") => designated_attack_when(applies),
        _ => designation_attacker_phrase(applies, block),
    }
}

/// The designate-target inline form.
pub(crate) fn designate_target_inline(e: &P, ctx: &Ctx) -> String {
    let sel = select_of(e);
    let desig = if truthy_key(e, "designation") {
        designation_label(e.get("designation"))
    } else {
        String::new()
    };
    let applies = obj(nn(e, "applies"));
    let (_, trail) = duration_clauses(e.get("duration"));
    let when = designate_when(applies, false);
    let when_clause = if trail.is_empty() {
        when
    } else {
        format!("{trail}, {when}")
    };
    let recipient_ctx = designated_recipient_context(applies, ctx);
    format!(
        "{} {}{desig}; {when_clause}, {}",
        designation_select_lead(sel, false),
        designation_target_subject(sel),
        inline(
            nn(applies, "effect").unwrap_or(empty_value()),
            &recipient_ctx
        )
    )
}

pub(super) fn persistent_name(designation: Option<&Value>, scope: Option<&str>) -> String {
    let label = title_case(&jstr(designation));
    if scope == Some("objective") {
        return if has_word_suffix(&label, "Marker") {
            format!("your {label}")
        } else {
            format!("your {label} Marker")
        };
    }
    if has_word_suffix(&label, "Target") {
        format!("your {label}")
    } else {
        format!("your {label} target")
    }
}

pub(super) fn persistent_label(designation: Option<&Value>, scope: Option<&str>) -> String {
    format!(" ({})", persistent_name(designation, scope))
}

pub(crate) fn persistent_supported(e: &P) -> bool {
    let select = obj(nn(e, "select"));
    let consumer = obj(nn(e, "consumer"));
    let recipient = matches!(
        sv(consumer, "beneficiary"),
        Some("this-model" | "this-unit")
    );
    let kind = sv(select, "kind");
    let relation = sv(consumer, "relation");
    recipient
        && ((kind == Some("unit") && relation == Some("attacks-selected-unit"))
            || (kind == Some("objective") && relation == Some("within-selected-marker")))
}

pub(crate) fn persistent_lead(e: &P) -> String {
    let select = select_of(e);
    let kind = sv(select, "kind");
    let noun = designation_target_subject(select);
    let label = persistent_label(e.get("designation"), kind);
    let mut clauses = vec![format!("select {noun}{label}.")];
    if is_true(e, "allow_while_embarked") {
        clauses.push("This selection can be made while this unit is embarked.".to_string());
    }
    let lifecycle = obj(nn(e, "lifecycle"));
    if sv(e, "selection_policy") == Some("replace-on-destroyed") && truthy_key(lifecycle, "replace")
    {
        let replacement = obj(lifecycle.get("replace"));
        let name = persistent_name(e.get("designation"), kind);
        clauses.push(format!(
            "When {name} is destroyed, {} select {noun} to replace it.",
            if is_true(replacement, "optional") {
                "you may"
            } else {
                "you must"
            }
        ));
    }
    if sv(lifecycle, "exclusivity") == Some("one-active-per-bearer-unit") {
        clauses.push("Only one such designation can be active for this bearer unit.".to_string());
    }
    clauses.join(" ")
}

pub(crate) fn persistent_when(e: &P) -> String {
    let select = select_of(e);
    let consumer = obj(nn(e, "consumer"));
    let name = persistent_name(e.get("designation"), sv(select, "kind"));
    let bearer = if sv(consumer, "beneficiary") == Some("this-unit") {
        "a model in this unit"
    } else {
        "this model"
    };
    let relation = if sv(consumer, "relation") == Some("within-selected-marker") {
        format!("while {bearer} is within range of {name}")
    } else {
        format!("each time {bearer} makes an attack against it")
    };
    let (_, trail) = duration_clauses(e.get("duration"));
    if trail.is_empty() {
        relation
    } else {
        format!("{}, {relation}", capitalize(trail))
    }
}

pub(crate) fn persistent_replacement(e: &P) -> String {
    let select = select_of(e);
    let kind = sv(select, "kind");
    let replacement = obj(obj(nn(e, "lifecycle")).get("replace"));
    let previous = persistent_name(e.get("designation"), kind);
    let label = persistent_label(e.get("designation"), kind);
    let embarked = if is_true(e, "allow_while_embarked") {
        ". This selection can be made while this unit is embarked"
    } else {
        ""
    };
    format!(
        "when {previous} is destroyed, {} select {}{label} to replace this bearer unit's existing designation. Its existing effects apply to the new target without changing the designation's expiry{embarked}",
        if is_true(replacement, "optional") { "you may" } else { "you must" },
        designation_target_subject(select),
    )
}
