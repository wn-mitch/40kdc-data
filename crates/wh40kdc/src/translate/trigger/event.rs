//! The event family's own clause: who acted, what it was aimed at, which
//! roll, move or rule, before proximity, condition and options are added.

use serde_json::Value;

use crate::translate::condition::{
    and_list, article, cap_word, is, key_count, move_kinds, nn, obj, or_list, st, strs, truthy,
    unit_filter_phrase, P,
};
use crate::translate::dekebab;
use crate::translate::effect::title_case;

/// Whose turn, as a trigger window names it.
pub(crate) fn turn_owner(turn: &str) -> Option<&'static str> {
    match turn {
        "your-turn" => Some("your"),
        "opponent-turn" => Some("your opponent's"),
        _ => None,
    }
}

/// The actor of a trigger: "the unit", "an enemy unit", "this model".
pub(crate) fn actor(r: Option<&Value>) -> String {
    match r {
        None | Some(Value::Null) => "the unit".to_string(),
        Some(Value::String(s)) => match s.as_str() {
            "this-unit" => "the unit".to_string(),
            "this-model" => "this model".to_string(),
            "model-in-this-unit" => "a model in this unit".to_string(),
            other => dekebab(other),
        },
        Some(Value::Object(f)) => {
            if f.get("event_var").is_some_and(Value::is_string) {
                return "that unit".to_string();
            }
            let owner = if is(f, "owner", "friendly") {
                "a friendly"
            } else if is(f, "owner", "enemy") {
                "an enemy"
            } else {
                "a"
            };
            format!(
                "{owner} {}",
                if is(f, "level", "model") {
                    "model"
                } else {
                    "unit"
                }
            )
        }
        Some(other) => dekebab(&st(Some(other))),
    }
}

/// Keyword requirements on a filter actor: " (the triggering unit must have A and B)".
pub(crate) fn actor_keywords(r: Option<&Value>) -> String {
    let Some(f) = r.and_then(Value::as_object) else {
        return String::new();
    };
    let noun = if is(f, "level", "model") {
        "model"
    } else {
        "unit"
    };
    let mut s = String::new();
    if let Some(all) = strs(f.get("all_of")) {
        s.push_str(&format!(
            " (the triggering {noun} must have {})",
            and_list(&all)
        ));
    }
    if let Some(none) = strs(f.get("none_of")) {
        s.push_str(&format!(
            " (the triggering {noun} must not have {})",
            or_list(&none)
        ));
    }
    s
}

/// An object phrase: "this unit", "an enemy unit".
pub(crate) fn object_phrase(r: Option<&Value>) -> String {
    match r {
        None | Some(Value::Null) => "this unit".to_string(),
        Some(Value::String(s)) => match s.as_str() {
            "this-unit" => "this unit".to_string(),
            "this-model" => "this model".to_string(),
            "model-in-this-unit" => "a model in this unit".to_string(),
            other => dekebab(other),
        },
        Some(Value::Object(f)) => unit_filter_phrase(f),
        Some(other) => dekebab(&st(Some(other))),
    }
}

pub(crate) fn roll_noun(roll: &str) -> String {
    match roll {
        "hit" => "Hit roll".to_string(),
        "wound" => "Wound roll".to_string(),
        "save" => "saving throw".to_string(),
        "damage" => "Damage roll".to_string(),
        "charge" => "Charge roll".to_string(),
        "advance" => "Advance roll".to_string(),
        "battle-shock" => "Battle-shock test".to_string(),
        "leadership" => "Leadership test".to_string(),
        "hazard" => "Hazard roll".to_string(),
        "psychic" => "Psychic test".to_string(),
        "desperate-escape" => "Desperate Escape test".to_string(),
        "dark-pact" => "Dark Pact Leadership test".to_string(),
        "blessings-of-khorne" => "Blessings of Khorne roll".to_string(),
        other => format!("{} roll", dekebab(other)),
    }
}

pub(crate) fn attack_model(role: &str) -> Option<&'static str> {
    match role {
        "this-model" => Some("this model"),
        "this-unit" | "model-in-this-unit" => Some("a model in this unit"),
        _ => None,
    }
}

/// TS `str(subject ?? "this-unit")`.
pub(crate) fn subject_key(subject: Option<&Value>) -> String {
    match subject {
        None | Some(Value::Null) => "this-unit".to_string(),
        Some(v) => st(Some(v)),
    }
}

pub(crate) fn is_object(v: Option<&Value>) -> bool {
    // TS `typeof v === "object"` (null counts; absent does not).
    matches!(v, Some(Value::Object(_) | Value::Array(_) | Value::Null))
}

pub(crate) fn roll_clause(t: &P, f: &P) -> String {
    let roll = st(f.get("roll"));
    let noun = roll_noun(&roll);
    let subject = t.get("subject");
    let anyone = subject
        .and_then(Value::as_object)
        .is_some_and(|s| is(s, "owner", "any") && key_count(s) == 1);
    if is(t, "event", "before-roll") {
        let test = matches!(
            roll.as_str(),
            "battle-shock" | "leadership" | "desperate-escape"
        );
        if test && !anyone {
            return format!("when {} takes a {noun}", actor(subject));
        }
        let by = if !anyone && matches!(roll.as_str(), "hit" | "wound" | "damage") {
            attack_model(&subject_key(subject))
                .map(str::to_string)
                .or_else(|| is_object(subject).then(|| format!("a model in {}", actor(subject))))
        } else {
            None
        };
        return format!(
            "before {} {noun} is made{}",
            article(&noun),
            by.map(|b| format!(" for an attack made by {b}"))
                .unwrap_or_default()
        );
    }
    if is(f, "result", "success") && roll == "hit" {
        return "after scoring a hit".to_string();
    }
    if is(f, "result", "success") && roll == "wound" {
        let by = if anyone {
            String::new()
        } else {
            format!(
                " made by {}",
                attack_model(&subject_key(subject))
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("a model in {}", actor(subject)))
            )
        };
        return format!("each time an attack{by} scores a wound");
    }
    if is(f, "result", "success") && roll == "dark-pact" {
        return "each time the unit makes a Dark Pact and passes its Leadership test".to_string();
    }
    if roll == "psychic" {
        return "after a Psychic test is taken".to_string();
    }
    if roll == "blessings-of-khorne" {
        return "each time you make a Blessings of Khorne roll".to_string();
    }
    format!("after {} {noun} is made", article(&noun))
}

pub(crate) fn used_phrase(kind: &str) -> String {
    match kind {
        "dark-pact" => "makes a Dark Pact".to_string(),
        "act-of-faith" => "performs an Act of Faith".to_string(),
        "manoeuvre" => "performs an Agile Manoeuvre".to_string(),
        "ritual" => "attempts a Ritual".to_string(),
        "order" => "issues an Order".to_string(),
        "doctrine" => "selects a Combat Doctrine".to_string(),
        "contract" => "invokes its contract".to_string(),
        other => format!("uses {}", dekebab(other)),
    }
}

/// The event family's own clause, before proximity, condition and options.
pub(crate) fn event_phrase(t: &P) -> String {
    let f = obj(t.get("filter"));
    let subject = t.get("subject");
    let object = t.get("object");
    let who = actor(subject);
    let event = t.get("event").and_then(Value::as_str).unwrap_or("");
    match event {
        "battle-started" => "at the start of the battle".to_string(),
        "battle-formations-declared" => "when declaring Battle Formations".to_string(),
        "deployment-ended" => "after deployment".to_string(),
        "round-started" => "at the start of the battle round".to_string(),
        "round-ended" => "at the end of the battle round".to_string(),
        "turn-started" => "at the start of the turn".to_string(),
        "turn-ended" => "at the end of the turn".to_string(),
        "step-started" => format!(
            "at the start of the {} step",
            title_case(&st(f.get("step")))
        ),
        "selected" => {
            if nn(f, "to").is_none() {
                return format!("when {who} is selected");
            }
            if is(f, "to", "observe") {
                return format!("each time {who} is selected as an Observer unit");
            }
            if is(f, "to", "move") && f.get("move_types").is_some_and(Value::is_array) {
                return format!(
                    "when {who} is selected to {}",
                    move_kinds(f.get("move_types"))
                );
            }
            let to = if is(f, "to", "attack") {
                "shoot or fight".to_string()
            } else {
                dekebab(&st(f.get("to")))
            };
            format!("when {who} is selected to {to}")
        }
        "targets-selected" => {
            if is(f, "kind", "stratagem") {
                let target = if nn(t, "object").is_none()
                    || is(t, "object", "this-unit")
                    || is(t, "object", "this-model")
                {
                    "this model's unit".to_string()
                } else {
                    object_phrase(object)
                };
                return format!("when {target} is targeted with a Stratagem");
            }
            if is(f, "kind", "ability") && truthy(t.get("source_ability")) {
                let s = obj(t.get("source_ability"));
                let keywords = s
                    .get("keywords")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().map(|k| st(Some(k))).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                let text = format!(
                    "when {} is selected by the {} ability of a {} {keywords} unit",
                    actor(subject),
                    title_case(&st(s.get("ability_id"))),
                    st(s.get("owner"))
                );
                return collapse_trailing_unit(text);
            }
            if is(f, "kind", "charge") {
                if nn(t, "object").is_some() {
                    return format!(
                        "when {who} selects {} as a charge target",
                        object_phrase(object)
                    );
                }
                return if is_object(subject) {
                    format!(
                        "after {who} selects targets for its charge but before it makes a Charge move"
                    )
                } else {
                    "when a Charge is declared".to_string()
                };
            }
            if nn(t, "object").is_some() {
                format!("when {who} targets {}", object_phrase(object))
            } else {
                format!("when {who} selects its targets")
            }
        }
        "move-ended" => {
            if is(f, "through", "tall-terrain") {
                return format!("when {who} moves through terrain over 4\" tall");
            }
            if is(f, "through", "terrain") {
                return format!("when {who} moves through terrain");
            }
            let kinds = if f.get("move_types").is_some_and(Value::is_array) {
                move_kinds(f.get("move_types"))
            } else {
                String::new()
            };
            let enemy = is_object(subject);
            // Another unit's move is a reaction window: "each time an enemy unit ends a move".
            if enemy && kinds == "Fall Back" && nn(t, "object").is_none() {
                return format!("each time {who} Falls Back");
            }
            let tail = if nn(t, "object").is_some() {
                format!(" from {}", object_phrase(object))
            } else {
                String::new()
            };
            let k = if kinds.is_empty() {
                "a".to_string()
            } else {
                format!("{} {kinds}", article(&kinds))
            };
            if enemy {
                format!("each time {who} ends {k} move{tail}")
            } else {
                format!("when {who} ends {k} move{tail}")
            }
        }
        "set-up" => {
            let from = match st(f.get("from")).as_str() {
                "deep-strike" => "is set up by Deep Strike",
                "strategic-reserves" => "arrives from Strategic Reserves",
                "cult-ambush" => "is set up using Cult Ambush",
                "transport" => "is set up from a Transport",
                _ => "is set up",
            };
            format!("when {who} {from}")
        }
        "disembarked" => format!("when {who} disembarks from a Transport"),
        "before-roll" | "after-roll" => roll_clause(t, f),
        "damage-allocated" => {
            if nn(t, "object").is_some() && !is(t, "object", "this-unit") {
                format!("when damage is allocated to {}", object_phrase(object))
            } else {
                "when damage is allocated".to_string()
            }
        }
        "attacks-resolved" => {
            if is_object(subject) {
                if nn(t, "object").is_some() {
                    return format!(
                        "after {who} has shot and targeted {}",
                        object_phrase(object)
                    );
                }
                return format!(
                    "after {who} {}",
                    if is(f, "kind", "fight") {
                        "fights"
                    } else {
                        "shoots"
                    }
                );
            }
            format!("after {who} resolves its attacks")
        }
        "destroyed" => {
            let melee = if is(f, "attack_type", "melee") {
                " in melee"
            } else {
                ""
            };
            if nn(t, "object").is_none() || is(t, "object", "this-unit") {
                return format!("when the unit is destroyed{melee}");
            }
            if let Some(o) = object.and_then(Value::as_object) {
                if nn(o, "designated").is_some() && key_count(o) == 1 {
                    return "each time your quarry is destroyed".to_string();
                }
            }
            format!(
                "{} {} is destroyed{melee}",
                if melee.is_empty() {
                    "each time"
                } else {
                    "when"
                },
                object_phrase(object)
            )
        }
        "model-destroyed" => {
            if is(f, "timing", "before-removal") {
                return "before this model is removed from play".to_string();
            }
            if f.get("first") == Some(&Value::Bool(true)) {
                return "the first time a model in the unit is destroyed".to_string();
            }
            if is(t, "object", "this-model") {
                return "when this model is destroyed".to_string();
            }
            // A model of this unit dying: the object names the model's unit, never the whole unit's destruction.
            if is(t, "object", "model-in-this-unit")
                || is(t, "object", "this-unit")
                || nn(t, "object").is_none()
            {
                return "when a model in the unit is destroyed".to_string();
            }
            format!("when {} is destroyed", object_phrase(object))
        }
        "used" => {
            if is(f, "kind", "stratagem") {
                return "each time you use a Stratagem".to_string();
            }
            if is(f, "kind", "ability") && nn(f, "id").is_some() {
                return format!("when you use {}", title_case(&st(f.get("id"))));
            }
            if is(f, "kind", "ritual") && is(f, "result", "success") {
                return format!("each time {who} manifests a Ritual");
            }
            if is(f, "kind", "act-of-faith") {
                return if is(f, "result", "success") {
                    "after an Act of Faith is completed".to_string()
                } else {
                    "when an Act of Faith is performed".to_string()
                };
            }
            if is(f, "kind", "order") && nn(t, "object").is_some() {
                return "each time an Order is issued to the unit".to_string();
            }
            if is(f, "kind", "contract") && is(f, "result", "success") {
                return "each time you complete a Contract".to_string();
            }
            format!("each time {who} {}", used_phrase(&st(f.get("kind"))))
        }
        "state-changed" => format!("when {who} becomes {}", cap_word(&st(f.get("state")))),
        "designation-changed" => {
            if is(f, "tag", "EMPOWERED") {
                format!("each time {who} is Empowered")
            } else {
                format!("each time {who} becomes {}", st(f.get("tag")))
            }
        }
        "designation-resolved" => {
            if is(f, "tag", "OATH OF MOMENT TARGET") {
                "when you fulfil an Oath".to_string()
            } else {
                format!("when a {} designation is resolved", st(f.get("tag")))
            }
        }
        "marker-removed" => format!(
            "each time one of your {} markers is removed",
            title_case(&st(f.get("marker")))
        ),
        "objective-gained" => "when you gain control of an objective".to_string(),
        "resource-gained" => {
            if is(f, "pool", "miracle-dice") {
                return "when a Miracle die is generated".to_string();
            }
            if is(f, "pool", "cp") {
                let enemy = subject
                    .and_then(Value::as_object)
                    .is_some_and(|s| is(s, "owner", "enemy"));
                return format!(
                    "each time {} a CP",
                    if enemy {
                        "your opponent gains"
                    } else {
                        "you gain"
                    }
                );
            }
            format!("each time {} is gained", dekebab(&st(f.get("pool"))))
        }
        "resource-spent" => {
            if is(f, "pool", "flux") {
                return "each time a Flux token is spent".to_string();
            }
            if is(f, "pool", "yield-points") {
                return "each time you spend Yield points".to_string();
            }
            format!("each time {} is spent", dekebab(&st(f.get("pool"))))
        }
        _ => format!("when {}", dekebab(&st(t.get("event")))),
    }
}

/// `.replace(/\s+unit$/, " unit")`.
pub(crate) fn collapse_trailing_unit(s: String) -> String {
    if let Some(head) = s.strip_suffix("unit") {
        let trimmed = head.trim_end();
        if trimmed.len() < head.len() {
            return format!("{trimmed} unit");
        }
    }
    s
}
