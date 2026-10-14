//! Shared references: unit-ref, unit-filter, range, objective, state,
//! designation, history-window and move-kind phrases, and keyword lists.

use serde_json::Value;

use super::js::*;
use crate::translate::dekebab;
use crate::translate::designations::designation_label;
use crate::translate::effect::title_case;

// ── Ids as names ────────────────────────────────────────────────────────────

/// Faction dir slugs an ability or Stratagem id ends with (`<name>-<faction>`), longest first.
/// The suffix is identity, not name, so it never reaches the English.
const FACTION_SUFFIXES: &[&str] = &[
    "agents-of-the-imperium",
    "chaos-space-marines",
    "adeptus-mechanicus",
    "leagues-of-votann",
    "emperors-children",
    "genestealer-cults",
    "adepta-sororitas",
    "imperial-knights",
    "adeptus-custodes",
    "adeptus-astartes",
    "astra-militarum",
    "black-templars",
    "imperial-fists",
    "chaos-knights",
    "thousand-sons",
    "chaos-daemons",
    "blood-angels",
    "ultramarines",
    "space-wolves",
    "grey-knights",
    "world-eaters",
    "white-scars",
    "raven-guard",
    "dark-angels",
    "salamanders",
    "death-guard",
    "iron-hands",
    "tau-empire",
    "deathwatch",
    "drukhari",
    "tyranids",
    "aeldari",
    "necrons",
    "orks",
];

/// An ability or Stratagem id without its faction suffix
/// (`acts-of-faith-adepta-sororitas` → `acts-of-faith`).
pub(crate) fn without_faction_suffix(id: &str) -> &str {
    for f in FACTION_SUFFIXES {
        if let Some(head) = id.strip_suffix(f).and_then(|h| h.strip_suffix('-')) {
            if !head.is_empty() {
                return head;
            }
        }
    }
    id
}

/// An ability or Stratagem id as a name: its name part in Title Case. An id whose name itself
/// ends with the faction (the suffix was never added) keeps it.
pub(crate) fn id_label(id: Option<&Value>) -> String {
    let s = st(id);
    match s.as_str() {
        "lord-of-the-death-guard" => "Lord of the Death Guard".to_string(),
        _ => title_case(without_faction_suffix(&s)),
    }
}

// ── Shared references ───────────────────────────────────────────────────────

pub(crate) fn role_phrase(role: &str) -> Option<&'static str> {
    Some(match role {
        "this-unit" => "the unit",
        "this-model" => "this model",
        "model-in-this-unit" => "a model in this unit",
        "attacker" => "the attacking unit",
        "defender" => "the target unit",
        "event-subject" => "the triggering unit",
        "event-object" => "that unit",
        "stratagem-target" => "the Stratagem's target",
        "selected-unit" => "the selected unit",
        "recipient" => "the unit",
        "bearer-transport" => "the Transport this unit is embarked within",
        "ability-unit" => "this unit",
        _ => return None,
    })
}

/// A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit".
pub(crate) fn unit_filter_phrase(f: &P) -> String {
    let owner = if is(f, "owner", "friendly") {
        "friendly "
    } else if is(f, "owner", "enemy") {
        "enemy "
    } else {
        ""
    };
    let all = strs(f.get("all_of"))
        .map(|k| format!("{} ", k.join(" ")))
        .unwrap_or_default();
    let noun = if is(f, "level", "model") {
        "model"
    } else {
        "unit"
    };
    let base = format!("{owner}{all}{noun}");
    // `/^(?:[aeio]|u(?!ni))/i`: "an ORKS unit", "a unit", "an UNDEAD unit".
    let lower = base.to_lowercase();
    let an = lower.starts_with(['a', 'e', 'i', 'o'])
        || (lower.starts_with('u') && !lower.starts_with("uni"));
    let mut s = format!("{} {base}", if an { "an" } else { "a" });
    if let Some(any) = strs(f.get("any_of")) {
        s.push_str(&format!(" with the {} keyword", or_list(&any)));
    }
    if let Some(none) = strs(f.get("none_of")) {
        s.push_str(&format!(" (excluding {} {noun}s)", or_list(&none)));
    }
    let titled = |v: &Value| id_label(Some(v));
    if let Some(has) = f.get("has_ability").and_then(Value::as_array) {
        let names: Vec<String> = has.iter().map(titled).collect();
        s.push_str(&format!(" with the {} ability", and_list(&names)));
    }
    if let Some(lacks) = f.get("lacks_ability").and_then(Value::as_array) {
        let names: Vec<String> = lacks.iter().map(titled).collect();
        s.push_str(&format!(" without the {} ability", or_list(&names)));
    }
    if let Some(e) = nn(f, "embarked_in") {
        s.push_str(&format!(
            " embarked within {}",
            unit_ref_phrase(Some(e), "the unit")
        ));
    }
    if let Some(m) = nn(f, "member_of") {
        s.push_str(&format!(" in {}", unit_ref_phrase(Some(m), "the unit")));
    }
    if let Some(g) = nn(f, "engaged_with") {
        s.push_str(&format!(
            " within Engagement Range of {}",
            unit_filter_phrase(obj(Some(g)))
        ));
    }
    if let Some(g) = nn(f, "not_engaged_with") {
        s.push_str(&format!(
            " not within Engagement Range of any {}",
            strip_article(&unit_filter_phrase(obj(Some(g))))
        ));
    }
    if let Some(d) = nn(f, "designated") {
        let by = nn(f, "designated_by")
            .map(|b| format!(" by {}", unit_ref_phrase(Some(b), "the unit")))
            .unwrap_or_default();
        s.push_str(&format!(
            " that is {}{by}",
            designation_phrase(&st(Some(d)), false)
        ));
    }
    if let Some(d) = nn(f, "not_designated") {
        s.push_str(&format!(
            " that is not {}",
            designation_phrase(&st(Some(d)), false)
        ));
    }
    if let Some(state) = nn(f, "state") {
        s.push_str(&format!(
            " that is {}",
            state_phrase(&st(Some(state)), false)
        ));
    }
    if f.get("visible") == Some(&Value::Bool(true)) {
        s.push_str(" that is visible to it");
    }
    if let Some(within) = nn(f, "within") {
        let w = obj(Some(within));
        let wholly = if w.get("wholly") == Some(&Value::Bool(true)) {
            "wholly "
        } else {
            ""
        };
        s.push_str(&format!(" {wholly}within {}", range_phrase(w.get("range"))));
        if let Some(of) = nn(w, "of") {
            s.push_str(&format!(" of {}", unit_ref_phrase(Some(of), "the unit")));
        }
    }
    if let Some(ex) = nn(f, "excluding") {
        let other = if ex.as_str() == Some("this-unit") {
            "this unit".to_string()
        } else {
            unit_ref_phrase(Some(ex), "the unit")
        };
        s.push_str(&format!(" other than {other}"));
    }
    s
}

/// A unit-ref as a noun phrase; `fallback` names the default subject.
pub(crate) fn unit_ref_phrase(r: Option<&Value>, fallback: &str) -> String {
    match r {
        None | Some(Value::Null) => fallback.to_string(),
        Some(Value::String(s)) => role_phrase(s)
            .map(str::to_string)
            .unwrap_or_else(|| dekebab(s)),
        Some(Value::Object(o)) => {
            if o.get("event_var").is_some_and(Value::is_string) {
                return "that unit".to_string();
            }
            if o.get("selection_var").is_some_and(Value::is_string) {
                return format!("the bound {}", st(o.get("selection_var")).replace('_', " "));
            }
            if let Some(t) = o.get("stratagem_target").and_then(Value::as_str) {
                return format!(
                    "the {} target",
                    dekebab(t.strip_prefix("the-").unwrap_or(t))
                );
            }
            unit_filter_phrase(o)
        }
        Some(_) => fallback.to_string(),
    }
}

/// The subject of a predicate.
pub(crate) fn subject_of(p: &P, fallback: &str) -> String {
    unit_ref_phrase(p.get("subject"), fallback)
}

/// A range-ref as a distance phrase ("6\"", "Engagement Range", "Contagion Range").
pub(crate) fn range_phrase(r: Option<&Value>) -> String {
    match r {
        None | Some(Value::Null) => "?\"".to_string(),
        Some(Value::String(s)) => match s.as_str() {
            "engagement" => "Engagement Range".to_string(),
            "aura" => "its aura range".to_string(),
            "weapon" => "the attacking weapon's range".to_string(),
            "half-weapon" => "half the attacking weapon's range".to_string(),
            "detection" => "detection range".to_string(),
            "objective-control" => "range".to_string(),
            other => dekebab(other),
        },
        Some(v) => {
            let o = obj(Some(v));
            if let Some(inches) = nn(o, "inches") {
                return format!("{}\"", st(Some(inches)));
            }
            if let Some(aura) = nn(o, "aura_of") {
                let id = st(Some(aura));
                return match id.as_str() {
                    "nurgles-gift-death-guard" => "Contagion Range".to_string(),
                    _ => format!("the {} range", id_label(Some(aura))),
                };
            }
            "?\"".to_string()
        }
    }
}

pub(crate) fn objective_phrase(f: &P, plural: bool, noun: &str) -> String {
    let role = if is(f, "role", "non-home") {
        String::new()
    } else if let Some(r) = nn(f, "role") {
        format!("{} ", dekebab(&st(Some(r))))
    } else {
        String::new()
    };
    let mut s = format!("{role}{noun}{}", if plural { "s" } else { "" });
    if is(f, "home_of", "enemy") {
        s.push_str(" (opponent home)");
    }
    if is(f, "home_of", "friendly") {
        s.push_str(" (your home)");
    }
    if let Some(name) = nn(f, "name") {
        s.push_str(&format!(" ({})", dekebab(&st(Some(name)))));
    }
    if let Some(t) = nn(f, "territory") {
        s.push_str(&format!(" in {}", dekebab(&st(Some(t)))));
    }
    if is(f, "role", "non-home") {
        s.push_str(" (excluding home)");
    }
    if is(f, "controlled_by", "friendly") {
        s.push_str(" you control");
    }
    if is(f, "controlled_by", "enemy") {
        s.push_str(" your opponent controls");
    }
    if let Some(d) = nn(f, "designated") {
        s.push_str(&format!(" tagged {}", dekebab(&st(Some(d)))));
    }
    s
}

pub(crate) fn state_phrase_base(state: &str) -> Option<&'static str> {
    Some(match state {
        "engaged" => "engaged",
        "battle-shocked" => "Battle-shocked",
        "embarked" => "embarked",
        "in-strategic-reserves" => "in Strategic Reserves",
        "on-battlefield" => "on the battlefield",
        "hidden" => "hidden",
        "fights-first" => "a Fights First unit",
        "benefit-of-cover" => "receiving the benefit of cover",
        _ => return None,
    })
}

pub(crate) fn state_phrase(state: &str, negated: bool) -> String {
    let base = state_phrase_base(state)
        .map(str::to_string)
        .unwrap_or_else(|| dekebab(state));
    if negated {
        if state == "engaged" {
            return "unengaged".to_string();
        }
        return format!("not {base}");
    }
    base
}

/// A designation: a registered id prints the rules' term, legacy upper-case tags stay as
/// printed, internal ones are spelled out.
pub(crate) fn designation_phrase(tag: &str, plural: bool) -> String {
    if let Some(label) = designation_label(tag, plural) {
        return label;
    }
    if tag == tag.to_uppercase() {
        tag.to_string()
    } else {
        format!("tagged {}", dekebab(tag))
    }
}

pub(crate) fn window_phrase(w: Option<&Value>) -> String {
    let key = st(w);
    match key.as_str() {
        "phase" => "this phase".to_string(),
        "turn" => "this turn".to_string(),
        "round" => "this battle round".to_string(),
        "battle" => "this battle".to_string(),
        "previous-turn" => "in the previous turn".to_string(),
        "event" => String::new(),
        other => dekebab(other),
    }
}

pub(crate) fn with_window(s: &str, w: Option<&Value>) -> String {
    let phrase = window_phrase(w);
    if phrase.is_empty() {
        s.to_string()
    } else {
        format!("{s} {phrase}")
    }
}

pub(crate) fn move_name(t: &str) -> String {
    match t {
        "normal" => "Normal".to_string(),
        "advance" => "Advance".to_string(),
        "remain-stationary" => "Remain Stationary".to_string(),
        "fall-back" => "Fall Back".to_string(),
        "charge" => "Charge".to_string(),
        "pile-in" => "Pile-in".to_string(),
        "consolidation" => "Consolidation".to_string(),
        "ingress" => "ingress".to_string(),
        "surge" => "Surge".to_string(),
        "scout" => "Scout".to_string(),
        "disembark" => "Disembark".to_string(),
        other => dekebab(other),
    }
}

/// Move types as an or-list of their names ("Normal, Advance or Fall Back").
pub(crate) fn move_kinds(types: Option<&Value>) -> String {
    let names: Vec<String> = types
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|t| move_name(&st(Some(t)))).collect())
        .unwrap_or_default();
    or_list(&names)
}

/// A roll kind as words: "hit", or the dice a named ability rolls ("Reanimation Protocols").
pub(crate) fn roll_word(roll: Option<&Value>) -> String {
    if let Some(Value::Object(o)) = roll {
        if nn(o, "of_ability").is_some() {
            return id_label(o.get("of_ability"));
        }
    }
    dekebab(&st(roll))
}

/// Which ability a `used` filter names: every ability with a bracketed keyword, or the same one
/// as a bound use.
pub(crate) fn used_ability_phrase(f: &P) -> Option<String> {
    if let Some(k) = nn(f, "ability_keyword") {
        return Some(format!(
            "a {} ability",
            title_case(&st(Some(k)).to_lowercase())
        ));
    }
    if nn(f, "same_rule_as").is_some() {
        let what = if is(f, "kind", "stratagem") {
            "Stratagem"
        } else {
            "ability"
        };
        return Some(format!("that same {what}"));
    }
    None
}

// ── Predicates ──────────────────────────────────────────────────────────────

pub(crate) fn quoted(items: Vec<String>) -> Vec<String> {
    items.into_iter().map(|k| format!("\"{k}\"")).collect()
}

pub(crate) fn keyword_list(p: &P) -> String {
    if let Some(chosen) = nn(p, "chosen_by") {
        return format!("the keyword selected for {}", title_case(&st(Some(chosen))));
    }
    if let Some(any) = strs(p.get("any_of")) {
        return or_list(&quoted(any));
    }
    and_list(&quoted(strs(p.get("all_of")).unwrap_or_default()))
}

/// TS `typeof p.count_min === "number" ? p.count_min : 1`, JS-formatted.
pub(crate) fn count_or_one(p: &P) -> (f64, String) {
    match p.get("count_min") {
        Some(Value::Number(n)) => (n.as_f64().unwrap_or(0.0), js_num(n)),
        _ => (1.0, "1".to_string()),
    }
}

/// TS `str(p.key ?? 1)`.
pub(crate) fn str_or_one(p: &P, k: &str) -> String {
    match nn(p, k) {
        Some(v) => st(Some(v)),
        None => "1".to_string(),
    }
}
