//! JS semantics for reading an effect's JSON form the way the TS oracle does: `jstr` is the
//! template stringification, `num` is `Number(v)`, and the word-boundary helpers stand in for
//! the regexes the TS describer uses.

use serde_json::Value;

use crate::translate::condition::{js_num, st, P};

// ── JS semantics ────────────────────────────────────────────────────────────

/// JS-template stringification (numbers print without trailing `.0`; nullish is `?`).
pub(crate) fn jstr(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => "?".to_string(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| jstr(Some(x)))
            .collect::<Vec<_>>()
            .join(", "),
        Some(v) => st(Some(v)),
    }
}

/// `jstr` over a present value.
pub(crate) fn jv(v: &Value) -> String {
    jstr(Some(v))
}

/// JS `Number(s)` for a string (trimmed; empty is 0; anything unparsable is NaN).
pub(super) fn number_of_str(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    if t == "Infinity" || t == "+Infinity" {
        return f64::INFINITY;
    }
    if t == "-Infinity" {
        return f64::NEG_INFINITY;
    }
    if t.contains(|c: char| c.is_ascii_alphabetic() && c != 'e' && c != 'E') {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// JS `Number(v)`.
pub(crate) fn num(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => number_of_str(s),
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [one] => number_of_str(&jv(one)),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// JS `Number(jstr(v))`.
pub(crate) fn num_of_jstr(v: Option<&Value>) -> f64 {
    number_of_str(&jstr(v))
}

/// JS `String(n)` for a number.
pub(crate) fn fnum(f: f64) -> String {
    if f.is_nan() {
        return "NaN".to_string();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    match serde_json::Number::from_f64(f) {
        Some(n) => js_num(&n),
        None => f.to_string(),
    }
}

/// TS `m.key === true`.
pub(crate) fn is_true(m: &P, k: &str) -> bool {
    m.get(k) == Some(&Value::Bool(true))
}

/// TS `m.key === false`.
pub(crate) fn is_false(m: &P, k: &str) -> bool {
    m.get(k) == Some(&Value::Bool(false))
}

/// TS `m.key === n` for a number.
pub(crate) fn is_num(m: &P, k: &str, n: f64) -> bool {
    m.get(k).and_then(Value::as_f64) == Some(n)
}

/// TS `m.key` as a present string.
pub(crate) fn sv<'a>(m: &'a P, k: &str) -> Option<&'a str> {
    m.get(k).and_then(Value::as_str)
}

/// TS `Array.isArray(m.key) ? m.key : None`.
pub(crate) fn arr<'a>(m: &'a P, k: &str) -> Option<&'a Vec<Value>> {
    m.get(k).and_then(Value::as_array)
}

/// `(m.key as unknown[]).map(f)` over an array value.
pub(crate) fn map_arr(m: &P, k: &str, f: impl Fn(&Value) -> String) -> Option<Vec<String>> {
    arr(m, k).map(|a| a.iter().map(f).collect())
}

/// TS `m.key` truthiness.
pub(crate) fn truthy_key(m: &P, k: &str) -> bool {
    crate::translate::condition::truthy(m.get(k))
}

/// `re.test(s)` for ` <word>\b` — the pattern followed by a non-word character or the end.
pub(crate) fn has_word_end(s: &str, pat: &str) -> bool {
    find_word_end(s, pat, 0).is_some()
}

/// `/\b<word>\b/.test(s)`.
pub(crate) fn has_word(s: &str, word: &str) -> bool {
    let mut start = 0;
    while let Some(at) = find_word_end(s, word, start) {
        if !s[..at].chars().next_back().is_some_and(is_word_char) {
            return true;
        }
        start = at + 1;
    }
    false
}

pub(super) fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

pub(super) fn find_word_end(s: &str, pat: &str, from: usize) -> Option<usize> {
    let mut start = from;
    while let Some(i) = s[start..].find(pat) {
        let at = start + i;
        let end = at + pat.len();
        if !s[end..].chars().next().is_some_and(is_word_char) {
            return Some(at);
        }
        start = at + 1;
    }
    None
}

/// `s.replace(/<pat>\b/, repl)` — the first `pat` that ends at a word boundary. A leading
/// `\b` is honoured when `left_boundary` is set.
pub(crate) fn replace_word_first(s: &str, pat: &str, repl: &str, left_boundary: bool) -> String {
    let mut start = 0;
    while let Some(at) = find_word_end(s, pat, start) {
        let left_ok = !left_boundary || !s[..at].chars().next_back().is_some_and(is_word_char);
        if left_ok {
            return format!("{}{repl}{}", &s[..at], &s[at + pat.len()..]);
        }
        start = at + 1;
    }
    s.to_string()
}

/// `s.replace(/^all /, "")`.
pub(crate) fn strip_all(s: &str) -> String {
    s.strip_prefix("all ").unwrap_or(s).to_string()
}
