//! Single effects on the ability, keyword, permission, targeting and rule axes. Mirrors the
//! matching functions in `tools/src/translate/effect-leaf.ts`.

use serde_json::Value;

use super::leaf::incoming_lead;
use super::words::*;
use crate::translate::condition::{and_list, nn, obj, or_list, range_phrase, P};
use crate::translate::dekebab;

pub(super) fn ability_grant(m: &P, subj: &str) -> String {
    // Cover is a state a unit has, not an ability it gains.
    if sv(m, "ability") == Some("benefit-of-cover") {
        return format!("{subj} {} the Benefit of Cover", v(subj, "has"));
    }
    let ability = sv(m, "ability");
    let inch = if ability == Some("scouts") || ability == Some("deep-strike") {
        "\""
    } else {
        ""
    };
    let value = nn(m, "value")
        .map(|x| format!(" {}{inch}", jv(x)))
        .unwrap_or_default();
    let noun = if is_true(m, "rules_bundle") {
        "rules"
    } else {
        "ability"
    };
    format!(
        "{subj} {} the {}{value} {noun}",
        v(subj, "gains"),
        ability_label(m.get("ability"))
    )
}

pub(super) fn keyword_grant(m: &P, subj: &str) -> String {
    let kws = map_arr(m, "keywords", jv).unwrap_or_default();
    let noun = if kws.len() == 1 {
        "keyword"
    } else {
        "keywords"
    };
    let replaces = arr(m, "replaces")
        .map(|r| {
            let names: Vec<String> = r.iter().map(jv).collect();
            format!(
                ", replacing {} {} {}",
                pronoun(subj),
                and_list(&names),
                if r.len() == 1 { "keyword" } else { "keywords" }
            )
        })
        .unwrap_or_default();
    format!(
        "{subj} {} the {} {noun}{replaces}",
        v(subj, "gains"),
        and_list(&kws)
    )
}

pub(super) fn weapon_ability_grant(target: Option<&Value>, m: &P, subj: &str, ctx: &Ctx) -> String {
    let kws = map_arr(m, "abilities", bracket_keyword)
        .map(|k| k.join(" and "))
        .unwrap_or_else(|| "[?]".to_string());
    let increment = if sv(m, "if_present") == Some("increment") {
        " (a weapon that already has that ability adds the ratings together)"
    } else {
        ""
    };
    if is_true(m, "incoming") {
        return format!(
            "{}the attacking weapon has {kws}{increment}",
            incoming_lead(m, subj)
        );
    }
    if has_weapon(m) {
        return format!(
            "{} equipped by {} gain {kws}{increment}",
            weapon_noun(m),
            weapon_holder(target, ctx)
        );
    }
    format!(
        "{} gain {kws}{increment}",
        of_or_possessive(subj, "weapons")
    )
}

pub(super) fn aspect_name(aspect: &str) -> String {
    match aspect {
        "uses" => "number of uses",
        "range" => "range",
        "targets" => "number of targets",
        "recipients" => "recipients",
        "selections" => "number of selections",
        "concurrent" => "number that can apply at once",
        "duration" => "duration",
        "start-round" => "first battle round",
        "threshold" => "threshold",
        "options" => "options",
        other => return other.to_string(),
    }
    .to_string()
}

/// The ability an ability-modifier changes: a named one, the one a trigger used, or those reaching an audience.
pub(super) fn modified_ability(r: Option<&Value>, subj: &str, ctx: &Ctx) -> String {
    if let Some(Value::Object(r)) = r {
        if sv(r, "event") == Some("used") {
            return "that ability".to_string();
        }
        if let Some(k) = sv(r, "keyword") {
            return format!("each {k} ability of {subj}");
        }
        return format!(
            "each ability of {subj} that affects {}",
            strip_all(&effect_subject(r.get("affecting"), ctx))
        );
    }
    of_or_possessive(subj, &format!("{} ability", ability_label(r)))
}

pub(super) fn ability_modifier(m: &P, subj: &str, ctx: &Ctx) -> String {
    let whose = modified_ability(m.get("ability"), subj, ctx);
    let aspect_key = sv(m, "aspect");
    let aspect = aspect_name(&jstr(m.get("aspect")));
    let value = match m.get("value") {
        Some(x) if aspect_key == Some("range") && x.is_number() => format!("{}\"", jv(x)),
        Some(Value::String(x)) => dekebab(x),
        other => jstr(other),
    };
    let cap = nn(m, "cap")
        .map(|c| format!(" (to a maximum of {})", jv(c)))
        .unwrap_or_default();
    let recipients = nn(m, "recipients").map(|r| effect_subject(Some(r), ctx));
    let option = nn(m, "add_option").map(|opt| {
        let opt = obj(Some(opt));
        format!(
            "the option {} ({})",
            title_case(&jstr(opt.get("name"))),
            super::inline(opt.get("effect").unwrap_or(&Value::Null), ctx)
        )
    });
    let op = sv(m, "operation");
    // An add with no value only widens the ability: it names the new recipients or option instead of a count.
    let widen = recipients.as_deref().is_some_and(|r| !r.is_empty())
        || option.as_deref().is_some_and(|o| !o.is_empty());
    if nn(m, "value").is_none() && op != Some("set") && op != Some("lift-limit") && widen {
        let mut parts = Vec::new();
        if let Some(r) = recipients.as_deref().filter(|r| !r.is_empty()) {
            parts.push(format!("{whose} can also affect {r}"));
        }
        if let Some(o) = option.as_deref().filter(|o| !o.is_empty()) {
            parts.push(format!("{whose} gains {o}"));
        }
        return parts.join("; ") + &cap;
    }
    let mut s = match op {
        Some("lift-limit") => format!("{whose} has no limit on its {aspect}"),
        Some("set") => format!(
            "the {aspect} of {whose} {} {value}",
            if aspect_key == Some("options") || aspect_key == Some("recipients") {
                "are"
            } else {
                "is"
            }
        ),
        Some("subtract") => format!("decrease the {aspect} of {whose} by {value}"),
        _ => format!("increase the {aspect} of {whose} by {value}"),
    };
    if let Some(r) = recipients.filter(|r| !r.is_empty()) {
        s.push_str(&format!("; it can also affect {r}"));
    }
    if let Some(o) = option.filter(|o| !o.is_empty()) {
        s.push_str(&format!("; add {o}"));
    }
    s + &cap
}

pub(super) fn activity(a: &str) -> Option<&'static str> {
    Some(match a {
        "shoot" => "shoot",
        "declare-charge" => "declare a charge",
        "fight" => "fight",
        "start-action" => "start an Action",
        "embark" => "embark",
        "disembark" => "disembark",
        "fall-back" => "Fall Back",
        "advance" => "Advance",
        "use-stratagem" => "be targeted with Stratagems",
        "issue-order" => "issue Orders",
        "attempt-ritual" => "attempt Rituals",
        "use-enhancement" => "use Enhancements",
        "move" => "move",
        "observe" => "act as an Observer",
        _ => return None,
    })
}

pub(super) fn after_phrase(a: &str) -> Option<&'static str> {
    Some(match a {
        "advance" => "Advanced",
        "fall-back" => "Fell Back",
        "disembark" => "disembarked",
        "normal-move" => "made a Normal move",
        "charge" => "made a Charge move",
        "remain-stationary" => "Remained Stationary",
        "set-up" => "was set up",
        _ => return None,
    })
}

pub(super) fn despite_phrase(d: &str) -> Option<&'static str> {
    Some(match d {
        "engaged" => "within Engagement Range of enemy units",
        "battle-shocked" => "Battle-shocked",
        "shot-this-phase" => "has already shot this phase",
        "fought-this-phase" => "has already fought this phase",
        "disembarked-this-turn" => "disembarked this turn",
        "stratagem-used-this-phase" => "has already been targeted with that Stratagem this phase",
        "performing-action" => "performing an Action",
        "advanced" => "Advanced this turn",
        "fell-back" => "Fell Back this turn",
        _ => return None,
    })
}

pub(super) fn permission(m: &P, subj: &str, ctx: &Ctx) -> String {
    let it = if subj.starts_with("all ") || has_word_end(subj, " units") {
        "they"
    } else {
        "it"
    };
    let act_key = jstr(m.get("activity"));
    let act = match nn(m, "stratagem") {
        Some(strat) if act_key == "use-stratagem" => {
            format!("be targeted with the {} Stratagem", title_case(&jv(strat)))
        }
        _ => activity(&act_key)
            .map(str::to_string)
            .unwrap_or_else(|| act_key.clone()),
    };
    let into = nn(m, "into")
        .map(|i| {
            let prep = match act_key.as_str() {
                "shoot" => "at",
                "declare-charge" => "against",
                _ => "into",
            };
            format!(" {prep} {}", none_of(&effect_subject(Some(i), ctx)))
        })
        .unwrap_or_default();
    let reach = nn(m, "reach")
        .map(|r| format!(" from up to {}\" away", jv(r)))
        .unwrap_or_default();
    let mut s = if is_false(m, "allow") {
        format!("{} cannot {act}{into}", none_of(subj))
    } else {
        format!("{subj} {} eligible to {act}{into}{reach}", v(subj, "is"))
    };
    if let Some(after) = map_arr(m, "after", |a| {
        let a = jv(a);
        after_phrase(&a).map(str::to_string).unwrap_or(a)
    }) {
        s.push_str(&format!(" in a turn in which {it} {}", or_list(&after)));
    }
    if let Some(clauses) = map_arr(m, "despite", |d| {
        let d = jv(d);
        let phrase = despite_phrase(&d).map(str::to_string).unwrap_or(d.clone());
        if ["engaged", "battle-shocked", "performing-action"].contains(&d.as_str()) {
            let is = if it == "they" { "they are" } else { "it is" };
            return format!("{is} {phrase}");
        }
        // "they has already shot" → "they have already shot".
        if it == "they" {
            if let Some(rest) = phrase.strip_prefix("has ") {
                return format!("{it} have {rest}");
            }
        }
        format!("{it} {phrase}")
    }) {
        s.push_str(&format!(" even if {}", or_list(&clauses)));
    }
    if let Some(as_if) = nn(m, "as_if") {
        let key = jv(as_if);
        s.push_str(&match key.as_str() {
            "shooting-phase" => " as if it were your Shooting phase".to_string(),
            "fight-phase" => " as if it were the Fight phase".to_string(),
            "snap-shooting" => " using the Snap Shooting rules".to_string(),
            _ => format!(" as if {key}"),
        });
    }
    if is_true(m, "next") {
        s.push_str(&format!(", and must be the next unit selected to {act}"));
    }
    s
}

pub(super) fn targeting(m: &P, subj: &str, ctx: &Ctx) -> String {
    let who = strip_all(&match nn(m, "by") {
        Some(by) => effect_subject(Some(by), ctx),
        None if nn(m, "target").is_some() => subj.to_string(),
        None => "units".to_string(),
    });
    let by_object = m
        .get("by")
        .is_some_and(|b| b.is_object() || b.is_array() || b.is_null());
    let attacking = if by_object || who == "units" || is_plural(&who) {
        if has_word(&who, "models") {
            "the attacking model"
        } else {
            "the attacking unit"
        }
        .to_string()
    } else {
        who.clone()
    };
    let whom = match nn(m, "target") {
        Some(t) if t.as_str() == Some("every-eligible") => "every eligible target".to_string(),
        Some(t) => effect_subject(Some(t), ctx),
        None => subj.to_string(),
    };
    let may = sv(m, "may");
    let verb = match may {
        Some("cannot-target") => "cannot target",
        Some("must-target") => "must target",
        _ => "can target",
    };
    let kind_key = jstr(m.get("kind"));
    let kind = match nn(m, "stratagem") {
        Some(strat) if kind_key == "stratagem" => {
            format!(" with the {} Stratagem", title_case(&jv(strat)))
        }
        _ if has_weapon(m) => format!(" with {}", weapon_noun(m)),
        _ => match kind_key.as_str() {
            "attack" => " with attacks",
            "shoot" => " with ranged attacks",
            "fight" => " with melee attacks",
            "charge" => " with a charge",
            "stratagem" => " with Stratagems",
            "ability" => " with abilities",
            _ => "",
        }
        .to_string(),
    };
    let range = match nn(m, "range") {
        None => String::new(),
        Some(r) if may == Some("cannot-target") => {
            format!(" unless {attacking} is within {}", range_phrase(Some(r)))
        }
        Some(r) => format!(" within {}", range_phrase(Some(r))),
    };
    let unless = nn(m, "only_if_none")
        .map(|o| {
            let noun = strip_all(&effect_subject(Some(o), ctx));
            format!(
                ", unless there is no other eligible {}",
                replace_word_first(&noun, " units", " unit", false)
            )
        })
        .unwrap_or_default();
    format!("{who} {verb} {whom}{kind}{range}{unless}")
}

pub(super) fn counts_as(m: &P, subj: &str, ctx: &Ctx) -> String {
    if let Some(region) = nn(m, "in_region") {
        return format!(
            "{subj} {} as being within {}",
            v(subj, "counts"),
            region_phrase(obj(Some(region)))
        );
    }
    let of = match nn(m, "of") {
        Some(of) => effect_subject(Some(of), ctx),
        None => "this model".to_string(),
    };
    format!(
        "{subj} {} as being within {} of {of}",
        v(subj, "counts"),
        range_phrase(m.get("within"))
    )
}

pub(super) fn core_rule(rule: &str) -> Option<(&'static str, &'static str)> {
    Some(match rule {
        "benefit-of-cover" => ("has the Benefit of Cover", "cannot benefit from Cover"),
        "charge" => ("can charge", "cannot charge"),
        "advance" => ("can Advance", "cannot Advance"),
        "fall-back" => ("can Fall Back", "cannot Fall Back"),
        "ordered-retreat" => (
            "is not affected by Desperate Escape tests",
            "must take Desperate Escape tests",
        ),
        "fire-overwatch" => ("can fire Overwatch", "cannot fire Overwatch"),
        "desperate-escape" => (
            "must take Desperate Escape tests",
            "is not affected by Desperate Escape tests",
        ),
        "attacking-ends-hidden" => (
            "stops being hidden when it attacks",
            "does not stop being hidden when it attacks",
        ),
        _ => return None,
    })
}

pub(super) fn rule_state(m: &P, subj: &str) -> String {
    let granted = sv(m, "direction") == Some("granted");
    let rule = jstr(m.get("rule"));
    let kind = sv(m, "rule_kind");
    if kind == Some("faction-rule") {
        return if granted {
            format!("{subj} {} {}", v(subj, "gains"), title_case(&rule))
        } else {
            format!("{subj} cannot use {}", title_case(&rule))
        };
    }
    if rule == "overwatch-against-bearer" {
        return format!(
            "your opponent {} target {subj} with Overwatch",
            if granted { "can" } else { "cannot" }
        );
    }
    if let (Some("core-rule"), Some(core)) = (kind, core_rule(&rule)) {
        let phrase = if granted { core.0 } else { core.1 };
        if phrase.starts_with("cannot ") {
            return format!("{} {phrase}", none_of(subj));
        }
        for w in ["has", "is", "stops", "does"] {
            if let Some(rest) = phrase.strip_prefix(&format!("{w} ")) {
                return format!("{subj} {} {rest}", v(subj, w));
            }
        }
        return format!("{subj} {phrase}");
    }
    let noun = match kind {
        Some("keyword") => "keyword",
        Some("core-rule") => "rule",
        _ => "ability",
    };
    let verb = if granted { "gains" } else { "loses" };
    format!("{subj} {} the {} {noun}", v(subj, verb), title_case(&rule))
}
