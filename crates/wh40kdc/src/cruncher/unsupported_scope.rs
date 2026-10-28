//! Whether an unsupported fragment of an ability could change the attack being crunched. The
//! Rust mirror of `tools/src/cruncher/unsupported-scope.ts`.
//!
//! The buff layer reports every fragment it cannot turn into a buff; most of those (movement,
//! deployment, objectives, tests, resources) have no damage content at all, and some act through
//! events outside the attack (deaths, mortal wounds, healing). Only an `unresolved` fragment is a
//! gap in what the engine scores.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// - `OutOfScope`: no damage content for this attack (a move, a charge re-roll, Scouts, an
///   Objective Control change, or a defender-side stat seen from the attacker);
/// - `EncounterLayer`: acts outside the attack, through deaths, mortal wounds, healing,
///   designations, or a moment after the unit's own attacks;
/// - `Unresolved`: could change the attack's damage, but the engine cannot evaluate it.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnsupportedScope {
    OutOfScope,
    EncounterLayer,
    Unresolved,
}

impl UnsupportedScope {
    fn rank(self) -> u8 {
        match self {
            UnsupportedScope::OutOfScope => 0,
            UnsupportedScope::EncounterLayer => 1,
            UnsupportedScope::Unresolved => 2,
        }
    }
}

/// The more consequential of two scopes.
pub fn wider_scope(a: UnsupportedScope, b: UnsupportedScope) -> UnsupportedScope {
    if a.rank() >= b.rank() {
        a
    } else {
        b
    }
}

/// Rolls the hit/wound/save/damage math reads.
const DAMAGE_ROLLS: &[&str] = &["hit", "wound", "save", "damage"];
/// Characteristics the hit/wound/save/damage math reads.
const DAMAGE_STATS: &[&str] = &["A", "S", "T", "Sv", "AP", "D", "WS", "BS"];

/// Leaf effect types that change no attack's damage: healing, moving, placement, eligibility
/// permissions, how many times a stance may be selected, list-building rules, unit keywords,
/// tests, tags, resources, unit composition, and mortal wounds or the extra fight of a dying
/// model (attack sequences of their own, which the attack-buff layer does not model by design).
/// A type not reviewed stays a gap.
const NON_DAMAGE_EFFECT_TYPES: &[&str] = &[
    "heal",
    "move",
    "mortal-wounds",
    "set-up",
    "permission",
    "cost-modifier",
    "stance-selection-capacity",
    "move-modifier",
    "army-rule",
    "keyword-grant",
    "act-on-death",
    "cp-gain",
    "resource-gain",
    "add-unit",
    "split-unit",
    "transport-capacity",
    "destroy-models",
    "designate",
    "test",
    "targeting",
    "state-change",
    "no-effect",
    "oath-modifier",
    "objective-sticky",
    "counts-as",
    "marker",
    "test-exemption",
    "return-models",
];

/// Of the non-damage leaf types, those that act through events outside the attack.
const ENCOUNTER_EFFECT_TYPES: &[&str] = &[
    "mortal-wounds",
    "act-on-death",
    "designate",
    "heal",
    "destroy-models",
    "return-models",
];

/// Core abilities (and Reanimation Protocols) that decide deployment, movement, fight order,
/// attachment or resurrection; none changes a hit, wound, save or damage roll.
const NON_DAMAGE_ABILITIES: &[&str] = &[
    "deadly-demise",
    "deep-strike",
    "fights-first",
    "hover",
    "infiltrators",
    "leader",
    "lone-operative",
    "scouts",
    "support",
    "super-heavy-walker",
    "mobile",
    "reanimation-protocols",
];

/// Of those, the ones that act on a death or bring models back.
const ENCOUNTER_ABILITIES: &[&str] = &["deadly-demise", "reanimation-protocols"];

const OUTSIDE_DAMAGE_PATH: &str = "\" is outside the damage path";

/// A condition the context cannot decide; its scope is the scope of what it gates.
const UNDECIDED_CONDITION: &str = "conditional: cannot evaluate condition ";

/// Whether `reason` is the translator's undecided-condition reason.
pub(crate) fn is_undecided_condition(reason: &str) -> bool {
    reason.starts_with(UNDECIDED_CONDITION)
}

/// `^stat-modifier on ".*" is outside the damage path$` (and the roll-modifier form).
fn quoted_label_outside_damage_path(reason: &str, prefix: &str) -> bool {
    reason
        .strip_prefix(prefix)
        .is_some_and(|rest| rest.ends_with(OUTSIDE_DAMAGE_PATH) && !reason.contains('\n'))
}

/// `^re-roll on ".*" \(subset ".*"\) is outside the damage path$`.
fn reroll_outside_damage_path(reason: &str) -> bool {
    reason
        .strip_prefix("re-roll on \"")
        .and_then(|rest| rest.strip_suffix("\") is outside the damage path"))
        .is_some_and(|core| core.contains("\" (subset \"") && !reason.contains('\n'))
}

fn modifier_of(effect: &Map<String, Value>) -> Map<String, Value> {
    effect
        .get("modifier")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn ability_scope(id: Option<&Value>) -> UnsupportedScope {
    match id.and_then(Value::as_str) {
        Some(id) if NON_DAMAGE_ABILITIES.contains(&id) => {
            if ENCOUNTER_ABILITIES.contains(&id) {
                UnsupportedScope::EncounterLayer
            } else {
                UnsupportedScope::OutOfScope
            }
        }
        _ => UnsupportedScope::Unresolved,
    }
}

fn widest<'a>(children: impl IntoIterator<Item = Option<&'a Value>>) -> UnsupportedScope {
    children
        .into_iter()
        .fold(UnsupportedScope::OutOfScope, |scope, child| {
            wider_scope(scope, effect_scope(child))
        })
}

/// The scope of an effect subtree: the widest scope among its leaves. A container the buff layer
/// stops at (a selection with a predicate, a dice gate, a dice table) hides a damage effect only
/// when one of its leaves has one. Any leaf or container not recognised here is `Unresolved`,
/// the conservative default. `None` is an absent node (`undefined`), `Some(Null)` a `null` one.
pub fn effect_scope(node: Option<&Value>) -> UnsupportedScope {
    use UnsupportedScope::*;
    let node = match node {
        Some(Value::Null) => return OutOfScope,
        Some(Value::Object(effect)) => effect,
        _ => return Unresolved,
    };
    let modifier = modifier_of(node);
    let in_set = |set: &[&str], key: &str| {
        modifier
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| set.contains(&value))
    };
    let is_string = |key: &str| modifier.get(key).is_some_and(Value::is_string);
    let ty = node.get("type").and_then(Value::as_str);
    match ty {
        Some("sequence" | "rules-bundle") => match node.get("steps").and_then(Value::as_array) {
            Some(steps) => widest(steps.iter().map(Some)),
            None => Unresolved,
        },
        Some("conditional") => match node.get("else") {
            None => widest([node.get("effect")]),
            Some(other) => widest([node.get("effect"), Some(other)]),
        },
        Some("select-units" | "for-each-unit" | "ability-part") => effect_scope(node.get("effect")),
        Some("dice-gated") => widest([
            Some(node.get("on_success").unwrap_or(&Value::Null)),
            Some(node.get("on_fail").unwrap_or(&Value::Null)),
        ]),
        Some("dice-table") => match node.get("outcomes").and_then(Value::as_array) {
            Some(outcomes) => widest(outcomes.iter().map(|outcome| {
                Some(
                    outcome
                        .get("effect")
                        .filter(|effect| !effect.is_null())
                        .unwrap_or(&Value::Null),
                )
            })),
            None => Unresolved,
        },
        Some("roll-result" | "roll-modifier" | "re-roll") => {
            if is_string("roll") && !in_set(DAMAGE_ROLLS, "roll") {
                OutOfScope
            } else {
                Unresolved
            }
        }
        Some("stat-modifier") => {
            if is_string("stat") && !in_set(DAMAGE_STATS, "stat") {
                OutOfScope
            } else {
                Unresolved
            }
        }
        // A printed grant is judged by the body it carries.
        Some("ability-grant") => match modifier.get("definition") {
            Some(definition) => effect_scope(Some(definition)),
            None => ability_scope(modifier.get("ability")),
        },
        Some("ability-activate") => ability_scope(modifier.get("ability")),
        Some("rule-state") => {
            if modifier.get("rule_kind").and_then(Value::as_str) == Some("ability") {
                ability_scope(modifier.get("rule"))
            } else if modifier.get("rule_kind").and_then(Value::as_str) == Some("core-rule")
                && modifier.get("rule").and_then(Value::as_str) == Some("attacking-ends-hidden")
            {
                OutOfScope
            } else {
                Unresolved
            }
        }
        // An aura's range only decides which units are in it, and the cruncher's range gates are
        // permissive; a use count never changes an attack.
        Some("ability-modifier") => {
            if in_set(&["uses", "range"], "aspect") {
                OutOfScope
            } else {
                Unresolved
            }
        }
        Some(ty) if NON_DAMAGE_EFFECT_TYPES.contains(&ty) => {
            if ENCOUNTER_EFFECT_TYPES.contains(&ty) {
                EncounterLayer
            } else {
                OutOfScope
            }
        }
        _ => Unresolved,
    }
}

/// Whether the translator's "outside the damage path" label holds. It is trusted only for a stat
/// or roll that is itself off the damage path: a damage stat the translator cannot place is a
/// gap, not an exemption. `None` when the reason is not one of those labels.
fn labelled_outside_damage_path(reason: &str, fragment: &Value) -> Option<bool> {
    let modifier = fragment.get("modifier");
    let off_path = |key: &str, set: &[&str]| {
        !modifier
            .and_then(|m| m.get(key))
            .and_then(Value::as_str)
            .is_some_and(|value| set.contains(&value))
    };
    if quoted_label_outside_damage_path(reason, "stat-modifier on \"") {
        return Some(off_path("stat", DAMAGE_STATS));
    }
    if quoted_label_outside_damage_path(reason, "roll-modifier on \"")
        || reroll_outside_damage_path(reason)
    {
        return Some(off_path("roll", DAMAGE_ROLLS));
    }
    None
}

/// The scope of one unsupported fragment from its reason and effect fragment.
/// `post_attack_moment` is the translator's reason for a moment after the unit's own attacks. An
/// undecided condition is classified by the caller, which can translate its body; here it is
/// `Unresolved`.
pub fn fragment_scope(
    reason: &str,
    fragment: &Value,
    post_attack_moment: &str,
) -> UnsupportedScope {
    use UnsupportedScope::*;
    if let Some(labelled) = labelled_outside_damage_path(reason, fragment) {
        return if labelled { OutOfScope } else { Unresolved };
    }
    if reason == post_attack_moment {
        return EncounterLayer;
    }
    if reason.starts_with("select-objective: ")
        // A defender stat seen from the attacker; the target perspective models it.
        || reason.ends_with(": defender-side stat; applies when the buffed unit is the target")
        // An attached model's own effect reaches that model, never the unit being crunched.
        || reason.starts_with("model-scoped effect from an attached model")
    {
        return OutOfScope;
    }
    if is_undecided_condition(reason) {
        return Unresolved;
    }
    effect_scope(Some(fragment))
}
