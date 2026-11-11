//! Which Stratagem targets a unit (and the units attached to it) can be, and which datasheet
//! keywords some unit prints. Mirrors the target half of
//! `tools/src/abilities-resolver/resolver.ts`; the `conformance/abilities-resolver`
//! `stratagem-targets.json` corpus pins the shared contract.

use std::collections::HashSet;

use serde_json::{json, Value};

use super::ability_gates::eligibility_keywords;
use super::dataset::Dataset;
use super::normalize::normalize_name;
use crate::cruncher::from_dsl::strip_nulls;

/// Whether a unit with `keywords` (lower-cased) can be a stratagem's friendly target. A stratagem
/// with no friendly target (none printed, or only enemy targets) does not restrict its user here;
/// with several friendly targets, matching any one is enough. The resolver does not know which
/// model is the Warlord, so a Warlord target only needs a unit that could contain it: one with
/// CHARACTER, the keyword every Warlord carries. Mirrors TS `stratagemCanTarget`.
pub fn stratagem_can_target(stratagem: &crate::Stratagem, keywords: &HashSet<String>) -> bool {
    stratagem_can_target_unit(stratagem, std::slice::from_ref(keywords), None, &|_| true)
}

/// Whether a unit of `members` (each member's keywords: a unit and the units attached to it) can
/// be a stratagem's friendly target, as [`stratagem_can_target`]. A target that selects a model
/// needs one member that meets it alone; a unit target reads every member as one combined unit. A
/// target bound to the triggering unit is also held to the keyword lists of `trigger_subject` (its
/// ability's `trigger.subject`). A keyword that subject requires and no datasheet prints (`printed`
/// says which do) is gained in play, so it is not held against a unit. Keywords compare by
/// [`normalize_name`]. Mirrors TS `stratagemCanTargetUnit`.
pub fn stratagem_can_target_unit(
    stratagem: &crate::Stratagem,
    members: &[HashSet<String>],
    trigger_subject: Option<&Value>,
    printed: &dyn Fn(&str) -> bool,
) -> bool {
    let Some(raw) = stratagem
        .target_restrictions
        .as_ref()
        .and_then(|t| serde_json::to_value(t).ok())
        .map(|t| strip_nulls(&t))
    else {
        return true;
    };
    let targets: Vec<&Value> = match &raw {
        Value::Array(items) => items.iter().collect(),
        Value::Null => return true,
        other => vec![other],
    };
    let friendly: Vec<&Value> = targets
        .into_iter()
        .filter(|target| target.get("side").and_then(Value::as_str) != Some("enemy"))
        .collect();
    if friendly.is_empty() {
        return true;
    }
    let holds = target_holds(members, trigger_subject, printed);
    friendly.into_iter().any(holds)
}

/// For a Stratagem with several targets (an array `target_restrictions`), whether a unit of
/// `members` can be each named friendly target, read as [`stratagem_can_target_unit`] reads each
/// target: what `{stratagem_target: name}` resolves to when the Stratagem is used on that unit.
/// Enemy targets are not listed. Mirrors TS `stratagemTargetNames`.
pub fn stratagem_target_names(
    stratagem: &crate::Stratagem,
    members: &[HashSet<String>],
    trigger_subject: Option<&Value>,
    printed: &dyn Fn(&str) -> bool,
) -> std::collections::BTreeMap<String, bool> {
    let raw = stratagem
        .target_restrictions
        .as_ref()
        .and_then(|t| serde_json::to_value(t).ok())
        .map(|t| strip_nulls(&t));
    let Some(Value::Array(targets)) = raw else {
        return Default::default();
    };
    let holds = target_holds(members, trigger_subject, printed);
    targets
        .iter()
        .filter(|target| target.get("side").and_then(Value::as_str) != Some("enemy"))
        .filter_map(|target| {
            let name = target.get("name").and_then(Value::as_str)?;
            Some((name.to_string(), holds(target)))
        })
        .collect()
}

/// Whether a unit of `members` meets one friendly Stratagem target. The target's `eligibility`
/// refuses the unit only when its keyword checks decide it false (see [`eligibility_keywords`]);
/// a keyword no datasheet prints counts as held there.
fn target_holds<'a>(
    members: &[HashSet<String>],
    trigger_subject: Option<&Value>,
    printed: &'a dyn Fn(&str) -> bool,
) -> impl Fn(&Value) -> bool + 'a {
    let normalized: Vec<HashSet<String>> = members
        .iter()
        .map(|member| member.iter().map(|k| normalize_name(k)).collect())
        .collect();
    let combined: HashSet<String> = normalized.iter().flatten().cloned().collect();
    let subject = friendly_subject(trigger_subject);
    move |target: &Value| {
        let candidates: Vec<&HashSet<String>> =
            if target.get("selects").and_then(Value::as_str) == Some("model") {
                normalized.iter().collect()
            } else {
                vec![&combined]
            };
        candidates.into_iter().any(|keywords| {
            let has = |keyword: &str| keywords.contains(&normalize_name(keyword));
            let gained = |keyword: &str| has(keyword) || !printed(keyword);
            let warlord = target.get("warlord").and_then(Value::as_bool) == Some(true);
            let bound = target.get("bound_to").and_then(Value::as_str) == Some("triggering-unit");
            (!warlord || has("character"))
                && keyword_lists_hold(target, &has, &has)
                && eligibility_keywords(target.get("eligibility"), &gained, &has) != Some(false)
                && (!bound
                    || subject
                        .as_ref()
                        .is_none_or(|subject| keyword_lists_hold(subject, &gained, &has)))
        })
    }
}

/// Whether a Stratagem names a friendly target in `target_restrictions`.
pub(super) fn has_friendly_target(stratagem: &crate::Stratagem) -> bool {
    let raw = stratagem
        .target_restrictions
        .as_ref()
        .and_then(|t| serde_json::to_value(t).ok())
        .map(|t| strip_nulls(&t));
    match raw {
        Some(Value::Array(items)) => items
            .iter()
            .any(|target| target.get("side").and_then(Value::as_str) != Some("enemy")),
        Some(Value::Null) | None => false,
        Some(target) => target.get("side").and_then(Value::as_str) != Some("enemy"),
    }
}

/// A trigger subject's keyword lists, as a target restriction, when it names a friendly unit.
fn friendly_subject(subject: Option<&Value>) -> Option<Value> {
    let subject = subject?.as_object()?;
    if subject
        .get("owner")
        .is_some_and(|owner| owner.as_str() != Some("friendly"))
    {
        return None;
    }
    let list = |key: &str| {
        subject
            .get(key)
            .cloned()
            .unwrap_or(Value::Array(Vec::new()))
    };
    Some(json!({
        "required_keywords": list("all_of"),
        "required_keywords_any": list("any_of"),
        "excluded_keywords": list("none_of"),
    }))
}

/// Whether a target's required lists hold by `required` and none of its excluded keywords holds
/// by `excluded`.
fn keyword_lists_hold(
    target: &Value,
    required: &dyn Fn(&str) -> bool,
    excluded: &dyn Fn(&str) -> bool,
) -> bool {
    let list = |key: &str| -> Vec<&str> {
        target
            .get(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    };
    let any = list("required_keywords_any");
    list("required_keywords").into_iter().all(required)
        && (any.is_empty() || any.into_iter().any(required))
        && !list("excluded_keywords").into_iter().any(excluded)
}

impl Dataset {
    /// Whether some datasheet prints a keyword (unit, faction or conditional keyword), memoised
    /// per lookup.
    /// Scans the "all" game-mode view: a keyword printed only on a Combat Patrol datasheet is
    /// still a printed keyword, whatever mode this dataset lists.
    pub(super) fn printed_keyword(&self) -> impl Fn(&str) -> bool + '_ {
        let seen = std::cell::RefCell::new(std::collections::HashMap::<String, bool>::new());
        let units = self.units.with_game_mode(crate::data::GameModeView::All);
        move |keyword: &str| {
            let key = normalize_name(keyword);
            if let Some(found) = seen.borrow().get(&key) {
                return *found;
            }
            let found = units.iter().any(|unit| {
                [&unit.keywords, &unit.faction_keywords]
                    .into_iter()
                    .flatten()
                    .any(|list| list.0.iter().any(|own| normalize_name(own) == key))
                    || unit
                        .conditional_keywords
                        .iter()
                        .any(|entry| normalize_name(&entry.keyword) == key)
            });
            seen.borrow_mut().insert(key, found);
            found
        }
    }
}
