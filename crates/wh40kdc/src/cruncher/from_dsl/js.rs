//! JS semantics for reading an effect's JSON form the way the TS translator does:
//! `Number(v)`, `String(v)`, number formatting, and object access.

use serde_json::{Map, Value};

pub(super) type Obj = Map<String, Value>;

/// TS `isObject(v)`: a non-array, non-null object.
pub(super) fn object(v: Option<&Value>) -> Option<&Obj> {
    v.and_then(Value::as_object)
}

/// TS `o.key != null`: the present, non-null value.
pub(super) fn present<'a>(o: &'a Obj, key: &str) -> Option<&'a Value> {
    o.get(key).filter(|v| !v.is_null())
}

/// TS `o.key === s`.
pub(super) fn is_str(o: &Obj, key: &str, s: &str) -> bool {
    o.get(key).and_then(Value::as_str) == Some(s)
}

/// TS `o.key === true`.
pub(super) fn is_true(o: &Obj, key: &str) -> bool {
    o.get(key) == Some(&Value::Bool(true))
}

/// JS `Number(s)` for a string: trimmed, empty is 0, unparsable is NaN.
fn number_of_str(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if t.contains(|c: char| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// JS `Number(v)`; `None` is `undefined` (NaN).
pub(super) fn js_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => number_of_str(s),
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [one] => number_of_str(&js_string(Some(one))),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// JS number → string (`6`, `-1`, `0.5`).
pub(super) fn fmt_num(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        // `-0` prints as `0` in JS.
        return format!("{}", n as i128);
    }
    format!("{n}")
}

/// JS `String(v)`; `None` is `undefined`.
pub(super) fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => fmt_num(n.as_f64().unwrap_or(f64::NAN)),
        },
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| match x {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// TS `(v as unknown[]) ?? []`: the array's items, or none.
pub(super) fn list(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// TS `Number.isFinite(Number(v))`, returning the number.
pub(super) fn finite(v: Option<&Value>) -> Option<f64> {
    Some(js_number(v)).filter(|n| n.is_finite())
}
