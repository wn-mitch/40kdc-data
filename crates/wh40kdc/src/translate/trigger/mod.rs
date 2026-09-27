//! Humanize a reactive trigger — the Rust mirror of `tools/src/translate/trigger.ts`:
//! an event family, who acted (`subject`), what it was aimed at (`object`), which
//! one (`filter`), a spatial gate and a condition. Works on the trigger's JSON
//! form; ASCII-only, pinned across the ports by the conformance corpus like the
//! condition describer.

mod event;

use serde_json::{Map, Value};

use super::condition::{
    cap_word, describe_condition_value, is, nn, obj, range_phrase, st, truthy, P,
};
use super::dekebab;

use event::{actor_keywords, event_phrase, turn_owner};

fn operator(c: &Value) -> Option<&str> {
    c.get("operator").and_then(Value::as_str)
}

fn ctype(c: &Value) -> Option<&str> {
    c.get("type").and_then(Value::as_str)
}

fn param<'a>(c: &'a Value, k: &str) -> Option<&'a Value> {
    c.get("parameters").and_then(|p| p.get(k))
}

/// "At the start of your turn": a turn boundary narrowed only by whose turn.
fn turn_boundary(t: &P) -> Option<String> {
    let event = t.get("event").and_then(Value::as_str)?;
    if event != "turn-started" && event != "turn-ended" {
        return None;
    }
    let c = t.get("condition").filter(|c| truthy(Some(c)))?;
    if ctype(c) != Some("player-turn-is") {
        return None;
    }
    let owner = turn_owner(&st(param(c, "turn")))?;
    Some(format!(
        "at the {} of {owner} turn",
        if event == "turn-started" {
            "start"
        } else {
            "end"
        }
    ))
}

/// "At the start of your Command phase": a phase boundary narrowed only by phase and whose turn.
fn phase_boundary(t: &P) -> Option<String> {
    let event = t.get("event").and_then(Value::as_str)?;
    if event != "phase-started" && event != "phase-ended" {
        return None;
    }
    let operands: Vec<&Value> = match t.get("condition") {
        None | Some(Value::Null) => Vec::new(),
        Some(c) if operator(c) == Some("and") => c
            .get("operands")
            .and_then(Value::as_array)
            .map(|a| a.iter().collect())
            .unwrap_or_default(),
        Some(c) => vec![c],
    };
    if operands.iter().any(|c| {
        truthy(c.get("operator")) || !matches!(ctype(c), Some("phase-is" | "player-turn-is"))
    }) {
        return None;
    }
    let phase = operands
        .iter()
        .find(|c| ctype(c) == Some("phase-is"))
        .and_then(|c| param(c, "phase"));
    let turn = operands
        .iter()
        .find(|c| ctype(c) == Some("player-turn-is"))
        .and_then(|c| param(c, "turn"));
    let phase = phase.and_then(Value::as_str)?;
    if operands.len() != if turn.is_none() { 1 } else { 2 } {
        return None;
    }
    let owner = match turn {
        None => "the",
        Some(turn) => turn_owner(&st(Some(turn)))?,
    };
    Some(format!(
        "at the {} of {owner} {} phase",
        if event == "phase-started" {
            "start"
        } else {
            "end"
        },
        cap_word(phase)
    ))
}

/// A trigger condition split into a moment phrase and whatever else it says.
pub(super) struct PhaseWindow {
    pub window: String,
    pub rest: Option<Value>,
    pub phase: Option<String>,
    pub owner: Option<&'static str>,
}

/// A trigger condition's phase and whose turn, as a phrase on the moment ("during your Shooting
/// phase", "in your opponent's turn"), and whatever else the condition says. Only a plain phase-is
/// and player-turn-is (at most one each, joined by "and") make a window.
pub(super) fn phase_window(condition: &Value) -> PhaseWindow {
    let operands: Vec<&Value> = match operator(condition) {
        Some("and") => condition
            .get("operands")
            .and_then(Value::as_array)
            .map(|a| a.iter().collect())
            .unwrap_or_default(),
        _ if truthy(condition.get("operator")) => Vec::new(),
        _ => vec![condition],
    };
    let phases: Vec<usize> = (0..operands.len())
        .filter(|&i| ctype(operands[i]) == Some("phase-is"))
        .collect();
    let turns: Vec<usize> = (0..operands.len())
        .filter(|&i| ctype(operands[i]) == Some("player-turn-is"))
        .collect();
    let owner = turns
        .first()
        .and_then(|&i| turn_owner(&st(param(operands[i], "turn"))));
    let phase = phases.first().and_then(|&i| param(operands[i], "phase"));
    if phases.len() > 1
        || turns.len() > 1
        || (turns.len() == 1 && owner.is_none())
        || (phases.len() == 1 && !phase.is_some_and(Value::is_string))
        || phases.len() + turns.len() == 0
    {
        return PhaseWindow {
            window: String::new(),
            rest: Some(condition.clone()),
            phase: None,
            owner: None,
        };
    }
    let phase = phase.and_then(Value::as_str).map(str::to_string);
    let window = match &phase {
        Some(ph) => format!("during {} {} phase", owner.unwrap_or("the"), cap_word(ph)),
        None => format!("in {} turn", owner.unwrap_or("undefined")),
    };
    let others: Vec<Value> = (0..operands.len())
        .filter(|i| !phases.contains(i) && !turns.contains(i))
        .map(|i| operands[i].clone())
        .collect();
    let rest = match others.len() {
        0 => None,
        1 => others.into_iter().next(),
        _ => {
            let mut m = Map::new();
            m.insert("operator".to_string(), Value::String("and".to_string()));
            m.insert("operands".to_string(), Value::Array(others));
            Some(Value::Object(m))
        }
    };
    PhaseWindow {
        window,
        rest,
        phase,
        owner,
    }
}

/// `phase-ended` with "disembarked this turn and battle-shocked": the one boundary that reads as an if.
fn disembark_battle_shock(c: Option<&Value>) -> bool {
    let Some(c) = c else { return false };
    if operator(c) != Some("and") {
        return false;
    }
    let Some(ops) = c.get("operands").and_then(Value::as_array) else {
        return false;
    };
    if ops.len() != 2 {
        return false;
    }
    ctype(&ops[0]) == Some("happened")
        && param(&ops[0], "event").and_then(Value::as_str) == Some("disembarked")
        && ctype(&ops[1]) == Some("unit-state")
        && param(&ops[1], "state").and_then(Value::as_str) == Some("battle-shocked")
}

/// Reactive trigger → front-of-sentence lead clause ("an enemy unit ends a move within 9\" of this model").
pub fn describe_trigger_value(trigger: &Value) -> String {
    let t = obj(Some(trigger));
    let event = t.get("event").and_then(Value::as_str);
    let clock = matches!(event, Some("phase-started" | "phase-ended"));
    let optional = truthy(t.get("optional"));
    let plain = !truthy(t.get("proximity"))
        && !truthy(t.get("binds_die_variable"))
        && !truthy(t.get("binds_selected_die_variable"))
        && (nn(t, "subject").is_none() || is(t, "subject", "this-unit"));
    if plain {
        if let Some(boundary) = phase_boundary(t).or_else(|| turn_boundary(t)) {
            return if optional {
                format!("{boundary}, you may use this ability")
            } else {
                boundary
            };
        }
    }
    let edge = match event {
        Some("phase-started") => Some("start"),
        Some("phase-ended") => Some("end"),
        _ => None,
    };
    let condition = t.get("condition").filter(|c| truthy(Some(c)));
    let disembark_shock = event == Some("phase-ended") && disembark_battle_shock(condition);
    let split = match condition {
        Some(c) if !disembark_shock => Some(phase_window(c)),
        _ => None,
    };
    let mut s = if !clock {
        event_phrase(t)
    } else {
        let edge = edge.unwrap_or("");
        match split
            .as_ref()
            .and_then(|w| w.phase.as_ref().map(|p| (p, w.owner)))
        {
            Some((phase, owner)) => format!(
                "at the {edge} of {} {} phase",
                owner.unwrap_or("the"),
                cap_word(phase)
            ),
            None => format!("at the {edge} of each phase"),
        }
    };
    s.push_str(&actor_keywords(t.get("subject")));
    let f = obj(t.get("filter"));
    if let Some(by) = nn(f, "by") {
        let source = if by.as_str() == Some("this-model") {
            "this model"
        } else {
            "this unit"
        };
        let kind = if truthy(f.get("attack_type")) && event != Some("destroyed") {
            format!("{} ", st(f.get("attack_type")))
        } else {
            String::new()
        };
        let weapon = if truthy(f.get("weapon_keyword")) {
            format!(
                " with [{}] weapons",
                st(f.get("weapon_keyword")).to_uppercase()
            )
        } else {
            String::new()
        };
        if !kind.is_empty() || !weapon.is_empty() {
            s.push_str(&format!(" by {kind}attacks made by {source}{weapon}"));
        } else {
            s.push_str(&format!(" by {source}"));
        }
    }
    let proximity = obj(t.get("proximity"));
    if let Some(range) = nn(proximity, "range") {
        let of = if is(proximity, "of", "this-model") {
            "this model"
        } else {
            "this unit"
        };
        s.push_str(&format!(" within {} of {of}", range_phrase(Some(range))));
    }
    if disembark_shock {
        s.push_str(", if the unit disembarked from a Transport this turn and is Battle-shocked");
    } else if let Some(split) = &split {
        if edge.is_some() && split.phase.is_none() && split.owner.is_some() {
            s.push_str(&format!(" in {} turn", split.owner.unwrap_or_default()));
        } else if edge.is_none() && !split.window.is_empty() {
            s.push_str(&format!(" {}", split.window));
        }
        if let Some(rest) = &split.rest {
            s.push_str(&format!(", if {}", describe_condition_value(rest)));
        }
    }
    if let Some(v) = t.get("binds_die_variable").filter(|v| truthy(Some(v))) {
        s.push_str(&format!(
            " (binding the generated die as {})",
            dekebab(&st(Some(v)).replace('_', "-"))
        ));
    }
    if let Some(v) = t
        .get("binds_selected_die_variable")
        .filter(|v| truthy(Some(v)))
    {
        s.push_str(&format!(
            " (binding one chosen die used in that Act of Faith as {})",
            dekebab(&st(Some(v)).replace('_', "-"))
        ));
    }
    if optional {
        s.push_str(", you may use this ability");
    }
    s
}
