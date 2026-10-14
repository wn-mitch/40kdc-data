//! The one expiry vocabulary (scope.duration, ability-part.duration, designate.clears_on, the
//! designation containers) as the trailing clause that says when an effect ends. Mirrors
//! `tools/src/translate/expiry.ts`. `one-use` and `permanent` add no trail.

use serde_json::Value;

/// The trailing clause for an expiry ("until the start of your next Shooting phase"), or ""
/// when it adds none.
pub(crate) fn expiry_trail(duration: Option<&Value>) -> &'static str {
    match duration.and_then(Value::as_str) {
        Some("attack-sequence") => "until that unit finishes resolving its attacks",
        Some("resolution") => "when resolving this use",
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
        Some("until-this-unit-has-shot") => "until this unit has resolved its ranged attacks",
        Some("control-lost") => "until you no longer control it",
        _ => "",
    }
}
