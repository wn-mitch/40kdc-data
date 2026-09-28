//! Single effects that move or place units: moves, move modifiers and set-up. Mirrors the
//! matching functions in `tools/src/translate/effect-leaf-board.ts`.

use serde_json::Value;

use super::words::*;
use crate::translate::condition::{and_list, nn, obj, range_phrase, P};
use crate::translate::dekebab;

pub(super) fn move_verb(t: &str) -> String {
    match t {
        "normal" => "make a Normal move",
        "advance" => "Advance",
        "fall-back" => "Fall Back",
        "charge" => "declare a charge",
        "pile-in" => "Pile In",
        "consolidation" => "Consolidate",
        "surge" => "make a Surge move",
        "scout" => "make a Scout move",
        "ingress" => "make an Ingress move",
        "disembark" => "disembark",
        "embark" => "embark",
        "pulse-jet" => "make a Pulse Jet move",
        other => return format!("make a {} move", dekebab(other)),
    }
    .to_string()
}

pub(super) fn move_noun(t: &str) -> String {
    match t {
        "normal" => "Normal",
        "advance" => "Advance",
        "fall-back" => "Fall Back",
        "charge" => "Charge",
        "pile-in" => "Pile-in",
        "consolidation" => "Consolidation",
        "surge" => "Surge",
        "scout" => "Scout",
        "ingress" => "Ingress",
        "disembark" => "Disembark",
        "embark" => "Embark",
        "pulse-jet" => "Pulse Jet",
        other => return dekebab(other),
    }
    .to_string()
}

pub(super) fn passthrough(p: &[Value]) -> String {
    let items: Vec<String> = p
        .iter()
        .map(|x| {
            let x = jv(x);
            match x.as_str() {
                "non-titanic-models" => "non-Titanic models".to_string(),
                "friendly-vehicles" => "friendly Vehicle models".to_string(),
                "friendly-monsters" => "friendly Monster models".to_string(),
                "terrain-le-4" => "terrain features 4\" or lower".to_string(),
                "tall-terrain" => "terrain features over 4\"".to_string(),
                "all-terrain" => "terrain features".to_string(),
                "enemy-models" => "enemy models".to_string(),
                other => dekebab(other),
            }
        })
        .collect();
    and_list(&items)
}

pub(super) fn movement(m: &P, subj: &str, ctx: &Ctx) -> String {
    let verb = move_verb(&jstr(m.get("move_type")));
    let up_to = match nn(m, "distance") {
        Some(d) if verb.starts_with("make ") => format!(" of up to {}\"", dice_case(Some(d))),
        Some(d) => format!(" up to {}\"", dice_case(Some(d))),
        None => String::new(),
    };
    let mut s = format!("{subj} can {verb}{up_to}");
    if let Some(p) = arr(m, "passthrough") {
        s.push_str(&format!(
            ", moving over {} as though they were not there",
            passthrough(p)
        ));
    }
    if let Some(ends) = nn(m, "ends_within") {
        let ends = obj(Some(ends));
        let of = match nn(ends, "of") {
            Some(of) => effect_subject(Some(of), ctx),
            None => "this model".to_string(),
        };
        s.push_str(&format!(
            ", ending that move {}within {} of {of}",
            if is_true(ends, "wholly") {
                "wholly "
            } else {
                ""
            },
            range_phrase(ends.get("range"))
        ));
    }
    if is_true(m, "keeps_eligible") {
        s.push_str("; doing so does not change what it is eligible to do this turn");
    }
    s
}

pub(super) fn move_modifier(m: &P, subj: &str) -> String {
    let kinds = map_arr(m, "applies_to_moves", |x| move_noun(&jv(x))).map(|k| and_list(&k));
    let mut clauses: Vec<String> = Vec::new();
    if let Some(bonus) = nn(m, "distance_bonus") {
        let n = num(Some(bonus));
        let moves = match &kinds {
            Some(k) => format!("{k} moves"),
            None => "Move characteristic".to_string(),
        };
        clauses.push(if !n.is_nan() && n < 0.0 {
            format!(
                "subtract {}\" from {}",
                fnum(n.abs()),
                of_or_possessive(subj, &moves)
            )
        } else {
            format!(
                "add {}\" to {}",
                dice_case(Some(bonus)),
                of_or_possessive(subj, &moves)
            )
        });
    }
    if sv(m, "advance") == Some("fixed-6") {
        clauses.push(format!(
            "{subj} {} not make an Advance roll; add 6\" to {} Move characteristic instead",
            v(subj, "does"),
            pronoun(subj)
        ));
    }
    if let Some(p) = arr(m, "passthrough") {
        clauses.push(format!(
            "{subj} can move over {} as though they were not there",
            passthrough(p)
        ));
    }
    if is_true(m, "no_end_in_engagement") {
        clauses.push(format!(
            "{subj} cannot end a move within Engagement Range of any enemy unit"
        ));
    }
    if is_true(m, "end_on_terrain") {
        clauses.push(format!(
            "{subj} can end {} moves on top of terrain features",
            pronoun(subj)
        ));
    }
    if is_true(m, "ignore_vertical") {
        clauses.push(format!(
            "{subj} {} vertical distances when {}",
            v(subj, "ignores"),
            if pronoun(subj) == "their" {
                "they move"
            } else {
                "it moves"
            }
        ));
    }
    let s = clauses.join("; ");
    match kinds {
        Some(k) if nn(m, "distance_bonus").is_none() => {
            format!("{s}, during {} {k} moves", pronoun(subj))
        }
        _ => s,
    }
}

pub(super) const ORD: &[&str] = &["", "first", "second", "third", "fourth", "fifth"];

pub(super) fn ordinal(t: &Value) -> String {
    t.as_u64()
        .and_then(|i| ORD.get(i as usize))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}th", jv(t)))
}

/// `list.join(", ").replace(/, ([^,]*)$/, " or $1")`.
pub(super) fn or_last(joined: &str) -> String {
    match joined.rfind(", ") {
        Some(i) if !joined[i + 2..].contains(',') => {
            format!("{} or {}", &joined[..i], &joined[i + 2..])
        }
        _ => joined.to_string(),
    }
}

pub(super) fn set_up(m: &P, subj: &str, ctx: &Ctx) -> String {
    let who = match m.get("subject") {
        Some(s) if s.as_str() == Some("models-on-this-model") => {
            "the models on this model".to_string()
        }
        Some(s) if !s.is_null() => effect_subject(Some(s), ctx),
        _ => subj.to_string(),
    };
    let limits = if is_true(m, "ignore_limits") {
        ", ignoring any limits on units in Strategic Reserves"
    } else {
        ""
    };
    let denied = is_false(m, "allow");
    if sv(m, "to") == Some("strategic-reserves") {
        return if denied {
            format!(
                "{} cannot be placed into Strategic Reserves{limits}",
                none_of(&who)
            )
        } else {
            format!("{who} can be placed into Strategic Reserves{limits}")
        };
    }
    let from = match sv(m, "from") {
        Some("strategic-reserves") => " from Strategic Reserves",
        Some("transport") => " from its Transport",
        _ => "",
    };
    let can = if denied { "cannot" } else { "can" };
    let who = if denied { none_of(&who) } else { who };
    let mut s = if sv(m, "from") == Some("battlefield") {
        format!("{who} {can} be removed from the battlefield and set up again")
    } else {
        format!("{who} {can} be set up on the battlefield{from}")
    };
    if sv(m, "via") == Some("deep-strike") {
        s.push_str(" using the Deep Strike rules");
    }
    if let Some(turns) = arr(m, "turns") {
        let joined = turns.iter().map(ordinal).collect::<Vec<_>>().join(", ");
        s.push_str(&format!(
            " in the Reinforcements step of your {} Movement phase",
            or_last(&joined)
        ));
    }
    if let Some(sections) = nn(m, "sections") {
        s.push_str(&format!(" as {} separate sections", jv(sections)));
    }
    if let Some(p) = nn(m, "placement") {
        let p = jv(p);
        s.push_str(&match p.as_str() {
            "closest-to-original" => " as close as possible to its original position".to_string(),
            "connected-sections" => " with its sections touching".to_string(),
            "anywhere" => " anywhere on the battlefield".to_string(),
            "deployment-zone" => " wholly within your deployment zone".to_string(),
            "on-terrain" => " on top of a terrain feature".to_string(),
            other => format!(" {}", dekebab(other)),
        });
    }
    if let Some(edge) = nn(m, "within_edge") {
        s.push_str(&format!(
            " wholly within {}\" of a battlefield edge",
            jv(edge)
        ));
    }
    if let Some(d) = nn(m, "min_enemy_distance") {
        s.push_str(&format!(
            " more than {}\" away from all enemy models",
            jv(d)
        ));
    }
    if let Some(md) = nn(m, "min_distance_from") {
        let md = obj(Some(md));
        let of = match nn(md, "of") {
            Some(of) => effect_subject(Some(of), ctx),
            None => "this model".to_string(),
        };
        s.push_str(&format!(
            " {} {}{} {of}",
            if denied { "within" } else { "more than" },
            range_phrase(md.get("range")),
            if denied { " of" } else { " away from" }
        ));
    }
    if let Some(off) = nn(m, "round_offset") {
        let n = num(Some(off));
        s.push_str(&format!(
            ", treating the battle round as {} {} than it is",
            fnum(n.abs()),
            if n < 0.0 { "lower" } else { "higher" }
        ));
    }
    s + limits
}
