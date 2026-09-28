//! Single effects on markers, tests, costs, resources, designation, transport capacity and
//! army construction. Mirrors the matching functions in `tools/src/translate/effect-leaf-board.ts`.

use serde_json::{Map, Value};

use super::words::*;
use crate::translate::condition::{nn, obj, objective_phrase, P};
use crate::translate::dekebab;

pub(super) fn marker(m: &P) -> String {
    // A label that already ends in "marker" ("cult-ambush-marker") must not read "marker marker".
    let raw = dekebab(&jstr(m.get("label")));
    let label = match raw.len().checked_sub(" marker".len()) {
        Some(cut) if raw.is_char_boundary(cut) && raw[cut..].eq_ignore_ascii_case(" marker") => {
            raw[..cut].to_string()
        }
        _ => raw,
    };
    let consume = if sv(m, "consume") == Some("on-use") {
        "; using the marker consumes it"
    } else {
        ""
    };
    if sv(m, "operation") == Some("relocate") {
        let dist = nn(m, "distance")
            .map(|d| format!(" up to {}\"", jv(d)))
            .unwrap_or_default();
        return format!("move the {label} marker{dist}{consume}");
    }
    let place = nn(m, "placement")
        .map(|p| format!(" {}", dekebab(&jv(p))))
        .unwrap_or_default();
    let article = if label
        .chars()
        .next()
        .is_some_and(|c| "aeiouAEIOU".contains(c))
    {
        "an"
    } else {
        "a"
    };
    format!("place {article} {label} marker{place}{consume}")
}

pub(super) fn test(m: &P, subj: &str) -> String {
    let n = num(Some(nn(m, "count").unwrap_or(&Value::from(1))));
    let one = n == 1.0;
    let name = test_name(m.get("test"));
    let tests = if one {
        format!("a {name} test")
    } else {
        format!("{} {name} tests", fnum(n))
    };
    let per = nn(m, "per")
        .map(|p| format!(" for each {}", dekebab(&jv(p))))
        .unwrap_or_default();
    let modifier = nn(m, "modifier")
        .map(|x| {
            format!(
                ", applying {} to {}",
                signed(Some(&Value::from("add")), Some(x)),
                if one && per.is_empty() {
                    "that test"
                } else {
                    "those tests"
                }
            )
        })
        .unwrap_or_default();
    format!("{subj} must take {tests}{per}{modifier}")
}

pub(super) fn cost_modifier(m: &P, subj: &str) -> String {
    let noun = match sv(m, "of") {
        Some("manoeuvre") => "manoeuvre",
        Some("ability") => "ability",
        _ => "Stratagem",
    };
    let op = sv(m, "operation");
    let amount = jstr(m.get("amount"));
    if sv(m, "applies_to") == Some("the-triggering-use") {
        return match op {
            Some("decrease") => format!(
                "reduce the CP cost of that use of the {noun} by {amount}CP (to a minimum of 0CP)"
            ),
            Some("increase") => {
                format!("increase the CP cost of that use of the {noun} by {amount}CP")
            }
            Some("waive") => format!("that use of the {noun} costs no CP"),
            _ => format!("that use of the {noun} costs {amount}CP"),
        };
    }
    let named = nn(m, "id");
    let which = match named {
        Some(id) => format!("the {} {noun}", title_case(&jv(id))),
        None if noun == "ability" => "abilities".to_string(),
        None => format!("{noun}s"),
    };
    let whose = match sv(m, "applies_to") {
        Some("targeting-this-unit") => format!(
            " that {} {subj}",
            if named.is_some() { "targets" } else { "target" }
        ),
        Some("used-by-this-unit") => format!(" used by {subj}"),
        _ => String::new(),
    };
    let verb = if named.is_some() { "costs" } else { "cost" };
    match op {
        Some("waive") => format!(
            "{which}{whose} can be used without paying {} CP cost",
            if named.is_some() { "its" } else { "their" }
        ),
        Some("set") => format!("{which}{whose} {verb} {amount}CP"),
        Some("multiply") => {
            let times = if is_num(m, "amount", 2.0) {
                "twice".to_string()
            } else if is_num(m, "amount", 3.0) {
                "three times".to_string()
            } else {
                format!("{amount} times")
            };
            format!(
                "{which}{whose} {verb} {times} {} stated CP cost",
                if named.is_some() { "its" } else { "their" }
            )
        }
        _ => format!(
            "{which}{whose} {verb} {}CP {}",
            jstr(Some(nn(m, "amount").unwrap_or(&Value::from(1)))),
            if op == Some("decrease") {
                "less"
            } else {
                "more"
            }
        ),
    }
}

pub(super) fn resource_die(m: &P) -> String {
    let pool = resource_noun(m.get("pool"), None, None);
    if sv(m, "operation") == Some("substitute") {
        let rolls =
            map_arr(m, "rolls", |r| roll_name(Some(r))).unwrap_or_else(|| vec!["dice".to_string()]);
        return format!(
            "discard a die from your {pool} and use its value in place of a {} roll",
            rolls.join(" or ")
        );
    }
    let value = sv(m, "value");
    let shown = if value == Some("highest") {
        "the highest result".to_string()
    } else {
        jstr(m.get("value"))
    };
    if let Some(per) = nn(m, "count_per_pool") {
        let per = resource_noun(Some(per), None, None);
        let die = if value == Some("rolled") {
            "one rolled D6".to_string()
        } else {
            format!("one die showing {shown}")
        };
        let consumes = if is_true(m, "consumes_pool") {
            format!(", after which all your {per} are lost")
        } else {
            String::new()
        };
        return format!("add {die} to your {pool} for each {per} you have{consumes}");
    }
    let cnt = nn(m, "count")
        .map(|c| dice_case(Some(c)))
        .unwrap_or_else(|| "1".to_string());
    if value == Some("rolled") {
        let dice = if cnt == "1" {
            "a rolled D6".to_string()
        } else {
            format!("{cnt} rolled D6")
        };
        return format!("add {dice} to your {pool}");
    }
    let dice = if cnt == "1" {
        "a die".to_string()
    } else {
        format!("{cnt} dice")
    };
    format!("add {dice} showing {shown} to your {pool}")
}

pub(super) fn designate(m: &P, subj: &str, ctx: &Ctx) -> String {
    let what = match m.get("subject") {
        None | Some(Value::Null) => subj.to_string(),
        Some(Value::Object(s)) if nn(s, "objective").is_some() => format!(
            "the {}",
            objective_phrase(obj(s.get("objective")), false, "objective")
        ),
        Some(Value::Object(s)) if nn(s, "terrain_area").is_some() => {
            let mut r = Map::new();
            r.insert("terrain_area".into(), s["terrain_area"].clone());
            region_phrase(&r)
        }
        Some(s) => effect_subject(Some(s), ctx),
    };
    let tag = designation_for(&jstr(m.get("tag")));
    let until = match sv(m, "clears_on") {
        Some("turn-rollover") => " until the end of the turn",
        Some("phase-end") => " until the end of the phase",
        _ => "",
    };
    if is_true(m, "clear") {
        format!("{what} {} no longer {tag}", v(&what, "is"))
    } else {
        format!("{what} {} {tag}{until}", v(&what, "is"))
    }
}

pub(super) fn army_rule(m: &P, subj: &str, ctx: &Ctx) -> String {
    let with = nn(m, "with").map(|w| strip_all(&effect_subject(Some(w), ctx)));
    match sv(m, "rule") {
        Some("warlord-required") => format!("{subj} must be your Warlord"),
        Some("warlord-forbidden") => format!("{subj} cannot be your Warlord"),
        Some("unique") => format!("your army can include only one of {subj}"),
        Some("enhancement-forbidden") => format!("{subj} cannot be given Enhancements"),
        Some("enhancement-slot") => {
            let each = with
                .map(|w| replace_word_first(&w, " units", " unit", false))
                .unwrap_or_else(|| "such unit".to_string());
            let max = nn(m, "max")
                .map(|x| format!("up to {} ", jv(x)))
                .unwrap_or_default();
            let kind = nn(m, "enhancement_kind")
                .map(|k| format!("{} ", title_case(&jv(k))))
                .unwrap_or_default();
            format!(
                "each {each} can be given {max}{kind}Enhancement{}",
                if is_num(m, "max", 1.0) { "" } else { "s" }
            )
        }
        Some("faction-forbidden") => format!(
            "you cannot select {} as your Army Faction",
            title_case(&jstr(m.get("faction")))
        ),
        Some("attachment") => {
            if is_true(m, "mandatory") {
                return format!("{subj} must be attached to a Leader, or it counts as destroyed");
            }
            let led = nn(m, "led_by")
                .map(|l| format!(" led by a {} model", title_case(&jv(l))))
                .unwrap_or_default();
            format!(
                "at the start of the Declare Battle Formations step, {subj} can join one friendly unit{led}, becoming part of that Bodyguard unit"
            )
        }
        _ => {
            let units = with.unwrap_or_else(|| "such units".to_string());
            match nn(m, "max") {
                Some(max) => format!("your army can include at most {} {units}", jv(max)),
                None => format!("your army cannot include {units}"),
            }
        }
    }
}

/// `effectSubject(x).replace(/^all /, "").replace(/\bunits\b/, "models")` with a default ctx.
pub(super) fn model_noun(x: &Value) -> String {
    replace_word_first(
        &strip_all(&effect_subject(Some(x), &Ctx::default())),
        "units",
        "models",
        true,
    )
}

/// How models count against a Transport's capacity.
pub(super) fn transport_capacity(m: &P) -> String {
    if let Some(capacity) = nn(m, "capacity") {
        let who = match nn(m, "eligible") {
            Some(e) => format!(" {}", model_noun(e)),
            None => " models".to_string(),
        };
        let mut parts = vec![format!(
            "this model has a Transport capacity of {}{who}",
            jv(capacity)
        )];
        if let Some(spaces) = arr(m, "space_per_model") {
            for s in spaces {
                let s = obj(Some(s));
                let mut f = Map::new();
                for k in ["any_of", "all_of"] {
                    if let Some(x) = s.get(k) {
                        f.insert(k.into(), x.clone());
                    }
                }
                parts.push(format!(
                    "{} take {} spaces each",
                    model_noun(&Value::Object(f)),
                    jstr(s.get("slots"))
                ));
            }
        }
        return parts.join("; ");
    }
    let keyword = nn(m, "model_keyword")
        .map(|k| title_case(&jv(k)))
        .unwrap_or_default();
    let single = sv(m, "subject_kind") == Some("single-model");
    let model = if !keyword.is_empty() {
        format!("{}{keyword} model", if single { "this " } else { "" })
    } else if single {
        "this model".to_string()
    } else {
        "model in this unit".to_string()
    };
    let each_model = if single {
        model.clone()
    } else {
        format!("each {model}")
    };
    let elig = m.get("transport_eligibility").and_then(Value::as_object);
    let qualification = match elig {
        Some(e) if nn(e, "requires_capacity_keyword").is_some() => format!(
            " in a Transport able to carry {} models",
            title_case(&jstr(e.get("requires_capacity_keyword")))
        ),
        Some(e) if nn(e, "embark_as_keyword").is_some() => format!(
            " when embarking as {}",
            title_case(&jstr(e.get("embark_as_keyword")))
        ),
        _ => String::new(),
    };
    match sv(m, "occupancy_kind") {
        Some("fixed-model-spaces") => {
            let spaces = num(m.get("spaces_per_model"));
            return format!(
                "for Transport capacity{qualification}, {each_model} occupies {} model space{}",
                fnum(spaces),
                if spaces == 1.0 { "" } else { "s" }
            );
        }
        Some("equivalent-model") => {
            let equivalent = nn(m, "equivalent_model_keyword")
                .map(|k| format!("{} model", title_case(&jv(k))))
                .unwrap_or_else(|| "model".to_string());
            let count = num(Some(
                nn(m, "equivalent_model_count").unwrap_or(&Value::from(1)),
            ));
            return format!(
                "for Transport capacity{qualification}, {each_model} counts as {} {equivalent}{}",
                fnum(count),
                if count == 1.0 { "" } else { "s" }
            );
        }
        _ => {}
    }
    let models = num(m.get("models_per_group"));
    let spaces = num(m.get("spaces_per_group"));
    let (group_model, group_models) = if keyword.is_empty() {
        (
            "model in this unit".to_string(),
            "models in this unit".to_string(),
        )
    } else {
        (format!("{keyword} model"), format!("{keyword} models"))
    };
    let subject = if single {
        model
    } else if models == 1.0 {
        format!("each {group_model}")
    } else {
        format!("each group of {} {group_models}", fnum(models))
    };
    let space_noun = if spaces == 1.0 {
        "model space"
    } else {
        "model spaces"
    };
    format!(
        "for Transport capacity{qualification}, {subject} occupies {} {space_noun}, rounding {}",
        fnum(spaces),
        jstr(m.get("rounding"))
    )
}
