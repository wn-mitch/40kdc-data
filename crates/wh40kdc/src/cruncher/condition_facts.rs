//! Declared answers for leaf conditions the engine cannot evaluate from its context.
//!
//! A leaf condition the context does not decide ("while an enemy unit is engaged with this unit",
//! "if this unit disembarked this turn") evaluates to unknown. The translator reports each such
//! leaf as a [`ConditionNeed`]; the caller answers it in
//! [`EngineContext::condition_facts`](super::EngineContext::condition_facts) under the need's
//! `key`, and the leaf then evaluates to that answer. A compound (`and`/`or`/`not`) is never a
//! need itself: it evaluates from its leaves. Mirrors `tools/src/cruncher/condition-facts.ts`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

use super::from_dsl::TranslationPerspective;

/// One leaf condition the context cannot decide, with the key its declared answer goes under.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConditionNeed {
    /// [`condition_fact_key`] of the leaf: the key `condition_facts` reads.
    pub key: String,
    /// The leaf condition as authored.
    pub condition: Map<String, Value>,
    /// The perspective the leaf was evaluated from; its unit references are relative to it.
    pub perspective: TranslationPerspective,
}

/// JSON with object keys sorted at every depth and no whitespace, so equal conditions serialize
/// to equal text in every port. Keys sort by UTF-16 code unit, as JS compares strings; strings
/// and numbers print as `JSON.stringify` prints them.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => write_canonical_object(map, out),
        Value::String(s) => out.push_str(&json_string(s)),
        Value::Number(n) => out.push_str(&js_number(n)),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Null => out.push_str("null"),
    }
}

/// `JSON.stringify` of a string: serde_json escapes the same set (`"`, `\`, and control
/// characters, with `\b\f\n\r\t` short forms and lower-case `\u00xx` otherwise) and leaves
/// non-ASCII text unescaped.
fn json_string(s: &str) -> String {
    serde_json::to_string(s).expect("a string always serializes")
}

/// JS `Number.prototype.toString` (what `JSON.stringify` prints) for a JSON number.
fn js_number(n: &Number) -> String {
    // Integers JS holds exactly print as their digits.
    const MAX_SAFE: u64 = (1 << 53) - 1;
    if let Some(i) = n.as_i64() {
        if i.unsigned_abs() <= MAX_SAFE {
            return i.to_string();
        }
    } else if let Some(u) = n.as_u64() {
        if u <= MAX_SAFE {
            return u.to_string();
        }
    }
    js_float(n.as_f64().unwrap_or(f64::NAN))
}

/// ECMAScript Number::toString(10) for a finite double: the shortest round-tripping digits,
/// in plain notation for decimal exponents in [-6, 21) and exponent notation otherwise.
fn js_float(f: f64) -> String {
    if !f.is_finite() {
        // JSON.stringify prints non-finite numbers as null; JSON input never holds them.
        return "null".to_string();
    }
    if f == 0.0 {
        return "0".to_string();
    }
    // `{:e}` prints the shortest round-tripping digits as `d.ddde±x`.
    let sci = format!("{:e}", f.abs());
    let (mantissa, exponent) = sci.split_once('e').expect("LowerExp prints an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent
        .parse()
        .expect("LowerExp prints an integer exponent");
    let k = digits.len() as i32;
    let n = exponent + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let tail = if k > 1 {
            format!(".{}", &digits[1..])
        } else {
            String::new()
        };
        format!("{}{tail}e{sign}{}", &digits[..1], (n - 1).abs())
    };
    if f < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// The key a leaf condition's declared answer goes under: the perspective, then the leaf's
/// canonical JSON. Unit references such as `this-unit` name a different unit from each
/// perspective, so the perspective is part of the key.
pub fn condition_fact_key(
    condition: &Map<String, Value>,
    perspective: TranslationPerspective,
) -> String {
    let side = match perspective {
        TranslationPerspective::Attacker => "attacker",
        TranslationPerspective::Target => "target",
    };
    let mut out = format!("{side}:");
    write_canonical_object(condition, &mut out);
    out
}

fn write_canonical_object(map: &Map<String, Value>, out: &mut String) {
    let mut entries: Vec<(&String, &Value)> = map.iter().collect();
    entries.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
    out.push('{');
    for (i, (key, item)) in entries.into_iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&json_string(key));
        out.push(':');
        write_canonical(item, out);
    }
    out.push('}');
}

/// The leaves of `condition` that leave it undecided, deduplicated by key in first-seen order.
/// `evaluate` is the engine's evaluator (`None` is unknown); a compound recurses into each
/// operand that evaluates unknown, so an `and` already decided by a false operand contributes
/// nothing.
pub fn condition_needs(
    condition: &Map<String, Value>,
    perspective: TranslationPerspective,
    evaluate: impl Fn(&Map<String, Value>) -> Option<bool>,
) -> Vec<ConditionNeed> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    visit(condition, perspective, &evaluate, &mut seen, &mut out);
    out
}

fn visit(
    node: &Map<String, Value>,
    perspective: TranslationPerspective,
    evaluate: &impl Fn(&Map<String, Value>) -> Option<bool>,
    seen: &mut HashSet<String>,
    out: &mut Vec<ConditionNeed>,
) {
    if evaluate(node).is_some() {
        return;
    }
    if let (Some(Value::String(_)), Some(Value::Array(operands))) =
        (node.get("operator"), node.get("operands"))
    {
        for operand in operands.iter().filter_map(Value::as_object) {
            visit(operand, perspective, evaluate, seen, out);
        }
        return;
    }
    let key = condition_fact_key(node, perspective);
    if seen.insert(key.clone()) {
        out.push(ConditionNeed {
            key,
            condition: node.clone(),
            perspective,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_keys_at_every_depth_without_whitespace() {
        let value = json!({"b": [{"z": 1, "a": null}], "a": {"y": true, "x": "’"}});
        assert_eq!(
            canonical_json(&value),
            r#"{"a":{"x":"’","y":true},"b":[{"a":null,"z":1}]}"#
        );
    }

    #[test]
    fn keys_sort_by_utf16_code_unit_not_code_point() {
        // U+FF5E is one code unit 0xFF5E; U+1F600 is the surrogate pair 0xD83D 0xDE00, which JS
        // sorts first although its code point is larger.
        let value = json!({"\u{FF5E}": 1, "\u{1F600}": 2});
        assert_eq!(canonical_json(&value), "{\"\u{1F600}\":2,\"\u{FF5E}\":1}");
    }

    #[test]
    fn numbers_print_as_js_prints_them() {
        let cases = [
            (json!(6), "6"),
            (json!(-1), "-1"),
            (json!(6.0), "6"),
            (json!(0.5), "0.5"),
            (json!(-0.0), "0"),
            (json!(1e21), "1e+21"),
            (json!(1.5e-7), "1.5e-7"),
            (json!(0.000001), "0.000001"),
            (json!(123456789012345680000.0), "123456789012345680000"),
            (json!(9007199254740993_u64), "9007199254740992"),
        ];
        for (value, want) in cases {
            assert_eq!(canonical_json(&value), want, "{value}");
        }
    }

    #[test]
    fn strings_escape_as_json_stringify_does() {
        assert_eq!(
            canonical_json(&json!("a\"b\\c\n\u{1}")),
            r#""a\"b\\c\n\u0001""#
        );
    }

    #[test]
    fn needs_skip_decided_operands_and_dedupe_leaves() {
        let leaf = json!({"type": "unit-state", "parameters": {"state": "engaged"}});
        let decided = json!({"type": "phase-is", "parameters": {"phase": "fight"}});
        let condition = json!({"operator": "and", "operands": [leaf, decided, leaf]});
        let evaluate = |node: &Map<String, Value>| match node.get("type").and_then(Value::as_str) {
            Some("phase-is") => Some(true),
            _ => None,
        };
        let needs = condition_needs(
            condition.as_object().unwrap(),
            TranslationPerspective::Target,
            evaluate,
        );
        assert_eq!(needs.len(), 1);
        assert_eq!(
            needs[0].key,
            r#"target:{"parameters":{"state":"engaged"},"type":"unit-state"}"#
        );
    }

    #[test]
    fn a_decided_condition_has_no_needs() {
        let condition = json!({"operator": "or", "operands": [{"type": "x"}]});
        let needs = condition_needs(
            condition.as_object().unwrap(),
            TranslationPerspective::Attacker,
            |_| Some(false),
        );
        assert!(needs.is_empty());
    }
}
