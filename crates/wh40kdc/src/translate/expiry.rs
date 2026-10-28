//! Shared scope-duration wording for effect lifetimes and state expiry.
//! `resolution` describes activity during a use; `after-resolving` describes its end edge.
//! `one-use` and `permanent` add no trailing lifetime clause.

use serde_json::Value;

/// The trailing clause for an expiry ("until the start of your next Shooting phase"), or ""
/// when it adds none.
pub(crate) fn expiry_trail(duration: Option<&Value>) -> &'static str {
    match duration.and_then(Value::as_str) {
        Some("attack-sequence") => "until that unit finishes resolving its attacks",
        Some("resolution") => "when resolving this use",
        Some("after-resolving") => "after resolving this use",
        Some("while-leading") => "while this model is leading a unit",
        Some("phase") => "until the end of the phase",
        Some("turn") => "until the end of the turn",
        Some("battle") => "for the rest of the battle",
        Some("battle-round") => "until the end of the battle round",
        Some("until-next-command-phase") => "until the start of your next Command phase",
        Some("until-next-movement-phase") => "until the start of your next Movement phase",
        Some("until-next-shooting-phase") => "until the start of your next Shooting phase",
        Some("until-next-battle-round") => "until the start of the next battle round",
        Some("until-start-next-turn") => "until the start of your next turn",
        Some("until-end-of-your-next-turn") => "until the end of your next turn",
        Some("until-end-of-opponent-next-turn") => "until the end of your opponent's next turn",
        Some("until-end-of-next-turn") => "until the end of the next turn",
        Some("until-this-unit-has-shot") => "until this unit has resolved its ranged attacks",
        Some("control-lost") => "until you no longer control it",
        Some("until-end-of-your-next-fight-phase") => "until the end of your next Fight phase",
        Some("until-end-of-your-next-shooting-phase") => {
            "until the end of your next Shooting phase"
        }
        Some("until-end-of-your-next-movement-phase") => {
            "until the end of your next Movement phase"
        }
        Some("until-end-of-opponent-next-movement-phase") => {
            "until the end of your opponent's next Movement phase"
        }
        Some("until-start-of-opponent-next-command-phase") => {
            "until the start of your opponent's next Command phase"
        }
        _ => "",
    }
}
