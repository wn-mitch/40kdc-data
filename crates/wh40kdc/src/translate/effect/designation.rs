//! The designation containers: `designate-target` and `persistent-designation`, with their
//! target phrases, consumer clauses and lifecycle sentences. Mirrors the matching helpers in
//! `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::menu::duration_clauses;
use super::select::*;
use super::words::*;
use super::{empty_value, inline};
use crate::translate::condition::{nn, obj, truthy, P};
use crate::translate::describe_timing;

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

pub(super) fn designation_target_subject_base(sel: &P) -> String {
    let disposition = if sv(sel, "scope") == Some("friendly-unit") {
        "friendly"
    } else {
        "enemy"
    };
    let keywords = map_arr(sel, "keywords", |k| title_case(&jv(k))).unwrap_or_default();
    let join = if sv(sel, "keyword_match") == Some("any") {
        " or "
    } else {
        " "
    };
    let keyword_text = if keywords.is_empty() {
        String::new()
    } else {
        format!(" {}", keywords.join(join))
    };
    let reference = reference_origin(sel.get("reference"));
    let origin = if truthy_key(sel, "within_inches_from") {
        format!(
            " of {}",
            selection_ref_name(sel.get("within_inches_from"), "the bound source unit")
        )
    } else if truthy_key(sel, "reference") {
        format!(" of {reference}")
    } else {
        String::new()
    };
    let within = nn(sel, "within_inches")
        .map(|w| format!(" within {}\"{origin}", jv(w)))
        .unwrap_or_default();
    let visible = if truthy_key(sel, "visible_to") {
        format!(
            " visible to {}",
            selection_ref_name(sel.get("visible_to"), "the bound source unit")
        )
    } else if truthy_key(sel, "visibility_required") {
        format!(" visible to {reference}")
    } else {
        String::new()
    };
    let exclusions = match map_arr(sel, "excluded_keywords", jv) {
        Some(ex) if !ex.is_empty() => format!(" (excluding {} units)", ex.join(" and ")),
        _ => String::new(),
    };
    format!("{disposition}{keyword_text} unit{within}{visible}{exclusions}")
}

pub(crate) fn designation_target_subject(sel: &P) -> String {
    let limit = match sel.get("selection_limit").filter(|l| truthy(Some(l))) {
        Some(l) => format!(" ({})", selection_limit_phrase(obj(Some(l)), "unit")),
        None => String::new(),
    };
    format!(
        "{}{}{}{limit}",
        designation_target_subject_base(sel),
        eligibility_clause(sel, false),
        selection_binding(sel)
    )
}

pub(super) fn joined_keywords(applies: &P, k: &str) -> String {
    map_arr(applies, k, jv).unwrap_or_default().join(" ")
}

pub(crate) fn designation_attacker_phrase(applies: &P, block: bool) -> String {
    let model = joined_keywords(applies, "attacker_keywords");
    let unit = joined_keywords(applies, "attacker_unit_keywords");
    let attacker = if !unit.is_empty() {
        let model = if model.is_empty() {
            String::new()
        } else {
            format!(" {model}")
        };
        format!("a{model} model in a friendly {unit} unit")
    } else if !model.is_empty() {
        format!("a friendly {model} model")
    } else {
        "a friendly unit".to_string()
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

/// "Select one …" lead of a designation, with its own timing.
pub(crate) fn designation_select_lead(sel: &P, capital: bool) -> String {
    match sel.get("timing").filter(|t| truthy(Some(t))) {
        Some(t) => {
            let timing = describe_timing(&jv(t));
            format!(
                "{}, select",
                if capital { capitalize(&timing) } else { timing }
            )
        }
        None if capital => "Select".to_string(),
        None => "select".to_string(),
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
        "{} one {}{desig}; {when_clause}, {}",
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
    if scope == Some("objective-marker") {
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
    let select = select_of(e);
    let consumer = obj(nn(e, "consumer"));
    let beneficiary = sv(consumer, "beneficiary");
    let recipient = beneficiary == Some("bearer") || beneficiary == Some("unit");
    let scope = sv(select, "scope");
    let relation = sv(consumer, "relation");
    recipient
        && ((scope == Some("enemy-unit") && relation == Some("attacks-selected-unit"))
            || (scope == Some("objective-marker") && relation == Some("within-selected-marker")))
}

pub(crate) fn persistent_lead(e: &P) -> String {
    let select = select_of(e);
    let scope = sv(select, "scope");
    let noun = if scope == Some("objective-marker") {
        "objective marker"
    } else {
        "enemy unit"
    };
    let label = persistent_label(e.get("designation"), scope);
    let mut clauses = vec![format!(
        "{} one {noun}{label}{}.",
        designation_select_lead(select, false),
        selection_binding(select)
    )];
    if truthy_key(select, "allow_while_embarked") {
        clauses.push("This selection can be made while this unit is embarked.".to_string());
    }
    let lifecycle = obj(nn(e, "lifecycle"));
    if sv(select, "selection_policy") == Some("replace-on-destroyed")
        && truthy_key(lifecycle, "replace")
    {
        let replacement = obj(lifecycle.get("replace"));
        let name = selection_ref_name(
            replacement.get("reference"),
            &persistent_name(e.get("designation"), scope),
        );
        clauses.push(format!(
            "When {name} is destroyed, {} select one new {noun} to replace it.",
            if truthy_key(replacement, "optional") {
                "you may"
            } else {
                "you must"
            }
        ));
    }
    if sv(lifecycle, "exclusivity") == Some("one-active-per-bearer-unit") {
        clauses.push("Only one such designation can be active for this bearer unit.".to_string());
    }
    if sv(lifecycle, "expiry") == Some("battle-end") && sv(e, "duration") != Some("battle") {
        clauses.push("This designation expires at the end of the battle.".to_string());
    }
    clauses.join(" ")
}

pub(crate) fn persistent_when(e: &P) -> String {
    let select = select_of(e);
    let consumer = obj(nn(e, "consumer"));
    let name = selection_ref_name(
        consumer.get("reference"),
        &persistent_name(e.get("designation"), sv(select, "scope")),
    );
    let bearer = if sv(consumer, "beneficiary") == Some("unit") {
        "a model in this unit"
    } else {
        "this model"
    };
    let relation = if sv(consumer, "relation") == Some("within-selected-marker") {
        format!("while {bearer} is within range of {name}")
    } else {
        let whom = if truthy_key(consumer, "reference") {
            name
        } else {
            "it".to_string()
        };
        format!("each time {bearer} makes an attack against {whom}")
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
    let scope = sv(select, "scope");
    let replacement = obj(obj(nn(e, "lifecycle")).get("replace"));
    let previous = selection_ref_name(
        replacement.get("reference"),
        &persistent_name(e.get("designation"), scope),
    );
    let label = persistent_label(e.get("designation"), scope);
    let embarked = if truthy_key(select, "allow_while_embarked") {
        ". This selection can be made while this unit is embarked"
    } else {
        ""
    };
    format!(
        "when {previous} is destroyed, {} select one new enemy unit{label} to replace this bearer unit's existing designation{}. Its existing effects apply to the new target without changing the designation's battle-end expiry{embarked}",
        if truthy_key(replacement, "optional") {
            "you may"
        } else {
            "you must"
        },
        selection_binding(select)
    )
}
