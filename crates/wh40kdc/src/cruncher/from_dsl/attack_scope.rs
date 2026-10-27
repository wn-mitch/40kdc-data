//! Attack-scoped conditions: predicates on the attack itself (a weapon, the attack's Strength
//! against the target's Toughness) that the resolver gates per attack rather than the walker
//! evaluating them. Mirrors `isWeaponScopedCondition`, `splitAttackScoped`, `attackOperand` and
//! `attackComparison` in `tools/src/cruncher/from-dsl.ts`.

use serde_json::{json, Value};

use super::applicability::{apply_applicability, combine, condition_to_applicability, App};
use super::js::*;
use super::{walk, Out, TranslationPerspective, WalkOpts};

/// An `attack-is` naming weapons, an `attack-compare`, or the negation of one: the resolver
/// gates these per attack.
pub(super) fn is_weapon_scoped_condition(condition: &Obj) -> bool {
    if is_str(condition, "operator", "not") {
        return match condition
            .get("operands")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
        {
            Some([operand]) => operand.as_object().is_some_and(|operand| {
                operand.get("operator").is_none() && is_weapon_scoped_condition(operand)
            }),
            _ => false,
        };
    }
    if is_str(condition, "type", "attack-compare") {
        return true;
    }
    is_str(condition, "type", "attack-is")
        && object(condition.get("parameters")).is_some_and(|parameters| {
            parameters
                .get("weapons")
                .is_some_and(|value| !value.is_null())
        })
}

/// An `and` whose operands mix attack-scoped predicates with predicates on the units: the
/// attack-scoped operands as one buff gate, and the rest to evaluate. Nested `and`s flatten.
/// `None` when no operand is attack-scoped, when every operand is, or when an attack-scoped
/// operand has no gate.
pub(super) fn split_attack_scoped(
    condition: &Obj,
    perspective: TranslationPerspective,
) -> Option<(Obj, Obj)> {
    fn flatten<'a>(operands: &'a [Value], into: &mut Vec<&'a Value>) {
        for operand in operands {
            match operand.as_object().filter(|o| is_str(o, "operator", "and")) {
                Some(nested) if nested.get("operands").is_some_and(Value::is_array) => {
                    flatten(list(nested.get("operands")), into)
                }
                _ => into.push(operand),
            }
        }
    }
    if !is_str(condition, "operator", "and") {
        return None;
    }
    let mut operands = Vec::new();
    flatten(condition.get("operands")?.as_array()?, &mut operands);
    let mut applicability = Obj::new();
    let mut rest: Vec<Value> = Vec::new();
    for operand in &operands {
        match operand
            .as_object()
            .filter(|o| is_weapon_scoped_condition(o))
        {
            None => rest.push((*operand).clone()),
            Some(scoped) => match condition_to_applicability(scoped, perspective) {
                App::When(gate) => applicability = combine(&applicability, &gate),
                App::Gate | App::Context => return None,
            },
        }
    }
    if rest.is_empty() || rest.len() == operands.len() {
        return None;
    }
    let rest = match rest.as_slice() {
        [Value::Object(only)] => only.clone(),
        _ => json!({ "operator": "and", "operands": rest })
            .as_object()
            .cloned()
            .expect("an and-node is an object"),
    };
    Some((applicability, rest))
}

/// Walk `effect`, gating every buff and lever it yields on `applicability`.
pub(super) fn walk_gated(effect: &Value, applicability: &Obj, opts: &WalkOpts, out: &mut Out) {
    let mut sub = Out::default();
    walk(effect, opts, &mut sub);
    out.applied.extend(
        sub.applied
            .into_iter()
            .map(|buff| apply_applicability(buff, applicability)),
    );
    out.activatable
        .extend(sub.activatable.into_iter().map(|mut lever| {
            lever.buffs = lever
                .buffs
                .into_iter()
                .map(|buff| apply_applicability(buff, applicability))
                .collect();
            lever
        }));
    out.unsupported.extend(sub.unsupported);
}

/// A side of an attack comparison the engine supplies: the attack's S, either unit's T, or a
/// fixed value.
fn attack_operand(value: Option<&Value>) -> Option<Value> {
    let operand = value?.as_object()?;
    if operand.len() == 1 && operand.get("value").is_some_and(Value::is_number) {
        return Some(json!({ "value": operand["value"] }));
    }
    if operand
        .keys()
        .any(|key| !matches!(key.as_str(), "of" | "stat" | "reduce"))
    {
        return None;
    }
    let reduce = operand.get("reduce");
    let reduce_name = match reduce {
        None => None,
        Some(Value::String(r)) if r == "max" || r == "min" => Some(r.as_str()),
        Some(_) => return None,
    };
    let stat = operand.get("stat").and_then(Value::as_str)?;
    let supported = match operand.get("of").and_then(Value::as_str)? {
        "attacker" => {
            (stat == "S" && reduce_name.is_none()) || (stat == "T" && reduce_name != Some("min"))
        }
        "defender" => stat == "T",
        _ => false,
    };
    if !supported {
        return None;
    }
    let mut out = Obj::new();
    out.insert("of".into(), operand["of"].clone());
    out.insert("stat".into(), Value::from(stat));
    if let Some(reduce) = reduce {
        out.insert("reduce".into(), reduce.clone());
    }
    Some(Value::Object(out))
}

/// The canonical `attack-compare` parameters as a buff gate, or `None` when the engine cannot
/// evaluate them.
pub(super) fn attack_comparison(params: Option<&Obj>) -> Option<Value> {
    let params = params?;
    if params
        .keys()
        .any(|key| !matches!(key.as_str(), "left" | "comparison" | "right"))
    {
        return None;
    }
    let left = attack_operand(params.get("left"))?;
    let right = attack_operand(params.get("right"))?;
    if left.get("value").is_some() {
        return None;
    }
    let comparison = params.get("comparison").and_then(Value::as_str)?;
    if !matches!(comparison, "gt" | "gte" | "lt" | "lte" | "eq") {
        return None;
    }
    Some(json!({ "left": left, "comparison": comparison, "right": right }))
}
