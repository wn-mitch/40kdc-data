//! JS-semantics helpers the condition and trigger describers share: TS
//! nullish/truthy checks, `String(v)` formatting, list joins, and accessors
//! over a condition node's JSON form.

use std::sync::OnceLock;

use serde_json::{Map, Value};

pub(crate) type P = Map<String, Value>;

// ── JS-semantics helpers ────────────────────────────────────────────────────

pub(crate) fn empty() -> &'static P {
    static EMPTY: OnceLock<P> = OnceLock::new();
    EMPTY.get_or_init(Map::new)
}

/// TS `p.key != null` → the present, non-null value.
pub(crate) fn nn<'a>(p: &'a P, k: &str) -> Option<&'a Value> {
    p.get(k).filter(|v| !v.is_null())
}

/// TS `(v ?? {}) as P`: the object, or an empty map for anything else.
pub(crate) fn obj(v: Option<&Value>) -> &P {
    v.and_then(Value::as_object).unwrap_or_else(|| empty())
}

/// TS `p.key === "s"`.
pub(crate) fn is(p: &P, k: &str, s: &str) -> bool {
    p.get(k).and_then(Value::as_str) == Some(s)
}

/// TS truthiness of a value.
pub(crate) fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS number → string (`6`, `6.5`).
pub(crate) fn js_num(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(0.0);
    if f.fract() == 0.0 && f.is_finite() && f.abs() < 9e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

/// JS `String(v)` inside an array join (`null` → empty).
pub(crate) fn js_join_elem(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        other => js_string(other),
    }
}

/// JS `String(v)` for a present value.
pub(crate) fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::String(s) => s.clone(),
        Value::Number(n) => js_num(n),
        Value::Bool(b) => b.to_string(),
        Value::Array(a) => a.iter().map(js_join_elem).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// TS `str(v)`: `?` when nullish, the string itself, else `String(v)`.
pub(crate) fn st(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => "?".to_string(),
        Some(v) => js_string(v),
    }
}

/// TS `Array.isArray(v) ? v.map(str) : None`.
pub(crate) fn strs(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().map(|x| st(Some(x))).collect())
}

/// `s.replace(/^an? /, "")`.
pub(crate) fn strip_article(s: &str) -> String {
    s.strip_prefix("an ")
        .or_else(|| s.strip_prefix("a "))
        .unwrap_or(s)
        .to_string()
}

/// `/^[aeiou]/i.test(s) ? "an" : "a"`.
pub(crate) fn article(s: &str) -> &'static str {
    match s.as_bytes().first() {
        Some(b) if b"aeiouAEIOU".contains(b) => "an",
        _ => "a",
    }
}

pub(crate) fn or_list(items: &[String]) -> String {
    match items.len() {
        0 => String::new(),
        1 => items[0].clone(),
        2 => format!("{} or {}", items[0], items[1]),
        n => format!("{} or {}", items[..n - 1].join(", "), items[n - 1]),
    }
}

pub(crate) fn and_list(items: &[String]) -> String {
    match items.len() {
        0 => String::new(),
        1 => items[0].clone(),
        2 => format!("{} and {}", items[0], items[1]),
        n => format!("{} and {}", items[..n - 1].join(", "), items[n - 1]),
    }
}

/// Capitalize the first character and lowercase the rest (`MONSTER` -> `Monster`).
pub(crate) fn cap_word(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

/// The node's `operator` string, if any.
pub(crate) fn operator(c: &Value) -> Option<&str> {
    c.get("operator").and_then(Value::as_str)
}

/// TS `c.operator` truthiness.
pub(crate) fn has_operator(c: &Value) -> bool {
    truthy(c.get("operator"))
}

pub(crate) fn operands(c: &Value) -> Option<&Vec<Value>> {
    c.get("operands").and_then(Value::as_array)
}

pub(crate) fn ctype(c: &Value) -> Option<&str> {
    c.get("type").and_then(Value::as_str)
}

pub(crate) fn params(c: &Value) -> &P {
    obj(c.get("parameters"))
}
