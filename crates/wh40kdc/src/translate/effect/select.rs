//! The selection containers: `select-units`, `for-each-unit`, `designate-target`,
//! `persistent-designation` and `leader-model-ability-grant`, with their selector phrases and
//! bound-selection names. Mirrors the matching helpers in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::inline;
use super::words::*;
use crate::translate::condition::{
    describe_selection_eligibility_value, nn, obj, or_list, truthy, P,
};
use crate::translate::dekebab;

/// "the bound reprise beneficiary" for a selection/event reference, else `fallback`.
pub(crate) fn selection_ref_name(r: Option<&Value>, fallback: &str) -> String {
    let value = r.and_then(Value::as_object).cloned().unwrap_or_default();
    let id = nn(&value, "selection_var").or_else(|| nn(&value, "event_var"));
    match id.and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(id) => format!("the bound {}", dekebab(&id.replace('_', "-"))),
        None => fallback.to_string(),
    }
}

/// ", binding it as <name>" when a selector binds its pick.
pub(crate) fn selection_binding(sel: &P) -> String {
    match sv(sel, "bind_as").filter(|s| !s.is_empty()) {
        Some(name) => format!(
            ", binding {} as {}",
            if sv(sel, "selection_mode") == Some("any-number") {
                "them"
            } else {
                "it"
            },
            dekebab(&name.replace('_', "-"))
        ),
        None => String::new(),
    }
}

/// Range/engagement origin phrase for a selector's `reference`.
pub(super) fn reference_origin(reference: Option<&Value>) -> &'static str {
    match reference.and_then(Value::as_str) {
        Some("bearer-transport") => "this model's unit's Transport",
        Some("bearer-unit") => "this model's unit",
        _ => "the bearer",
    }
}

pub(super) fn eligibility_clause(sel: &P, require_object: bool) -> String {
    match sel.get("eligibility") {
        Some(e) if (require_object && e.is_object()) || (!require_object && truthy(Some(e))) => {
            format!(" {}", describe_selection_eligibility_value(e))
        }
        _ => String::new(),
    }
}

fn target_noun(sel: &P) -> &'static str {
    if sv(sel, "target_kind") == Some("model") {
        "model"
    } else {
        "unit"
    }
}

fn selection_model_filters(sel: &P) -> String {
    let names = map_arr(sel, "model_names", jv)
        .map(|n| format!(" named {}", or_list(&n)))
        .unwrap_or_default();
    let exclusions = match map_arr(sel, "excluded_keywords", jv) {
        Some(ex) if !ex.is_empty() => {
            format!(" (excluding {}s with {})", target_noun(sel), or_list(&ex))
        }
        _ => String::new(),
    };
    names + &exclusions
}

pub(super) fn selection_limit_phrase(limit: &P, noun: &str) -> String {
    let times = if is_num(limit, "count", 1.0) {
        "once".to_string()
    } else {
        format!("{} times", jstr(limit.get("count")))
    };
    format!(
        "each {noun} can be selected for this ability at most {times} per {} across your army",
        dekebab(&jstr(limit.get("period")))
    )
}

/// "one enemy Vehicle unit within 12\"" — the `select-units` selector phrase.
pub(crate) fn select_units_subject(sel: &P) -> String {
    let kw = map_arr(sel, "keywords", |k| title_case(&jv(k)))
        .unwrap_or_default()
        .join(" ");
    let exact = nn(sel, "count").or_else(|| {
        (nn(sel, "min_count").is_some() && num(sel.get("min_count")) == num(sel.get("max_count")))
            .then(|| sel.get("max_count"))
            .flatten()
            .filter(|v| !v.is_null())
    });
    let bounded = nn(sel, "min_count").is_some() && exact.is_none();
    let count = exact.or_else(|| sel.get("max_count"));
    let single = num(count) == 1.0;
    let noun = if single {
        target_noun(sel).to_string()
    } else {
        format!("{}s", target_noun(sel))
    };
    let quantity = if exact.is_some() {
        if single {
            "one".to_string()
        } else {
            jstr(count)
        }
    } else if bounded {
        format!(
            "from {} through {}",
            jstr(sel.get("min_count")),
            jstr(sel.get("max_count"))
        )
    } else {
        format!("up to {}", jstr(count))
    };
    let bound_origin = if truthy_key(sel, "within_inches_from") {
        format!(
            " of {}",
            selection_ref_name(sel.get("within_inches_from"), "the bound source unit")
        )
    } else {
        String::new()
    };
    let within = if let Some(w) = nn(sel, "within_inches") {
        format!(" within {}\"{bound_origin}", jv(w))
    } else if let Some(r) = nn(sel, "range_inches") {
        let origin = if bound_origin.is_empty() {
            format!(" of {}", reference_origin(sel.get("reference")))
        } else {
            bound_origin
        };
        format!(" within {}\"{origin}", jv(r))
    } else {
        String::new()
    };
    let visible = if truthy_key(sel, "visible_to") {
        format!(
            " visible to {}",
            selection_ref_name(sel.get("visible_to"), "the bound source unit")
        )
    } else if is_true(sel, "visibility_required") {
        " visible to the bearer".to_string()
    } else {
        String::new()
    };
    let inclusive = if bounded { ", inclusive" } else { "" };
    let kw = if kw.is_empty() {
        String::new()
    } else {
        format!(" {kw}")
    };
    format!(
        "{quantity} {}{kw} {noun}{}{inclusive}{within}{visible}{}",
        jstr(sel.get("owner")),
        selection_model_filters(sel),
        eligibility_clause(sel, true)
    )
}

pub(crate) fn select_units_engagement(sel: &P) -> String {
    let mut parts = Vec::new();
    let noun = target_noun(sel);
    let origin = reference_origin(sel.get("reference"));
    match sv(sel, "engagement_relation") {
        Some("engaged-with-bearer") => parts.push(format!(
            "For each selected {noun}, it must be within Engagement Range of {origin}."
        )),
        Some("not-engaged-with-bearer") => parts.push(format!(
            "For each selected {noun}, it must not be within Engagement Range of {origin}."
        )),
        _ => {}
    }
    if let Some(limit) = sel.get("selection_limit").filter(|l| truthy(Some(l))) {
        parts.push(format!(
            "{}.",
            capitalize(&selection_limit_phrase(obj(Some(limit)), noun))
        ));
    }
    parts.join(" ")
}

pub(crate) fn select_units_plural(sel: &P) -> bool {
    num(nn(sel, "count").or_else(|| sel.get("max_count"))) > 1.0
}

/// Global `\b[Tt]<pat>\b` replacement, with `repl(capital)` choosing the text.
fn replace_the(text: &str, pat: &str, repl: impl Fn(bool) -> String) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < text.len() {
        let rest = &text[i..];
        let capital = rest.starts_with('T');
        let hit = (rest.starts_with('T') || rest.starts_with('t'))
            && rest[1..].starts_with(pat)
            && !text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
            && !text[i + 1 + pat.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if hit {
            out.push_str(&repl(capital));
            i += 1 + pat.len();
        } else {
            let ch = rest.chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

pub(crate) fn selected_recipient(text: &str, sel: &P) -> String {
    let noun = target_noun(sel);
    let recipient = if select_units_plural(sel) {
        format!("each selected {noun}")
    } else {
        format!("the selected {noun}")
    };
    let text = replace_the(text, "he unit's", |cap| {
        if cap {
            format!("Each selected {noun}'s")
        } else {
            format!("{recipient}'s")
        }
    });
    replace_the(&text, "he unit", |cap| {
        if cap {
            format!("Each selected {noun}")
        } else {
            recipient.clone()
        }
    })
}

pub(crate) fn selected_context(ctx: &Ctx, sel: &P) -> Ctx {
    let model = sv(sel, "target_kind") == Some("model");
    Ctx {
        selected_unit: !model,
        selected_model: model,
        unit_subject: None,
        ..ctx.clone()
    }
}

pub(crate) fn select_units_inline(sel: &P, effect: &Value, ctx: &Ctx) -> String {
    let subject = select_units_subject(sel);
    let engagement = select_units_engagement(sel);
    let binding = selection_binding(sel);
    let nested = selected_recipient(&inline(effect, &selected_context(ctx, sel)), sel);
    if engagement.is_empty() {
        format!("select {subject}{binding}: {nested}")
    } else {
        format!(
            "select {subject}{binding}. {engagement} {}",
            capitalize(&nested)
        )
    }
}

/// Render the beneficiary-only leader relation without exposing a bearer fallback.
pub(crate) fn leader_model_ability_grant_clause(e: &P, ctx: &Ctx) -> String {
    let filter = obj(nn(e, "leader_filter"));
    let identity = if truthy_key(filter, "identity") {
        title_case(&jstr(filter.get("identity")))
    } else {
        String::new()
    };
    let keywords = map_arr(filter, "keywords", bracket_keyword)
        .unwrap_or_default()
        .join(" and ");
    let role = if sv(e, "beneficiary") == Some("attached-character-leader") {
        "the attached CHARACTER leader model"
    } else {
        "the attached leader model"
    };
    let mut leader = role.to_string();
    if !identity.is_empty() {
        leader.push_str(&format!(" identified as {identity}"));
    }
    if !keywords.is_empty() {
        leader.push_str(&format!(" with {keywords}"));
    }
    let unit_keywords = map_arr(e, "attached_unit_filter", bracket_keyword)
        .unwrap_or_default()
        .join(" and ");
    let source = if unit_keywords.is_empty() {
        "the bearer unit".to_string()
    } else {
        format!("the bearer unit with {unit_keywords}")
    };
    let rendered = inline_with_this_model(e, ctx);
    format!("while {leader} leads {source}, {rendered}")
}

/// The granted effect rendered on the leader model, its leading "this model" renamed
/// (`rendered.replace(/^this model\b/, "that leader model")`).
fn inline_with_this_model(e: &P, ctx: &Ctx) -> String {
    let mut nested = obj(nn(obj(e.get("grant")), "effect")).clone();
    nested.insert("target".into(), Value::from("this-model"));
    let text = inline(&Value::Object(nested), ctx);
    match text.strip_prefix("this model") {
        Some(rest)
            if !rest
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_') =>
        {
            format!("that leader model{rest}")
        }
        _ => text,
    }
}

/// "enemy unit within 6\"" — the `for-each-unit` selector phrase.
pub(crate) fn for_each_unit_subject(sel: &P) -> String {
    let list = map_arr(sel, "keywords", |k| title_case(&jv(k))).unwrap_or_default();
    let keywords = if list.is_empty() {
        String::new()
    } else if sv(sel, "keyword_match") == Some("any") {
        format!("{} ", or_list(&list))
    } else {
        format!("{} ", list.join(" "))
    };
    let mut within = nn(sel, "within_inches")
        .map(|w| format!(" within {}\"", jv(w)))
        .unwrap_or_default();
    if truthy_key(sel, "within_objective") {
        within.push_str(&format!(
            " within range of {}",
            selection_ref_name(sel.get("within_objective"), "the selected objective marker")
        ));
    }
    let origin = reference_origin(sel.get("reference"));
    let engagement = match sv(sel, "engagement_relation") {
        Some("engaged-with-bearer") => format!(" in Engagement Range of {origin}"),
        Some("not-engaged-with-bearer") => format!(" not in Engagement Range of {origin}"),
        _ => String::new(),
    };
    let member = if sv(sel, "member_of") == Some("bearer-unit") {
        " in this model's unit"
    } else {
        ""
    };
    format!(
        "{} {keywords}{}{}{member}{within}{engagement}{}{}",
        jstr(sel.get("owner")),
        target_noun(sel),
        selection_model_filters(sel),
        eligibility_clause(sel, false),
        selection_binding(sel)
    )
}
