//! Subject phrases: an effect target (a unit-ref) as the clause subject, who holds a weapon
//! filter's weapons, and region-refs as places. Mirrors `tools/src/translate/effect-words.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{
    designation_phrase, nn, obj, or_list, range_phrase, state_phrase, P,
};
use crate::translate::dekebab;

pub(super) fn role_subject(role: &str) -> Option<&'static str> {
    Some(match role {
        "this-model" => "this model",
        "model-in-this-unit" => "a model in this unit",
        "defender" => "the target",
        "event-subject" => "the triggering unit",
        "event-object" => "that unit",
        "stratagem-target" => "that unit",
        _ => return None,
    })
}

/// A unit filter as the plural subject of an effect: `friendly INFANTRY units within 6"`.
pub(crate) fn filter_subject(f: &P, ctx: &Ctx) -> String {
    let owner = match sv(f, "owner") {
        Some("friendly") => "friendly ",
        Some("enemy") => "enemy ",
        _ => "",
    };
    let all = map_arr(f, "all_of", jv)
        .map(|k| format!("{} ", k.join(" ")))
        .unwrap_or_default();
    let noun = if sv(f, "level") == Some("model") {
        "models"
    } else {
        "units"
    };
    let mut s = format!("{owner}{all}{noun}");
    if let Some(any) = map_arr(f, "any_of", jv) {
        s.push_str(&format!(" with the {} keyword", or_list(&any)));
    }
    if let Some(none) = map_arr(f, "none_of", jv) {
        s.push_str(&format!(" (excluding {} {noun})", or_list(&none)));
    }
    let within = nn(f, "within");
    if let Some(w) = within {
        let w = obj(Some(w));
        s.push_str(&format!(" within {}", range_phrase(w.get("range"))));
        if let Some(of) = nn(w, "of") {
            s.push_str(&format!(" of {}", effect_subject(Some(of), ctx)));
        }
    }
    if is_true(f, "visible") {
        s.push_str(" that are visible");
    }
    if let Some(d) = nn(f, "designated") {
        s.push_str(&format!(" that are {}", designation_phrase(&jv(d))));
    }
    if let Some(state) = nn(f, "state") {
        s.push_str(&format!(" that are {}", state_phrase(&jv(state), false)));
    }
    if let Some(ex) = nn(f, "excluding") {
        s.push_str(&format!(" other than {}", effect_subject(Some(ex), ctx)));
    }
    let bounded = within.is_some()
        || is_true(f, "visible")
        || nn(f, "designated").is_some()
        || nn(f, "state").is_some();
    if bounded {
        s
    } else {
        format!("all {s}")
    }
}

/// An effect target (a unit-ref) as the effect's subject.
pub(crate) fn effect_subject(target: Option<&Value>, ctx: &Ctx) -> String {
    let target = target.filter(|t| !t.is_null());
    match target.map(|t| (t, t.as_str())) {
        None | Some((_, Some("this-unit"))) => ctx.unit_subject.clone().unwrap_or_else(|| {
            if ctx.selected_unit || ctx.selected_model {
                "this unit"
            } else {
                "the unit"
            }
            .to_string()
        }),
        Some((_, Some("selected-unit"))) => if ctx.selected_model {
            "that model"
        } else if ctx.selected_unit {
            "that unit"
        } else {
            "the selected unit"
        }
        .to_string(),
        Some((_, Some("recipient"))) => if ctx.aura_recipient {
            "that unit"
        } else {
            "the unit"
        }
        .to_string(),
        Some((_, Some("attacker"))) => ctx
            .unit_subject
            .clone()
            .unwrap_or_else(|| "the attacking unit".to_string()),
        Some((_, Some(s))) => role_subject(s)
            .map(str::to_string)
            .unwrap_or_else(|| dekebab(s)),
        Some((t, None)) => {
            let r = obj(Some(t));
            if r.get("event_var").is_some_and(Value::is_string) {
                return "that unit".to_string();
            }
            if r.get("selection_var").is_some_and(Value::is_string) {
                return format!(
                    "the bound {}",
                    jstr(r.get("selection_var")).replace('_', " ")
                );
            }
            filter_subject(r, ctx)
        }
    }
}

/// Who carries a weapon filter's weapons: "this model", "models in this unit", ….
pub(crate) fn weapon_holder(target: Option<&Value>, ctx: &Ctx) -> String {
    let t = target.filter(|t| !t.is_null());
    let s = t.and_then(Value::as_str);
    if s == Some("this-model") {
        return "this model".to_string();
    }
    let unit_like = t.is_none() || s == Some("this-unit");
    if let Some(us) = ctx.unit_subject() {
        if unit_like || s == Some("attacker") {
            return format!("models in {us}");
        }
    }
    if s == Some("selected-unit") && ctx.selected_model {
        return "that model".to_string();
    }
    if unit_like {
        return "models in this unit".to_string();
    }
    if s == Some("selected-unit") {
        return if ctx.selected_unit {
            "models in that unit"
        } else {
            "models in the selected unit"
        }
        .to_string();
    }
    effect_subject(t, ctx)
}

/// A region-ref as a place: "enemy territory", "the Ruins terrain area", "Plague Zone".
pub(crate) fn region_phrase(r: &P) -> String {
    if truthy_key(r, "rule_region") {
        return title_case(&jstr(obj(r.get("rule_region")).get("region_id")));
    }
    if truthy_key(r, "territory") {
        return dekebab(&jstr(r.get("territory")));
    }
    let area = obj(nn(r, "terrain_area"));
    let mut place = match nn(area, "footprint") {
        Some(f) => format!("the {} terrain area", dekebab(&jv(f))),
        None => "a terrain area".to_string(),
    };
    if let Some(d) = nn(area, "designated") {
        place.push_str(&format!(" tagged {}", dekebab(&jv(d))));
    }
    place
}
