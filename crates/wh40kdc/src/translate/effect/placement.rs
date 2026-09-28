//! Where a unit or model may be placed: the placement keywords (a single value or a list that
//! all apply) and the `near` / `away_from` / `in_region` constraint lists shared by set-up,
//! add-unit and return-models. Each phrase starts with a space so it appends to its clause.
//! Mirrors `tools/src/translate/effect-placement.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{
    and_list, article, key_count, nn, obj, objective_phrase, range_phrase, P,
};
use crate::translate::dekebab;

fn placement_name(k: &str) -> Option<&'static str> {
    Some(match k {
        "closest-to-destruction" => "as close as possible to where it was destroyed",
        "closest-to-original" => "as close as possible to its original position",
        "coherency" => "in Unit Coherency",
        "unengaged" => "not within Engagement Range of any enemy units",
        "strategic-reserves" => "in Strategic Reserves",
        "anywhere" => "anywhere on the battlefield",
        "connected-sections" => "with its sections touching",
        "deployment-zone" => "wholly within your deployment zone",
        "on-terrain" => "on top of a terrain feature",
        _ => return None,
    })
}

/// A placement keyword, or a list of them that all apply, with the legacy `range` for
/// (wholly) within.
pub(crate) fn placement_phrase(m: &P) -> String {
    let origin = "this model";
    let list: Vec<&Value> = match nn(m, "placement") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(p) => vec![p],
        None => Vec::new(),
    };
    let parts: Vec<String> = list
        .into_iter()
        .map(|p| {
            let k = jv(p);
            match k.as_str() {
                "wholly-within" => {
                    format!("wholly within {} of {origin}", range_phrase(m.get("range")))
                }
                "within" => format!("within {} of {origin}", range_phrase(m.get("range"))),
                _ => placement_name(&k)
                    .map(str::to_string)
                    .unwrap_or_else(|| dekebab(&k)),
            }
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", and_list(&parts))
    }
}

/// Something a distance is measured to: a unit, an objective marker, a named marker, an edge or
/// the centre.
pub(crate) fn place_phrase(of: Option<&Value>, ctx: &Ctx) -> String {
    let of = of.filter(|o| !o.is_null());
    match of.and_then(Value::as_str) {
        Some("battlefield-edge") => return "a battlefield edge".to_string(),
        Some("battlefield-centre") => return "the centre of the battlefield".to_string(),
        _ => {}
    }
    if let Some(Value::Object(o)) = of {
        if let Some(marker) = nn(o, "marker") {
            let label = dekebab(&jv(marker));
            let label = strip_suffix_ci(&label, " marker");
            return format!("{} {label} marker", article(&label));
        }
        if let Some(objective) = nn(o, "objective") {
            let f = obj(Some(objective));
            if nn(f, "selection_var").is_some() {
                return "that objective marker".to_string();
            }
            let phrase = objective_phrase(f, false, "objective marker");
            return format!("{} {phrase}", article(&phrase));
        }
    }
    let this_model = Value::from("this-model");
    strip_all(&effect_subject(Some(of.unwrap_or(&this_model)), ctx))
}

/// `s.replace(/ marker$/i, "")`.
fn strip_suffix_ci(s: &str, suffix: &str) -> String {
    if s.len() >= suffix.len()
        && s.is_char_boundary(s.len() - suffix.len())
        && s[s.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    {
        s[..s.len() - suffix.len()].to_string()
    } else {
        s.to_string()
    }
}

/// Away-from targets read as models: a bare enemy filter is "all enemy models".
fn away_phrase(of: Option<&Value>, ctx: &Ctx) -> String {
    if let Some(Value::Object(o)) = of {
        if key_count(o) == 1 && sv(o, "owner") == Some("enemy") {
            return "all enemy models".to_string();
        }
    }
    place_phrase(of, ctx)
}

/// The near / away_from / in_region lists as trailing limits.
pub(crate) fn placement_limits(m: &P, ctx: &Ctx) -> String {
    let mut parts: Vec<String> = Vec::new();
    for n in arr(m, "near").map(Vec::as_slice).unwrap_or_default() {
        let n = obj(Some(n));
        parts.push(format!(
            "{}within {} of {}",
            if is_true(n, "wholly") { "wholly " } else { "" },
            range_phrase(n.get("range")),
            place_phrase(n.get("of"), ctx)
        ));
    }
    if let Some(region) = nn(m, "in_region") {
        let region = obj(Some(region));
        parts.push(format!(
            "{}within {}",
            if is_true(region, "wholly") {
                "wholly "
            } else {
                ""
            },
            region_phrase(obj(region.get("region")))
        ));
    }
    let away: Vec<String> = arr(m, "away_from")
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|a| {
            let a = obj(Some(a));
            format!(
                "{} away from {}",
                range_phrase(a.get("range")),
                away_phrase(a.get("of"), ctx)
            )
        })
        .collect();
    if !away.is_empty() {
        parts.push(format!("more than {}", and_list(&away)));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", parts.join(" and "))
    }
}
