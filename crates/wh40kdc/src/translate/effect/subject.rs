//! Subject phrases: an effect target (a unit-ref) as the clause subject, who holds a weapon
//! filter's weapons, and region-refs as places. Mirrors `tools/src/translate/effect-words.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{
    alternative_filters, and_list, article, designation_phrase, keyword_alternatives, nn, obj,
    or_list, place_ref_phrase, range_phrase, state_phrase, P,
};
use crate::translate::dekebab;

pub(super) fn role_subject(role: &str) -> Option<&'static str> {
    Some(match role {
        "this-unit" => "the unit",
        "this-model" => "this model",
        "model-in-this-unit" => "a model in this unit",
        "attacker" => "the attacking unit",
        "defender" => "the target",
        "event-subject" => "the triggering unit",
        "event-object" => "that unit",
        "stratagem-target" => "that unit",
        "selected-unit" => "the selected unit",
        "recipient" => "the unit",
        "bearer-transport" => "the Transport this unit is embarked within",
        "ability-unit" => "this unit",
        _ => return None,
    })
}

/// A canonical unit filter as the plural subject of an effect.
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
        match sv(f, "attachment_role") {
            Some("bodyguard") => "Bodyguard models",
            Some("leader") => "Leader models",
            _ => "models",
        }
    } else {
        "units"
    };
    let compact = keyword_alternatives(f);
    let mut s = match &compact {
        Some(alternatives) => format!("{owner}{} {noun}", or_list(alternatives)),
        None => format!("{owner}{all}{noun}"),
    };
    if compact.is_none() && f.get("any_of_filters").is_some_and(Value::is_array) {
        let alternatives: Vec<String> = alternative_filters(f)
            .iter()
            .map(|alternative| {
                let phrase = filter_subject(alternative, ctx);
                phrase.strip_prefix("all ").unwrap_or(&phrase).to_string()
            })
            .collect();
        s.push_str(&format!(" that are {}", or_list(&alternatives)));
    }
    if let Some(any) = map_arr(f, "any_of", jv) {
        s.push_str(&format!(" with the {} keyword", or_list(&any)));
    }
    if let Some(none) = map_arr(f, "none_of", jv) {
        s.push_str(&format!(" (excluding {} {})", or_list(&none), noun));
    }
    if let Some(not_all) = map_arr(f, "not_all_of", jv) {
        s.push_str(&format!(" (excluding {} {})", not_all.join(" "), noun));
    }
    if let Some(names) = map_arr(f, "model_names", jv) {
        s.push_str(&format!(" named {}", or_list(&names)));
    }
    if let Some(ids) = map_arr(f, "unit_ids", jv) {
        s.push_str(&format!(" with unit ID {}", or_list(&ids)));
    }
    if let Some(within) = nn(f, "within") {
        let within = obj(Some(within));
        s.push_str(&format!(
            " {}within {}{}",
            if is_true(within, "wholly") {
                "wholly "
            } else {
                ""
            },
            range_phrase(within.get("range")),
            within
                .get("of")
                .map(|of| format!(" of {}", place_ref_phrase(Some(of))))
                .unwrap_or_default()
        ));
    }
    s.push_str(&filter_relations(f, ctx));
    if let Some(visible) = nn(f, "visible") {
        let visible = obj(Some(visible));
        s.push_str(&format!(
            " visible to {}",
            effect_subject(visible.get("to"), ctx)
        ));
    }
    if let Some(d) = nn(f, "designated") {
        let by = nn(f, "designated_by")
            .map(|b| format!(" by {}", effect_subject(Some(b), ctx)))
            .unwrap_or_default();
        s.push_str(&format!(
            " that are {}{by}",
            designation_phrase(&jv(d), true)
        ));
    }
    if let Some(d) = nn(f, "not_designated") {
        s.push_str(&format!(
            " that are not {}",
            designation_phrase(&jv(d), true)
        ));
    }
    if let Some(state) = nn(f, "state") {
        s.push_str(&format!(" that are {}", state_phrase(&jv(state), false)));
    }
    if let Some(not) = map_arr(f, "not_states", |x| state_phrase(&jv(x), true)) {
        s.push_str(&format!(" that are {}", and_list(&not)));
    }
    if let Some(ex) = nn(f, "excluding") {
        s.push_str(&format!(" other than {}", effect_subject(Some(ex), ctx)));
    }
    let bounded = [
        "within",
        "visible",
        "designated",
        "not_designated",
        "state",
        "not_states",
        "embarked_in",
        "member_of",
        "engaged_with",
        "not_engaged_with",
    ]
    .iter()
    .any(|k| nn(f, k).is_some());
    if bounded {
        s
    } else {
        format!("all {s}")
    }
}

/// A unit filter's relations to other units and abilities.
fn filter_relations(f: &P, ctx: &Ctx) -> String {
    let mut s = String::new();
    if let Some(has) = map_arr(f, "has_ability", |a| ability_label(Some(a))) {
        s.push_str(&format!(" with the {} ability", and_list(&has)));
    }
    if let Some(lacks) = map_arr(f, "lacks_ability", |a| ability_label(Some(a))) {
        s.push_str(&format!(" without the {} ability", or_list(&lacks)));
    }
    if let Some(e) = nn(f, "embarked_in") {
        s.push_str(&format!(
            " embarked within {}",
            effect_subject(Some(e), ctx)
        ));
    }
    if let Some(m) = nn(f, "member_of") {
        s.push_str(" in ");
        if m.as_str() == Some("this-unit") {
            s.push_str("the unit");
        } else {
            s.push_str(&effect_subject(Some(m), ctx));
        }
    }
    let relation_phrase = |g: &Value| -> String {
        let exact = g.is_string()
            || g.as_object().is_some_and(|o| {
                o.contains_key("selection_var")
                    || o.contains_key("event_var")
                    || o.contains_key("stratagem_target")
            });
        if exact {
            return effect_subject(Some(g), ctx);
        }
        let mut filter = obj(Some(g)).clone();
        let other = matches!(
            filter.get("excluding").and_then(Value::as_str),
            Some("this-unit" | "this-model")
        );
        if other {
            filter.remove("excluding");
        }
        let rendered = filter_subject(&filter, ctx);
        let phrase = rendered
            .strip_prefix("all ")
            .unwrap_or(&rendered)
            .replace(" units", " unit")
            .replace(" models", " model");
        if other {
            format!("other {phrase}")
        } else {
            phrase
        }
    };
    if let Some(g) = nn(f, "engaged_with") {
        let phrase = relation_phrase(g);
        let exact = g.is_string()
            || g.as_object().is_some_and(|o| {
                o.contains_key("selection_var")
                    || o.contains_key("event_var")
                    || o.contains_key("stratagem_target")
            });
        let phrase = if exact {
            phrase
        } else {
            format!("{} {phrase}", article(&phrase))
                .replacen("a other ", "another ", 1)
                .replacen("an other ", "another ", 1)
        };
        s.push_str(&format!(" within Engagement Range of {phrase}"));
    }
    if let Some(g) = nn(f, "not_engaged_with") {
        let phrase = relation_phrase(g);
        let exact = g.is_string()
            || g.as_object().is_some_and(|o| {
                o.contains_key("selection_var")
                    || o.contains_key("event_var")
                    || o.contains_key("stratagem_target")
            });
        s.push_str(&format!(
            " that are not within Engagement Range of {}{}",
            if exact { "" } else { "any " },
            phrase
        ));
    }
    s
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
            if let Some(t) = r.get("stratagem_target").and_then(Value::as_str) {
                return format!(
                    "the {} target",
                    dekebab(t.strip_prefix("the-").unwrap_or(t))
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
