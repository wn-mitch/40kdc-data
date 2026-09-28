//! Single effects on the characteristic, roll, ability and permission axes, as one
//! lowercase-initial clause with no period. The board axes (protection, models, moves,
//! placement, tests, resources, designation, army) are in `leaf_board.rs`. Mirrors
//! `tools/src/translate/effect-leaf.ts`.

use serde_json::Value;

use super::leaf_ability::*;
use super::leaf_board::describe_board_leaf;
use super::words::*;
use crate::translate::condition::{and_list, nn, obj, P};

/// Every single-effect type; anything else is a container.
pub(crate) const LEAF_TYPES: &[&str] = &[
    "stat-modifier",
    "ignore-modifiers",
    "roll-modifier",
    "re-roll",
    "roll-result",
    "end-attack-sequence",
    "ability-grant",
    "keyword-grant",
    "weapon-ability-grant",
    "weapon-grant",
    "ability-modifier",
    "ability-activate",
    "permission",
    "targeting",
    "counts-as",
    "rule-state",
    "mortal-wounds",
    "damage-reduction",
    "feel-no-pain",
    "invulnerable-save",
    "heal",
    "return-models",
    "destroy-models",
    "act-on-death",
    "split-unit",
    "add-unit",
    "destruction-rule",
    "move",
    "move-modifier",
    "set-up",
    "marker",
    "transport-capacity",
    "test",
    "state-change",
    "cp-gain",
    "cost-modifier",
    "resource-gain",
    "resource-spend",
    "resource-die",
    "objective-sticky",
    "designate",
    "army-rule",
];

/// "each time an attack targets the unit, " — the lead of an `incoming` change.
pub(crate) fn incoming_lead(m: &P, subj: &str) -> String {
    let attack = match nn(m, "weapon_type") {
        Some(t) => format!("a {} attack", jv(t)),
        None => "an attack".to_string(),
    };
    format!("each time {attack} targets {subj}, ")
}

/// A stat change as a verb phrase over `what` ("add 1 to the unit's Toughness characteristic").
fn stat_change(m: &P, what: &str) -> String {
    let op = jstr(m.get("operation"));
    match op.as_str() {
        "set" => return format!("set {what} to {}", dice_case(m.get("value"))),
        "halve" => return format!("halve {what}"),
        "multiply" => return format!("multiply {what} by {}", dice_case(m.get("value"))),
        "improve" | "worsen" => return format!("{op} {what} by {}", dice_case(m.get("value"))),
        _ => {}
    }
    let mut verb = if op == "subtract" { "subtract" } else { "add" };
    let n = num(m.get("value"));
    let val = if !n.is_nan() && n < 0.0 {
        verb = if verb == "add" { "subtract" } else { "add" };
        fnum(n.abs())
    } else {
        dice_case(m.get("value"))
    };
    let prep = if verb == "add" { "to" } else { "from" };
    format!("{verb} {val} {prep} {what}")
}

fn bounds(m: &P) -> String {
    let min = nn(m, "minimum")
        .map(|v| format!(" (to a minimum of {})", jv(v)))
        .unwrap_or_default();
    let max = nn(m, "maximum")
        .map(|v| format!(" (to a maximum of {})", jv(v)))
        .unwrap_or_default();
    min + &max
}

fn stat_modifier(target: Option<&Value>, m: &P, subj: &str, ctx: &Ctx) -> String {
    // AP is printed negative; the DSL stores its magnitude.
    let mut owned;
    let mut m = m;
    if sv(m, "stat") == Some("AP")
        && sv(m, "operation") == Some("set")
        && m.get("value")
            .and_then(Value::as_f64)
            .is_some_and(|v| v > 0.0)
    {
        owned = m.clone();
        owned.insert(
            "value".into(),
            Value::String(format!("-{}", jstr(m.get("value")))),
        );
        m = &owned;
    }
    let stat = format!("{} characteristic", stat_name(m.get("stat")));
    if is_true(m, "incoming") {
        return format!(
            "{}{}{}",
            incoming_lead(m, subj),
            stat_change(m, &format!("the {stat} of that attack")),
            bounds(m)
        );
    }
    if has_weapon(m) {
        let what = format!(
            "the {stat} of {} equipped by {}",
            weapon_noun(m),
            weapon_holder(target, ctx)
        );
        return format!("{}{}", stat_change(m, &what), bounds(m));
    }
    format!(
        "{}{}",
        stat_change(m, &of_or_possessive(subj, &stat)),
        bounds(m)
    )
}

fn ignore_modifiers(m: &P, subj: &str) -> String {
    let kind = match sv(m, "only") {
        Some("worsening") => "negative ",
        Some("improving") => "positive ",
        _ => "",
    };
    let things = if sv(m, "what") == Some("rolls") {
        match arr(m, "rolls") {
            Some(rolls)
                if !rolls
                    .iter()
                    .any(|r| r.as_str() == Some("all") || r.as_str() == Some("any")) =>
            {
                let names: Vec<String> = rolls.iter().map(|r| roll_name(Some(r))).collect();
                format!("{} rolls", and_list(&names))
            }
            _ => "rolls".to_string(),
        }
    } else {
        match map_arr(m, "stats", |s| stat_name(Some(s))) {
            Some(names) => format!("{} characteristics", and_list(&names)),
            None => "characteristics".to_string(),
        }
    };
    if is_true(m, "incoming") {
        return format!(
            "{}ignore any {kind}modifiers to that attack's {things}",
            incoming_lead(m, subj)
        );
    }
    format!(
        "{subj} {} any {kind}modifiers to {} {things}{}",
        v(subj, "ignores"),
        pronoun(subj),
        weapon_roll_scope(m)
    )
}

fn roll_modifier(m: &P, subj: &str) -> String {
    let value = (sv(m, "value_from") == Some("previous-roll")).then_some("the result of that roll");
    let cap = nn(m, "cap")
        .map(|c| format!(" (to a maximum of {})", signed(m.get("operation"), Some(c))))
        .unwrap_or_default();
    let rolls = format!("{} rolls", roll_name(m.get("roll")));
    let subtract = sv(m, "operation") == Some("subtract");
    let (verb, prep) = if subtract {
        ("subtract", "from")
    } else {
        ("add", "to")
    };
    if is_true(m, "incoming") {
        let change = match value {
            Some(value) => format!("{verb} {value} {prep}"),
            None => format!("apply {} to", signed(m.get("operation"), m.get("value"))),
        };
        return format!(
            "{}{change} the {} roll{cap}",
            incoming_lead(m, subj),
            roll_name(m.get("roll"))
        );
    }
    if let Some(value) = value {
        return format!(
            "{verb} {value} {prep} {}{}{cap}",
            of_or_possessive(subj, &rolls),
            weapon_roll_scope(m)
        );
    }
    format!(
        "{subj} {} {} to {rolls}{}{cap}",
        v(subj, "gets"),
        signed(m.get("operation"), m.get("value")),
        weapon_roll_scope(m)
    )
}

fn re_roll(target: Option<&Value>, m: &P, subj: &str, ctx: &Ctx) -> String {
    let rn = jstr(m.get("roll"));
    let any = rn == "any";
    let noun = if any {
        "roll".to_string()
    } else {
        format!("{} roll", roll_name(m.get("roll")))
    };
    let cnt = m.get("count").filter(|c| c.is_number());
    let failed = if sv(m, "subset") == Some("all-failures") {
        "failed "
    } else {
        ""
    };
    let ones = sv(m, "subset") == Some("ones");
    let which = match cnt {
        Some(c) => {
            let one = c.as_f64() == Some(1.0);
            format!(
                "{} {failed}{noun}{}{}",
                if one {
                    "one".to_string()
                } else {
                    format!("up to {}", jv(c))
                },
                if one { "" } else { "s" },
                if ones { " of 1" } else { "" }
            )
        }
        None if ones => format!("{} {noun} of 1", if any { "any" } else { "a" }),
        None if sv(m, "subset") == Some("all-failures") => format!("a failed {noun}"),
        None if any => "any roll".to_string(),
        None => format!("the {noun}"),
    };
    let pool = nn(m, "pool")
        .map(|p| format!(" by spending a die from your {}", title_case(&jv(p))))
        .unwrap_or_default();
    if is_true(m, "incoming") {
        return format!(
            "{}the attacking player can re-roll {which}{pool}",
            incoming_lead(m, subj)
        );
    }
    // "you can re-roll …" names whose roll it is unless that is the ability's own unit.
    let t = target.and_then(Value::as_str);
    let own = target.map_or(true, Value::is_null)
        || t == Some("this-unit")
        || t == Some("attacker")
        || (t == Some("recipient") && !ctx.aura_recipient);
    let model = t == Some("this-model") || (t == Some("selected-unit") && ctx.selected_model);
    let holder = if model {
        weapon_holder(target, ctx)
    } else {
        subj.to_string()
    };
    let owner = if own {
        String::new()
    } else {
        let attacks = if ["hit", "wound", "damage"].contains(&rn.as_str()) {
            "attacks made by "
        } else {
            ""
        };
        format!(" for {attacks}{holder}")
    };
    format!(
        "you can re-roll {which}{owner}{}{pool}",
        weapon_roll_scope(m)
    )
}

fn roll_result(m: &P, subj: &str) -> String {
    let roll = roll_name(m.get("roll"));
    let lead = if is_true(m, "incoming") {
        incoming_lead(m, subj)
    } else {
        String::new()
    };
    let led = !lead.is_empty();
    let scope = weapon_roll_scope(m);
    if let Some(crit_on) = nn(m, "critical_on") {
        let crit = if sv(m, "roll") == Some("wound") {
            "Critical Wound"
        } else {
            "Critical Hit"
        };
        if crit_on.as_str() == Some("success") {
            let made_by = if led {
                String::new()
            } else {
                format!(" made by {subj}")
            };
            return format!("{lead}each successful {roll} roll{made_by}{scope} is a {crit}");
        }
        let who = if led {
            "a".to_string()
        } else {
            format!("{subj} {}", v(subj, "scores"))
        };
        return format!(
            "{lead}{who} {crit}{} on {roll} rolls of {}+{scope}{}",
            if led { "" } else { "s" },
            jv(crit_on),
            if led { " for that attack" } else { "" }
        );
    }
    if let Some(on) = nn(m, "succeeds_on") {
        let rolls = if led {
            format!("the {roll} roll for that attack")
        } else {
            of_or_possessive(subj, &format!("{roll} rolls"))
        };
        return format!(
            "{lead}{rolls}{} {} only on an unmodified {}+",
            if led { "" } else { scope.as_str() },
            if led { "succeeds" } else { "succeed" },
            jv(on)
        );
    }
    let r = jstr(m.get("roll"));
    let tests = ["battle-shock", "leadership", "desperate-escape"].contains(&r.as_str());
    let result = sv(m, "result");
    if tests && !led {
        if result == Some("pass") {
            return format!("{subj} automatically {} {roll} tests", v(subj, "passes"));
        }
        if result == Some("fail") {
            return format!("{subj} automatically {} {roll} tests", v(subj, "fails"));
        }
    }
    let whose = if led {
        format!("the {roll} roll for that attack")
    } else {
        of_or_possessive(subj, &format!("{roll} rolls"))
    };
    if result == Some("pass") || result == Some("fail") {
        let pass = result == Some("pass");
        let verb = match (led, pass) {
            (true, true) => "automatically succeeds",
            (true, false) => "automatically fails",
            (false, true) => "automatically succeed",
            (false, false) => "automatically fail",
        };
        return format!(
            "{lead}{whose}{} {verb}",
            if led { "" } else { scope.as_str() }
        );
    }
    let counts = if led {
        " counts".to_string()
    } else {
        format!("{scope} count")
    };
    format!("{lead}{whose}{counts} as {}", jstr(m.get("result")))
}

/// One single effect as a lowercase-initial clause.
pub(crate) fn describe_leaf(e: &P, ctx: &Ctx) -> String {
    let m = obj(e.get("modifier"));
    let target = e.get("target");
    let subj = effect_subject(target, ctx);
    let subj = subj.as_str();
    match sv(e, "type").unwrap_or("") {
        "stat-modifier" => stat_modifier(target, m, subj, ctx),
        "ignore-modifiers" => ignore_modifiers(m, subj),
        "roll-modifier" => roll_modifier(m, subj),
        "re-roll" => re_roll(target, m, subj, ctx),
        "roll-result" => roll_result(m, subj),
        "end-attack-sequence" => "the attack sequence ends".to_string(),
        "ability-grant" => ability_grant(m, subj),
        "keyword-grant" => keyword_grant(m, subj),
        "weapon-ability-grant" => weapon_ability_grant(target, m, subj, ctx),
        "weapon-grant" => {
            let n = num(Some(
                m.get("count")
                    .filter(|c| !c.is_null())
                    .unwrap_or(&Value::from(1)),
            ));
            let count = if n.is_nan() || n == 0.0 { 1.0 } else { n };
            format!(
                "{subj} {} {} {} weapon{}",
                v(subj, "gains"),
                fnum(count),
                weapon_label(m.get("weapon_id")),
                if count == 1.0 { "" } else { "s" }
            )
        }
        "ability-modifier" => ability_modifier(m, subj, ctx),
        "ability-activate" => {
            let label = ability_label(m.get("ability"));
            match nn(m, "option") {
                None => format!("{subj} {} the {label} ability now", v(subj, "resolves")),
                Some(opt) => format!(
                    "the {} option of {label} is active for {subj}{}",
                    title_case(&jv(opt)),
                    if is_true(m, "exclusive") {
                        " (and no other option is)"
                    } else {
                        ""
                    }
                ),
            }
        }
        "permission" => permission(m, subj, ctx),
        "targeting" => targeting(m, subj, ctx),
        "counts-as" => counts_as(m, subj, ctx),
        "rule-state" => rule_state(m, subj),
        _ => describe_board_leaf(e, m, subj, ctx),
    }
}
