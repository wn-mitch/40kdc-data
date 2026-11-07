//! Schema validation with the closed cross-implementation error-code enum.
//!
//! A hand-rolled JSON Schema draft-2020-12 *subset* validator over the embedded
//! [`crate::VALIDATION_SCHEMA`] document — every entity schema lives under its
//! `$defs`, and bundling rewrote all `$ref`s to local `#/$defs/...` pointers, so
//! no cross-file resolution is needed. Every keyword that document uses is
//! either evaluated here or listed as unenforced (`format`); a test fails on
//! any other. Maps validation failures
//! onto the closed `(path, code)` enum pinned by `conformance/validator`
//! (`REQUIRED_MISSING`, `TYPE_MISMATCH`, `ENUM_VIOLATION`, `PATTERN_MISMATCH`,
//! `RANGE_VIOLATION`, `ADDITIONAL_PROPERTY`, `UNIQUE_VIOLATION`). Wording is the
//! implementation's prerogative — only the codes cross the wire.
//!
//! Rust mirror of `python/src/wh40kdc/validator.py` (the closed-enum mapping)
//! and the Go `validator.go`. `pattern` is matched with ASCII-only classes
//! (`\d` is `[0-9]`), as AJV and Go's RE2 match it; `format` is treated as
//! always-valid, as Go and Python's jsonschema treat it.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use regex::{Regex, RegexBuilder};

use serde_json::Value;

/// Compile a schema `pattern` once per process. ASCII mode keeps `\d`, `\w` and
/// `\s` to their ASCII meaning; a pattern that only compiles with Unicode
/// semantics (one whose `.` could match a partial character) falls back to them.
fn pattern(source: &str) -> Option<Regex> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Regex>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    cache
        .entry(source.to_string())
        .or_insert_with(|| {
            RegexBuilder::new(source)
                .unicode(false)
                .build()
                .or_else(|_| Regex::new(source))
                .ok()
        })
        .clone()
}

/// The wire validator targets — each is a key under the bundled schema's
/// `$defs`.
pub const VALIDATOR_TARGETS: &[&str] = &[
    "unit",
    "weapon",
    "faction",
    "ability",
    "wargear",
    "wargear-option",
    "stratagem",
];

fn keyword_to_code(keyword: &str) -> Option<&'static str> {
    Some(match keyword {
        "required" => "REQUIRED_MISSING",
        "type" => "TYPE_MISMATCH",
        "enum" | "const" => "ENUM_VIOLATION",
        "pattern" | "format" => "PATTERN_MISMATCH",
        "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum" | "minLength"
        | "maxLength" | "minItems" | "maxItems" => "RANGE_VIOLATION",
        "additionalProperties" => "ADDITIONAL_PROPERTY",
        "uniqueItems" => "UNIQUE_VIOLATION",
        _ => return None,
    })
}

fn bundled() -> &'static Value {
    static ROOT: OnceLock<Value> = OnceLock::new();
    ROOT.get_or_init(|| {
        serde_json::from_str(crate::VALIDATION_SCHEMA).expect("validation schema is valid JSON")
    })
}

/// True when `target` is a known wire target present in the bundled schema.
pub fn has_target(target: &str) -> bool {
    VALIDATOR_TARGETS.contains(&target) && !bundled()["$defs"][target].is_null()
}

struct Violation {
    path: String,
    keyword: &'static str,
}

/// Validate `value` against the named wire target, returning the deduplicated
/// closed-enum `(path, code)` errors as JSON objects.
pub fn validate_target(target: &str, value: &Value) -> Vec<Value> {
    let root = bundled();
    let schema = &root["$defs"][target];
    let mut vs: Vec<Violation> = Vec::new();
    check(root, schema, value, "", &mut vs);

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<Value> = Vec::new();
    for v in vs {
        let Some(code) = keyword_to_code(v.keyword) else {
            continue;
        };
        let key = format!("{}|{}", v.path, code);
        if seen.insert(key) {
            out.push(serde_json::json!({ "path": v.path, "code": code }));
        }
    }
    out
}

fn resolve_ref<'a>(root: &'a Value, reference: &str) -> Option<&'a Value> {
    // Local pointer only: "#/$defs/entity-id" -> "/$defs/entity-id".
    let pointer = reference.strip_prefix('#').unwrap_or(reference);
    if pointer.is_empty() {
        return Some(root);
    }
    root.pointer(pointer)
}

fn is_valid(root: &Value, schema: &Value, instance: &Value) -> bool {
    let mut vs = Vec::new();
    check(root, schema, instance, "", &mut vs);
    vs.is_empty()
}

fn push(out: &mut Vec<Violation>, path: &str, keyword: &'static str) {
    out.push(Violation {
        path: path.to_string(),
        keyword,
    });
}

fn check(root: &Value, schema: &Value, instance: &Value, path: &str, out: &mut Vec<Violation>) {
    match schema {
        Value::Bool(false) => push(out, path, "false"),
        Value::Bool(true) => {}
        Value::Object(s) => check_object(root, s, instance, path, out),
        _ => {}
    }
}

fn check_object(
    root: &Value,
    schema: &serde_json::Map<String, Value>,
    instance: &Value,
    path: &str,
    out: &mut Vec<Violation>,
) {
    if let Some(Value::String(r)) = schema.get("$ref") {
        if let Some(target) = resolve_ref(root, r) {
            check(root, target, instance, path, out);
        }
    }

    if let Some(t) = schema.get("type") {
        if !type_matches_any(t, instance) {
            push(out, path, "type");
        }
    }
    if let Some(Value::Array(enum_)) = schema.get("enum") {
        if !enum_.iter().any(|e| e == instance) {
            push(out, path, "enum");
        }
    }
    if let Some(c) = schema.get("const") {
        if c != instance {
            push(out, path, "const");
        }
    }

    match instance {
        Value::Object(inst) => {
            if let Some(Value::Array(req)) = schema.get("required") {
                for r in req {
                    if let Some(name) = r.as_str() {
                        if !inst.contains_key(name) {
                            push(out, &format!("{}/{}", path, escape_token(name)), "required");
                        }
                    }
                }
            }
            if let Some(mp) = schema.get("minProperties").and_then(Value::as_u64) {
                if (inst.len() as u64) < mp {
                    push(out, path, "minProperties");
                }
            }
            if let Some(mp) = schema.get("maxProperties").and_then(Value::as_u64) {
                if (inst.len() as u64) > mp {
                    push(out, path, "maxProperties");
                }
            }
            if let Some(Value::Object(dr)) = schema.get("dependentRequired") {
                for (trigger, req) in dr {
                    if !inst.contains_key(trigger) {
                        continue;
                    }
                    for name in req
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        if !inst.contains_key(name) {
                            push(out, path, "dependentRequired");
                        }
                    }
                }
            }
            let props = schema.get("properties").and_then(Value::as_object);
            for (k, val) in inst {
                if let Some(sub) = props.and_then(|p| p.get(k)) {
                    check(
                        root,
                        sub,
                        val,
                        &format!("{}/{}", path, escape_token(k)),
                        out,
                    );
                }
            }
            if let Some(ap) = schema.get("additionalProperties") {
                for (k, val) in inst {
                    if props.map(|p| p.contains_key(k)).unwrap_or(false) {
                        continue;
                    }
                    match ap {
                        Value::Bool(false) => push(
                            out,
                            &format!("{}/{}", path, escape_token(k)),
                            "additionalProperties",
                        ),
                        Value::Object(_) | Value::Bool(true) => {
                            check(root, ap, val, &format!("{}/{}", path, escape_token(k)), out)
                        }
                        _ => {}
                    }
                }
            }
        }
        Value::Array(arr) => {
            let prefix = schema.get("prefixItems").and_then(Value::as_array);
            for (i, e) in arr.iter().enumerate() {
                if let Some(p) = prefix.and_then(|p| p.get(i)) {
                    check(root, p, e, &format!("{}/{}", path, i), out);
                } else if let Some(items) = schema.get("items") {
                    check(root, items, e, &format!("{}/{}", path, i), out);
                }
            }
            if let Some(mi) = schema.get("minItems").and_then(Value::as_u64) {
                if (arr.len() as u64) < mi {
                    push(out, path, "minItems");
                }
            }
            if let Some(ma) = schema.get("maxItems").and_then(Value::as_u64) {
                if (arr.len() as u64) > ma {
                    push(out, path, "maxItems");
                }
            }
            if let Some(contains) = schema.get("contains") {
                let matches = arr.iter().filter(|e| is_valid(root, contains, e)).count() as u64;
                let min = schema
                    .get("minContains")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                if matches < min {
                    push(out, path, "contains");
                }
                if let Some(max) = schema.get("maxContains").and_then(Value::as_u64) {
                    if matches > max {
                        push(out, path, "maxContains");
                    }
                }
            }
            if schema.get("uniqueItems").and_then(Value::as_bool) == Some(true)
                && has_duplicate(arr)
            {
                push(out, path, "uniqueItems");
            }
        }
        Value::String(s) => {
            let len = s.chars().count() as u64;
            if let Some(ml) = schema.get("minLength").and_then(Value::as_u64) {
                if len < ml {
                    push(out, path, "minLength");
                }
            }
            if let Some(ml) = schema.get("maxLength").and_then(Value::as_u64) {
                if len > ml {
                    push(out, path, "maxLength");
                }
            }
            if let Some(Value::String(p)) = schema.get("pattern") {
                if pattern(p).is_some_and(|re| !re.is_match(s)) {
                    push(out, path, "pattern");
                }
            }
            // format intentionally treated as always-valid.
        }
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(f64::NAN);
            if let Some(m) = schema.get("minimum").and_then(Value::as_f64) {
                if x < m {
                    push(out, path, "minimum");
                }
            }
            if let Some(m) = schema.get("maximum").and_then(Value::as_f64) {
                if x > m {
                    push(out, path, "maximum");
                }
            }
            if let Some(m) = schema.get("exclusiveMinimum").and_then(Value::as_f64) {
                if x <= m {
                    push(out, path, "exclusiveMinimum");
                }
            }
            if let Some(m) = schema.get("exclusiveMaximum").and_then(Value::as_f64) {
                if x >= m {
                    push(out, path, "exclusiveMaximum");
                }
            }
        }
        _ => {}
    }

    if let Some(Value::Array(all_of)) = schema.get("allOf") {
        for sub in all_of {
            check(root, sub, instance, path, out);
        }
    }
    if let Some(Value::Array(one_of)) = schema.get("oneOf") {
        let valid_count = one_of
            .iter()
            .filter(|s| is_valid(root, s, instance))
            .count();
        if valid_count == 0 {
            for sub in one_of {
                check(root, sub, instance, path, out);
            }
        } else if valid_count > 1 {
            // More than one matching branch fails oneOf; the keyword maps to no code.
            push(out, path, "oneOf");
        }
    }
    if let Some(not) = schema.get("not") {
        if is_valid(root, not, instance) {
            push(out, path, "not");
        }
    }
    // if/then/else: the taken branch's own errors are reported (as AJV and jsonschema do).
    if let Some(cond) = schema.get("if") {
        let branch = if is_valid(root, cond, instance) {
            schema.get("then")
        } else {
            schema.get("else")
        };
        if let Some(branch) = branch {
            check(root, branch, instance, path, out);
        }
    }
    if let Some(Value::Array(any_of)) = schema.get("anyOf") {
        if !any_of.iter().any(|s| is_valid(root, s, instance)) {
            for sub in any_of {
                check(root, sub, instance, path, out);
            }
        }
    }
}

fn type_matches_any(t: &Value, instance: &Value) -> bool {
    match t {
        Value::String(s) => type_matches(s, instance),
        Value::Array(arr) => arr.iter().any(|e| {
            e.as_str()
                .map(|s| type_matches(s, instance))
                .unwrap_or(false)
        }),
        _ => true,
    }
}

fn type_matches(t: &str, instance: &Value) -> bool {
    match t {
        "object" => instance.is_object(),
        "array" => instance.is_array(),
        "string" => instance.is_string(),
        "boolean" => instance.is_boolean(),
        "null" => instance.is_null(),
        "number" => instance.is_number(),
        "integer" => match instance {
            Value::Number(n) => {
                n.is_i64() || n.is_u64() || n.as_f64().map(|f| f.fract() == 0.0).unwrap_or(false)
            }
            _ => false,
        },
        _ => false,
    }
}

fn escape_token(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

fn has_duplicate(arr: &[Value]) -> bool {
    let mut seen: HashSet<String> = HashSet::new();
    for e in arr {
        let key = serde_json::to_string(e).unwrap_or_default();
        if !seen.insert(key) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Keywords `check_object` evaluates.
    const EVALUATED: &[&str] = &[
        "$ref",
        "type",
        "enum",
        "const",
        "required",
        "properties",
        "additionalProperties",
        "minProperties",
        "maxProperties",
        "dependentRequired",
        "prefixItems",
        "items",
        "minItems",
        "maxItems",
        "contains",
        "minContains",
        "maxContains",
        "uniqueItems",
        "pattern",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "allOf",
        "oneOf",
        "anyOf",
        "not",
        "if",
        "then",
        "else",
    ];
    /// Assertion keywords the schemas use that this validator does not evaluate.
    const UNENFORCED_KEYWORDS: &[&str] = &["format"];
    /// Keywords that assert nothing.
    const ANNOTATIONS: &[&str] = &[
        "$schema",
        "$id",
        "$defs",
        "$comment",
        "title",
        "description",
        "default",
        "examples",
        "deprecated",
    ];

    fn audit(schema: &Value, at: &str, unknown: &mut Vec<String>) {
        let Value::Object(s) = schema else { return };
        for (k, v) in s {
            let here = format!("{at}/{k}");
            if !EVALUATED.contains(&k.as_str())
                && !ANNOTATIONS.contains(&k.as_str())
                && !UNENFORCED_KEYWORDS.contains(&k.as_str())
            {
                unknown.push(here.clone());
            }
            match (k.as_str(), v) {
                ("properties" | "$defs", Value::Object(m)) => {
                    for (name, sub) in m {
                        audit(sub, &format!("{here}/{name}"), unknown);
                    }
                }
                ("allOf" | "anyOf" | "oneOf" | "prefixItems", Value::Array(a)) => {
                    for (i, sub) in a.iter().enumerate() {
                        audit(sub, &format!("{here}/{i}"), unknown);
                    }
                }
                (
                    "items" | "additionalProperties" | "contains" | "not" | "if" | "then" | "else",
                    _,
                ) => audit(v, &here, unknown),
                _ => {}
            }
        }
    }

    /// A schema keyword this validator neither evaluates nor lists as unenforced
    /// would be silently ignored, so data it rejects would validate here.
    #[test]
    fn every_schema_keyword_is_evaluated_or_listed() {
        let mut unknown = Vec::new();
        audit(bundled(), "#", &mut unknown);
        assert!(
            unknown.is_empty(),
            "unsupported schema keywords: {unknown:?}"
        );
    }

    /// A pattern that fails to compile would be skipped, so every schema pattern must compile.
    #[test]
    fn every_schema_pattern_compiles() {
        fn walk(n: &Value, bad: &mut Vec<String>) {
            match n {
                Value::Object(m) => {
                    if let Some(Value::String(p)) = m.get("pattern") {
                        if pattern(p).is_none() {
                            bad.push(p.clone());
                        }
                    }
                    m.values().for_each(|v| walk(v, bad));
                }
                Value::Array(a) => a.iter().for_each(|v| walk(v, bad)),
                _ => {}
            }
        }
        let mut bad = Vec::new();
        walk(bundled(), &mut bad);
        assert!(bad.is_empty(), "uncompilable patterns: {bad:?}");
    }

    /// `\d` is ASCII, as in AJV and Go: an Arabic-Indic digit is not a digit.
    #[test]
    fn pattern_digits_are_ascii() {
        let re = pattern(r"^\d{1,2}(th)?$").expect("compiles");
        assert!(re.is_match("11th"));
        assert!(!re.is_match("\u{0661}\u{0661}th"));
    }

    /// The validation schema carries the conditionals the codegen bundle strips.
    #[test]
    fn validation_schema_keeps_conditionals() {
        assert!(crate::VALIDATION_SCHEMA.contains("\"if\""));
        assert!(!crate::BUNDLED_SCHEMA.contains("\"if\""));
    }
}
