//! The dice containers' shared phrases: dice-gated rolls and Leadership tests, dice tables,
//! dice-pool requirements and the roll-with-rider sequence. Mirrors the matching helpers in
//! `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::words::*;
use super::{child, inline, items, ty};
use crate::translate::condition::{describe_condition_value, nn, obj, truthy, P};
use crate::translate::dekebab;

/// A dice-pool option requirement: `pair of 4+`, or an `any_of` set joined with " or ".
pub(super) fn describe_requirement(req: Option<&Value>) -> String {
    let one = |r: Option<&Value>| {
        let r = obj(r);
        format!("{} of {}+", jstr(r.get("type")), jstr(r.get("min_value")))
    };
    match req.and_then(|r| r.get("any_of")).and_then(Value::as_array) {
        Some(any) => any
            .iter()
            .map(|r| one(Some(r)))
            .collect::<Vec<_>>()
            .join(" or "),
        None => one(req),
    }
}

pub(super) fn dice_table_result_label(results: Option<&Value>) -> String {
    let Some(results) = results.and_then(Value::as_array) else {
        return String::new();
    };
    let mut faces: Vec<f64> = results.iter().filter_map(Value::as_f64).collect();
    faces.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let consecutive = faces.windows(2).all(|w| w[1] == w[0] + 1.0);
    if faces.len() > 1 && consecutive {
        return format!("{}-{}", fnum(faces[0]), fnum(faces[faces.len() - 1]));
    }
    faces
        .iter()
        .map(|f| fnum(*f))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn dice_table_inline(e: &P, ctx: &Ctx) -> String {
    let outcomes: Vec<String> = items(e, "outcomes")
        .iter()
        .map(|o| {
            let o = obj(Some(o));
            format!(
                "on {}, {}",
                dice_table_result_label(o.get("results")),
                inline(child(o, "effect"), ctx)
            )
        })
        .collect();
    format!(
        "roll one {}: {}",
        dice_case(e.get("dice")),
        outcomes.join("; ")
    )
}

/// A roll-with-rider `sequence`: `[dice-gated rider, unconditional primary]`.
pub(super) fn roll_with_rider(steps: &[Value], ctx: &Ctx) -> Option<String> {
    let [first, second] = steps else {
        return None;
    };
    let g = obj(Some(first));
    if ty(g) != "dice-gated" || !is_true(g, "rider") {
        return None;
    }
    let success = nn(g, "on_success")?;
    let comp = format_comparison(
        &jstr(Some(nn(g, "comparison").unwrap_or(&Value::from("gte")))),
        g.get("threshold"),
    );
    Some(format!(
        "roll one {}. On {comp}, {}. Regardless of the result, {}",
        dice_case(g.get("dice")),
        inline(success, ctx),
        inline(second, ctx)
    ))
}

pub(super) fn leadership_test(e: &P, ctx: &Ctx) -> String {
    let test = obj(e.get("test"));
    let who = match sv(test, "subject") {
        Some("self") => "this model",
        Some("target") => "the target unit",
        _ => "that unit",
    };
    let battle_shock = sv(test, "kind") == Some("battle-shock");
    let kind = if battle_shock {
        "Battle-shock"
    } else {
        "Leadership"
    };
    let modifiers = items(test, "modifiers")
        .iter()
        .map(|m| {
            let m = obj(Some(m));
            format!(
                "apply {} if {}",
                signed(Some(&Value::from("add")), m.get("value")),
                describe_condition_value(child(m, "condition"))
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let success = gated_success(e, ctx);
    let mut failures = Vec::new();
    if battle_shock {
        failures.push(format!("{who} becomes Battle-shocked"));
    }
    if let Some(f) = e.get("on_fail").filter(|f| truthy(Some(f))) {
        failures.push(inline(f, ctx));
    }
    let fail = if failures.is_empty() {
        String::new()
    } else {
        format!("; otherwise, {}", failures.join("; "))
    };
    let modifiers = if modifiers.is_empty() {
        String::new()
    } else {
        format!("; {modifiers}")
    };
    format!("{who} takes a {kind} test (2D6, passing on its current Leadership or higher{modifiers}); if passed, {success}{fail}")
}

pub(super) fn gated_success(e: &P, ctx: &Ctx) -> String {
    match e.get("on_success").filter(|s| truthy(Some(s))) {
        Some(s) => inline(s, ctx),
        None => "nothing happens".to_string(),
    }
}

/// "roll one D6 (binding …): on a 4+, …; otherwise, …" without the leading verb's case.
pub(super) fn dice_gated_body(e: &P, ctx: &Ctx) -> String {
    let comp = format_comparison(
        &jstr(Some(nn(e, "comparison").unwrap_or(&Value::from("gte")))),
        e.get("threshold"),
    );
    let fail = match e.get("on_fail").filter(|f| truthy(Some(f))) {
        Some(f) => format!("; otherwise, {}", inline(f, ctx)),
        None => String::new(),
    };
    let binding = match sv(e, "roll_var").filter(|s| !s.is_empty()) {
        Some(var) => format!(
            " (binding the result as {})",
            dekebab(&var.replace('_', "-"))
        ),
        None => String::new(),
    };
    format!(
        "one {}{binding}: on {comp}, {}{fail}",
        dice_case(e.get("dice")),
        gated_success(e, ctx)
    )
}

pub(super) fn pool_phrase(e: &P) -> String {
    match e.get("pool").filter(|p| truthy(Some(p))) {
        Some(p) => {
            let p = obj(Some(p));
            format!("{}{}", jstr(p.get("count")), jstr(p.get("die")))
        }
        None => "your dice pool".to_string(),
    }
}
