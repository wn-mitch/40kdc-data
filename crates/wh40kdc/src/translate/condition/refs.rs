//! Shared references: unit-ref, unit-filter, range, objective, state,
//! designation, history-window and move-kind phrases, and keyword lists.

use serde_json::Value;

use super::js::*;
use crate::translate::dekebab;
use crate::translate::designations::designation_label;
use crate::translate::effect::title_case;

/// Causal links name an exact bound event; sharing its actor is not enough.
pub(crate) fn event_relation_phrase(filter: &P) -> String {
    let mut phrase = String::new();
    if nn(filter, "caused_by").is_some() {
        phrase.push_str(" as a result of the exact bound event");
    }
    if nn(filter, "causes").is_some() {
        phrase.push_str(" and causing the exact bound event");
    }
    phrase
}
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

/// A named rule or one immutable option of a named ability.
pub(crate) fn rule_ref_phrase(value: Option<&Value>) -> String {
    if let Some(reference) = value.and_then(Value::as_object) {
        if reference
            .get("definition_id")
            .is_some_and(|id| !id.is_null())
        {
            return format!(
                "{} ability of {}",
                id_label(reference.get("definition_id")),
                id_label(reference.get("ability_id"))
            );
        }
        return format!(
            "{} option of {}",
            id_label(reference.get("option_id")),
            id_label(reference.get("ability_id"))
        );
    }
    id_label(value)
}

/// Inclusive count bounds shared by selectors and counted predicates.
pub(crate) fn count_phrase(value: Option<&Value>) -> String {
    let count = obj(value);
    match (nn(count, "min"), nn(count, "max")) {
        (Some(min), Some(max)) if !min.is_object() && min == max => {
            format!("exactly {}", crate::translate::effect::dice_case(Some(min)))
        }
        (Some(min), Some(max)) if min.is_number() && max.is_number() => {
            format!("{}-{}", st(Some(min)), st(Some(max)))
        }
        (Some(min), Some(max)) => format!(
            "between {} and {}",
            crate::translate::effect::dice_case(Some(min)),
            crate::translate::effect::dice_case(Some(max))
        ),
        (_, Some(max)) => format!("at most {}", crate::translate::effect::dice_case(Some(max))),
        (Some(min), _) if min.is_number() => format!("{}+", st(Some(min))),
        (Some(min), _) => format!(
            "at least {}",
            crate::translate::effect::dice_case(Some(min))
        ),
        _ => "1+".to_string(),
    }
}

pub(crate) fn comparison_phrase(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str) {
        Some("gt") => "more than".to_string(),
        Some("gte") => "at least".to_string(),
        Some("eq") => "equal to".to_string(),
        Some("lt") => "less than".to_string(),
        Some("lte") => "at most".to_string(),
        _ => dekebab(&st(value)),
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

/// A filter's `any_of_filters` as keyword spellings ("LEGIO CYBERNETICA", "ADEPTUS MECHANICUS
/// VEHICLE") when each alternative is only its keywords and the filter requires none of its own,
/// so "an A or B C unit" says it; else None.
pub(crate) fn keyword_alternatives(f: &P) -> Option<Vec<String>> {
    let alts = f.get("any_of_filters")?.as_array()?;
    if f.get("all_of").is_some_and(Value::is_array) {
        return None;
    }
    let mut out = Vec::with_capacity(alts.len());
    for a in alts {
        let o = a.as_object()?;
        let all = o.get("all_of")?.as_array()?;
        // A typed filter re-serialized from Rust carries its unset `UnitRef` fields as null.
        if all.is_empty() || o.iter().any(|(k, v)| k != "all_of" && !v.is_null()) {
            return None;
        }
        out.push(strs(o.get("all_of"))?.join(" "));
    }
    Some(out)
}

/// Each alternative of `any_of_filters` as a filter of the outer filter's level (models or units).
pub(crate) fn alternative_filters(f: &P) -> Vec<P> {
    let level = f.get("level").filter(|v| !v.is_null());
    f.get("any_of_filters")
        .and_then(Value::as_array)
        .map(|alts| {
            alts.iter()
                .map(|a| {
                    let mut m = a.as_object().cloned().unwrap_or_default();
                    if let Some(level) = level {
                        m.insert("level".to_string(), level.clone());
                    }
                    m
                })
                .collect()
        })
        .unwrap_or_default()
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
        nn(f, "attachment_role")
            .map(|role| format!("{} model", st(Some(role))))
            .unwrap_or_else(|| "model".to_string())
    } else {
        "unit".to_string()
    };
    // "a friendly LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit": keyword-only alternatives.
    let compact = keyword_alternatives(f);
    let base = match &compact {
        Some(alts) => format!("{owner}{} {noun}", or_list(alts)),
        None => format!("{owner}{all}{noun}"),
    };
    // `/^(?:[aeio]|u(?!ni))/i`: "an ORKS unit", "a unit", "an UNDEAD unit".
    let lower = base.to_lowercase();
    let an = lower.starts_with(['a', 'e', 'i', 'o'])
        || (lower.starts_with('u') && !lower.starts_with("uni"));
    let mut s = format!("{} {base}", if an { "an" } else { "a" });
    // Any other alternatives: "a unit that is a PSYKER unit or a unit that is Battle-shocked".
    if compact.is_none() && f.get("any_of_filters").is_some_and(Value::is_array) {
        let alts: Vec<String> = alternative_filters(f)
            .iter()
            .map(unit_filter_phrase)
            .collect();
        s.push_str(&format!(" that is {}", or_list(&alts)));
    }
    if let Some(any) = strs(f.get("any_of")) {
        s.push_str(&format!(" with the {} keyword", or_list(&any)));
    }
    if let Some(none) = strs(f.get("none_of")) {
        s.push_str(&format!(" (excluding {} {noun}s)", or_list(&none)));
    }
    if let Some(not_all) = strs(f.get("not_all_of")) {
        s.push_str(&format!(" (excluding {} {noun}s)", not_all.join(" ")));
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
    if let Some(names) = strs(f.get("model_names")) {
        s.push_str(&format!(" named {}", or_list(&names)));
    }
    if let Some(ids) = strs(f.get("unit_ids")) {
        s.push_str(&format!(" with unit ID {}", or_list(&ids)));
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
            unit_ref_phrase(Some(g), "the unit")
        ));
    }
    if let Some(g) = nn(f, "not_engaged_with") {
        let phrase = unit_ref_phrase(Some(g), "the unit");
        let filter = g.as_object().is_some_and(|o| {
            !["selection_var", "event_var", "stratagem_target"]
                .iter()
                .any(|k| nn(o, k).is_some())
        });
        s.push_str(&format!(
            " not within Engagement Range of {}",
            if filter {
                format!("any {}", strip_article(&phrase))
            } else {
                phrase
            }
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
    if let Some(Value::Array(not)) = f.get("not_states") {
        let phrases: Vec<String> = not
            .iter()
            .map(|x| state_phrase(&st(Some(x)), true))
            .collect();
        s.push_str(&format!(" that is {}", and_list(&phrases)));
    }
    if let Some(visible) = nn(f, "visible") {
        s.push_str(&format!(
            " that is visible to {}",
            unit_ref_phrase(obj(Some(visible)).get("to"), "the unit")
        ));
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
            s.push_str(&format!(" of {}", place_ref_phrase(Some(of))));
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
                    "synapse-tyranids" => "Synapse Range".to_string(),
                    _ => format!("the {} range", id_label(Some(aura))),
                };
            }
            if let Some(tiers) = o.get("per_battle_round").and_then(Value::as_array) {
                let ranges = tiers
                    .iter()
                    .map(|tier| range_phrase(Some(tier)))
                    .collect::<Vec<_>>()
                    .join(", ");
                let rounds = (1..=tiers.len())
                    .map(|round| round.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                return format!("{ranges} in battle rounds {rounds} respectively (using the final range in later battle rounds)");
            }
            "?\"".to_string()
        }
    }
}

/// A spatial anchor, retaining objective and marker identities.
pub(crate) fn place_ref_phrase(r: Option<&Value>) -> String {
    match r.and_then(Value::as_str) {
        Some("battlefield-edge") => return "a battlefield edge".to_string(),
        Some("battlefield-centre") => return "the centre of the battlefield".to_string(),
        _ => {}
    }
    let p = obj(r);
    if let Some(objective) = nn(p, "objective") {
        let objective = obj(Some(objective));
        if nn(objective, "selection_var").is_some() {
            return "that objective marker".to_string();
        }
        let phrase = objective_phrase(objective, false, "objective marker");
        return format!("{} {phrase}", article(&phrase));
    }
    if let Some(marker) = nn(p, "marker") {
        let marker = st(Some(marker));
        return format!("{} {} marker", article(&marker), dekebab(&marker));
    }
    unit_ref_phrase(r, "the unit")
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
    if let Some(within) = nn(f, "within") {
        let within = obj(Some(within));
        s.push_str(&format!(
            " within {} of {}",
            range_phrase(within.get("range")),
            place_ref_phrase(within.get("of"))
        ));
    }
    s
}

pub(crate) fn state_phrase_base(state: &str) -> Option<&'static str> {
    Some(match state {
        "engaged" => "engaged",
        "battle-shocked" => "Battle-shocked",
        "embarked" => "embarked",
        "in-strategic-reserves" => "in Strategic Reserves",
        "in-cult-ambush" => "in Cult Ambush",
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
        "battle-round" => "battle round".to_string(),
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

/// One named rule a `used` filter names by id ("Reanimation Protocols", "the Swift as the Wind
/// Agile Manoeuvre"), or None. An ability is its name alone; the other kinds add their noun.
pub(crate) fn named_use_phrase(f: &P) -> Option<String> {
    let id = nn(f, "id")?;
    let kind = st(f.get("kind"));
    if kind == "ability" {
        return Some(id_label(Some(id)));
    }
    let noun = match kind.as_str() {
        "manoeuvre" => "Agile Manoeuvre",
        "stratagem" => "Stratagem",
        "action" => "action",
        _ => return None,
    };
    Some(format!("the {} {noun}", id_label(Some(id))))
}

/// A rule of one kind being used now, when the filter names none.
pub(crate) fn in_progress_phrase(kind: &str) -> String {
    match kind {
        "ability" => "an ability".to_string(),
        "stratagem" => "a Stratagem".to_string(),
        "manoeuvre" => "an Agile Manoeuvre".to_string(),
        "action" => "an action".to_string(),
        "order" => "an Order".to_string(),
        "ritual" => "a Ritual".to_string(),
        "dark-pact" => "a Dark Pact".to_string(),
        "act-of-faith" => "an Act of Faith".to_string(),
        "doctrine" => "a Combat Doctrine".to_string(),
        "contract" => "a contract".to_string(),
        other => format!("a {}", dekebab(other)),
    }
}

/// The ability named by a used event, retaining source and usage restrictions.
pub(crate) fn used_ability_phrase(f: &P) -> Option<String> {
    let mut phrase = if let Some(keyword) = nn(f, "ability_keyword") {
        format!(
            "a {} ability",
            title_case(&st(Some(keyword)).to_lowercase())
        )
    } else if nn(f, "same_rule_as").is_some() {
        format!(
            "that same {}",
            if is(f, "kind", "stratagem") {
                "Stratagem"
            } else {
                "ability"
            }
        )
    } else if nn(f, "source").is_some() || nn(f, "usage").is_some() {
        named_use_phrase(f).unwrap_or_else(|| "an ability".into())
    } else {
        return None;
    };
    if let Some(sources) = f.get("source").and_then(Value::as_array) {
        let sources = sources
            .iter()
            .map(|source| match source.as_str() {
                Some("unit") => "its datasheet".into(),
                Some("enhancement") => "an Enhancement".into(),
                _ => dekebab(&st(Some(source))),
            })
            .collect::<Vec<_>>();
        phrase.push_str(&format!(" from {}", or_list(&sources)));
    }
    if let Some(usage) = nn(f, "usage").filter(|usage| usage.is_object() || usage.is_array()) {
        phrase.push_str(&format!(
            " that can be used {}",
            crate::translate::effect::usage_clause(usage)
        ));
    }
    Some(phrase)
}

// ── Predicates ──────────────────────────────────────────────────────────────

pub(crate) fn quoted(items: Vec<String>) -> Vec<String> {
    items.into_iter().map(|k| format!("\"{k}\"")).collect()
}

pub(crate) fn keyword_list(p: &P) -> String {
    if let Some(any) = strs(p.get("any_of")) {
        return or_list(&quoted(any));
    }
    and_list(&quoted(strs(p.get("all_of")).unwrap_or_default()))
}
