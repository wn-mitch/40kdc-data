//! How a player gate's conditions become buff applicability (`applicableWhen`), and the short
//! labels of the levers. Mirrors `conditionToApplicability`, `combineApplicability`,
//! `applyApplicability` and `labelForBuffs` in `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::conditions::{is_buffed_unit, single_keyword};
use super::js::*;

pub(super) enum App {
    Gate,
    Context,
    When(Obj),
}

/// A condition as a buff applicability the resolver can gate on.
pub(super) fn condition_to_applicability(condition: &Obj) -> App {
    if condition.get("operator").is_some_and(Value::is_string) {
        if let Some(operands) = condition.get("operands").and_then(Value::as_array) {
            if !is_str(condition, "operator", "and") {
                return App::Context;
            }
            let mut merged = Obj::new();
            for operand in operands {
                let Some(o) = operand.as_object() else {
                    return App::Context;
                };
                match condition_to_applicability(o) {
                    App::Gate => {}
                    App::Context => return App::Context,
                    App::When(a) => merged = combine(&merged, &a),
                }
            }
            return App::When(merged);
        }
    }
    let params = object(condition.get("parameters"));
    let when = |v: Value| App::When(v.as_object().cloned().unwrap_or_default());
    match condition.get("type").and_then(Value::as_str) {
        Some("timing-is") => App::Gate,
        Some("phase-is") => match params.and_then(|p| p.get("phase")).and_then(Value::as_str) {
            Some(phase) => when(json!({ "phases": [phase] })),
            None => App::Context,
        },
        Some("has-keyword") => {
            let Some(kw) = single_keyword(params) else {
                return App::Context;
            };
            let subject = params.and_then(|p| p.get("subject"));
            if subject.and_then(Value::as_str) == Some("defender") {
                when(json!({ "requiresTargetKeyword": kw }))
            } else if is_buffed_unit(subject) {
                when(json!({ "requiresAttackerKeyword": kw }))
            } else {
                App::Context
            }
        }
        Some("attack-is") => {
            let Some(p) = params else {
                return App::Context;
            };
            if p.keys().any(|k| k != "attack_type") {
                return App::Context;
            }
            match p.get("attack_type").and_then(Value::as_str) {
                Some("melee") => when(json!({ "phases": ["fight"] })),
                Some("ranged") => when(json!({ "phases": ["shooting"] })),
                _ => App::Context,
            }
        }
        _ => App::Context,
    }
}

/// Merge two applicabilities: `phases` intersect, roll type and keyword gates narrow.
pub(super) fn combine(a: &Obj, b: &Obj) -> Obj {
    let mut out = a.clone();
    if let Some(bp) = b.get("phases").and_then(Value::as_array) {
        let phases = match a.get("phases").and_then(Value::as_array) {
            Some(ap) => ap.iter().filter(|p| bp.contains(p)).cloned().collect(),
            None => bp.clone(),
        };
        out.insert("phases".into(), Value::Array(phases));
    }
    for k in [
        "rollType",
        "requiresTargetKeyword",
        "requiresAttackerKeyword",
    ] {
        if let Some(v) = b
            .get(k)
            .filter(|v| v.as_str().is_some_and(|s| !s.is_empty()))
        {
            out.insert(k.into(), v.clone());
        }
    }
    out
}

/// Attach an accumulated applicability to a buff (no-op when empty).
pub(super) fn apply_applicability(mut b: Value, app: &Obj) -> Value {
    if app.is_empty() {
        return b;
    }
    let merged = match b.get("applicableWhen").and_then(Value::as_object) {
        Some(existing) => combine(existing, app),
        None => app.clone(),
    };
    b["applicableWhen"] = Value::Object(merged);
    b
}

/// A short, deduped label summarising a lever's contributions.
pub(super) fn label_for_buffs(buffs: &[Value]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for b in buffs {
        let p = describe_contribution(&b["contribution"]);
        if !parts.contains(&p) {
            parts.push(p);
        }
    }
    if parts.is_empty() {
        "buff".to_string()
    } else {
        parts.join(", ")
    }
}

fn signed(v: &Value) -> String {
    let n = js_number(Some(v));
    if n >= 0.0 {
        format!("+{}", fmt_num(n))
    } else {
        fmt_num(n)
    }
}

fn describe_contribution(c: &Value) -> String {
    let v = &c["value"];
    match c["type"].as_str().unwrap_or("") {
        "extra-keyword" => keyword_label(&c["keywordRef"]),
        "hit-mod" => format!("{} to hit", signed(v)),
        "wound-mod" => format!("{} to wound", signed(v)),
        "save-mod" => format!("{} to save", signed(v)),
        "damage-mod" => format!("{} damage", signed(v)),
        "attacks-mod" => format!("{} attacks", signed(v)),
        "strength-mod" => format!("{} strength", signed(v)),
        "toughness-mod" => format!("{} toughness", signed(v)),
        "ap-mod" => format!("AP {}", fmt_num(js_number(Some(v)))),
        "reroll" => format!(
            "re-roll {}{}",
            js_string(c.get("roll")),
            if c["subset"] == "ones" { " 1s" } else { "" }
        ),
        "feel-no-pain" => {
            let t = fmt_num(js_number(c.get("threshold")));
            if c["scope"] == "mortal" {
                format!("feel no pain {t}+ vs mortals")
            } else {
                format!("feel no pain {t}+")
            }
        }
        "damage-reduction" => format!("-{} damage", fmt_num(js_number(Some(v)))),
        "invulnerable-save" => format!("{}+ invuln", fmt_num(js_number(c.get("threshold")))),
        _ => "cover".to_string(),
    }
}

/// A weapon-keyword ref back in its printed form (best-effort).
fn keyword_label(r: &Value) -> String {
    let empty = Obj::new();
    let params = object(r.get("parameters")).unwrap_or(&empty);
    let id = r["keyword_id"].as_str().unwrap_or("");
    if id == "anti" {
        if let Some(target) = params.get("target_keyword").and_then(Value::as_str) {
            let th = params
                .get("threshold")
                .filter(|t| t.is_number())
                .map(|t| format!(" {}+", fmt_num(js_number(Some(t)))))
                .unwrap_or_default();
            return format!("Anti-{target}{th}");
        }
    }
    let base = id
        .split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    match params.get("value").filter(|v| v.is_number()) {
        Some(v) => format!("{base} {}", fmt_num(js_number(Some(v)))),
        None => base,
    }
}
