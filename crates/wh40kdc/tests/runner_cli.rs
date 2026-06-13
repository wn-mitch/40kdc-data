//! End-to-end test for the `wh40kdc-runner` binary: NDJSON in on stdin,
//! NDJSON out on stdout, clean exit on shutdown. Mirrors
//! `tools/test/runner-cli.test.ts` plus the dispatcher cases that the TS side
//! covers in `tools/test/runner.test.ts` (Rust's bin target can't be
//! unit-tested in-process from integration tests, so dispatcher behavior is
//! exercised through the subprocess too).

#![cfg(feature = "cruncher")]

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const RUNNER_BIN: &str = env!("CARGO_BIN_EXE_wh40kdc-runner");

fn spec_version() -> i64 {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/SPEC_VERSION");
    let s = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("reading {}: {e}", p.display()));
    s.trim().parse().expect("SPEC_VERSION integer")
}

/// Spawn the runner, feed it the given requests as NDJSON, append a shutdown,
/// and return the parsed responses in order. Fails the test if the runner
/// exits non-zero or emits any non-JSON line.
fn drive(requests: &[Value]) -> Vec<Value> {
    let mut child = Command::new(RUNNER_BIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn runner");
    {
        let mut stdin = child.stdin.take().expect("runner stdin");
        for req in requests {
            writeln!(stdin, "{req}").expect("write request");
        }
        writeln!(stdin, "{}", json!({"op": "shutdown"})).expect("write shutdown");
    }
    let out = child.wait_with_output().expect("wait for runner");
    assert!(
        out.status.success(),
        "runner exited {:?}; stderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );
    let stdout = String::from_utf8(out.stdout).expect("runner stdout is utf-8");
    stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("non-JSON line {l:?}: {e}")))
        .collect()
}

/// Drive a single sequence, asserting the `init` response is ok and returning
/// the slice of post-init responses (drops the trailing shutdown response).
fn drive_post_init(requests: Vec<Value>) -> Vec<Value> {
    let v = spec_version();
    let mut full = vec![
        json!({"op": "init", "args": {"spec_version": v, "locale": "C", "tz": "UTC", "seed": 0}}),
    ];
    full.extend(requests);
    let responses = drive(&full);
    assert!(
        responses[0]["ok"].as_bool() == Some(true),
        "init failed: {}",
        responses[0]
    );
    // Drop init at front and shutdown at back.
    responses[1..responses.len() - 1].to_vec()
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

#[test]
fn init_must_come_first() {
    let responses = drive(&[json!({"op": "normalize", "args": {"input": "X"}})]);
    assert_eq!(responses[0]["error_kind"], "INVALID_INPUT");
}

#[test]
fn init_accepts_current_spec_version() {
    let v = spec_version();
    let responses = drive(&[json!({
        "op": "init",
        "args": {"spec_version": v, "locale": "C", "tz": "UTC", "seed": 0}
    })]);
    assert_eq!(responses[0]["ok"], true);
    assert_eq!(responses[0]["value"]["impl"], "rust");
    assert_eq!(responses[0]["value"]["spec_version"], v);
}

#[test]
fn init_rejects_spec_version_mismatch() {
    let v = spec_version();
    let responses = drive(&[json!({
        "op": "init",
        "args": {"spec_version": v + 99, "locale": "C", "tz": "UTC", "seed": 0}
    })]);
    assert_eq!(responses[0]["ok"], false);
    assert_eq!(responses[0]["error_kind"], "INVALID_INPUT");
}

#[test]
fn init_rejects_non_c_locale() {
    let v = spec_version();
    let responses = drive(&[json!({
        "op": "init",
        "args": {"spec_version": v, "locale": "tr_TR", "tz": "UTC", "seed": 0}
    })]);
    assert_eq!(responses[0]["error_kind"], "INVALID_INPUT");
}

#[test]
fn unknown_op_returns_unknown_op() {
    let responses = drive_post_init(vec![json!({"op": "made-up-op"})]);
    assert_eq!(responses[0]["error_kind"], "UNKNOWN_OP");
}

#[test]
fn version_op_reports_impl_identity() {
    let responses = drive_post_init(vec![json!({"op": "version"})]);
    assert_eq!(responses[0]["value"]["impl"], "rust");
    assert_eq!(responses[0]["value"]["spec_version"], spec_version());
}

// ---------------------------------------------------------------------------
// Ops dispatch
// ---------------------------------------------------------------------------

#[test]
fn normalize_matches_library_function() {
    let responses = drive_post_init(vec![
        json!({"op": "normalize", "args": {"input": "Khârn the Betrayer"}}),
        json!({"op": "normalize", "args": {"input": "Khorne Lord"}}),
    ]);
    assert_eq!(responses[0]["value"], "kharn the betrayer");
    assert_eq!(responses[1]["value"], "khorne lord");
}

#[test]
fn linked_query_find_unit_resolves_diacritics() {
    let responses = drive_post_init(vec![json!({
        "op": "linked_query",
        "args": {"query": "find_unit", "input": {"query": "Kharn"}}
    })]);
    assert_eq!(responses[0]["value"], "kharn-the-betrayer");
}

#[test]
fn linked_query_abilities_of_returns_ordered_ids() {
    let responses = drive_post_init(vec![json!({
        "op": "linked_query",
        "args": {"query": "abilities_of", "input": {"unitId": "kharn-the-betrayer"}}
    })]);
    let abilities = responses[0]["value"].as_array().expect("array");
    // Must contain the four canonical abilities; order pinned by data file.
    assert_eq!(
        abilities
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "berzerker-frenzy",
            "leader",
            "legendary-killer",
            "the-betrayer"
        ],
    );
}

#[test]
fn linked_query_unknown_unit_returns_unknown_entity() {
    let responses = drive_post_init(vec![json!({
        "op": "linked_query",
        "args": {"query": "abilities_of", "input": {"unitId": "not-a-unit"}}
    })]);
    assert_eq!(responses[0]["error_kind"], "UNKNOWN_ENTITY");
}

#[test]
fn validate_emits_closed_enum_errors() {
    // A wargear item missing its required `name` reports the closed-enum code;
    // a complete one validates clean.
    let responses = drive_post_init(vec![
        json!({
            "op": "validate",
            "args": {"target": "wargear", "value": {"id": "icon-of-khorne"}}
        }),
        json!({
            "op": "validate",
            "args": {"target": "wargear", "value": {
                "id": "icon-of-khorne",
                "name": "Icon of Khorne",
                "category": "icon",
                "game_version": {"edition": "10th", "dataslate": "2025-q3"}
            }}
        }),
    ]);
    assert_eq!(responses[0]["ok"], true);
    let errs = responses[0]["value"].as_array().expect("errors array");
    assert!(
        errs.iter()
            .any(|e| e["path"] == "/name" && e["code"] == "REQUIRED_MISSING"),
        "expected a REQUIRED_MISSING at /name, got {errs:?}"
    );
    assert_eq!(responses[1]["ok"], true);
    assert_eq!(responses[1]["value"], json!([]));
}

#[test]
fn crunch_returns_seven_canonical_stages() {
    let responses = drive_post_init(vec![json!({
        "op": "crunch",
        "args": {
            "attacker": {"weaponId": "bolt-rifle", "profileIndex": 0},
            "modelsFiring": 5,
            "target": {"unitId": "intercessor-squad", "profileIndex": 0},
            "context": {"phase": "shooting", "attackerStationary": false, "withinHalfRange": false},
            "buffs": []
        }
    })]);
    assert_eq!(responses[0]["ok"], true);
    let stages = responses[0]["value"]["stages"]
        .as_array()
        .expect("stages array");
    assert_eq!(stages.len(), 7);
    assert_eq!(stages[0]["name"], "attacks");
    // Canonical wire shape: name + expected only (no detail).
    assert!(
        stages[0].get("detail").is_none(),
        "detail must not appear on the wire"
    );
}

#[test]
fn attribution_returns_per_stage_decomposition() {
    let responses = drive_post_init(vec![json!({
        "op": "attribution",
        "args": {
            "attacker": {"weaponId": "bolt-rifle", "profileIndex": 0},
            "modelsFiring": 5,
            "target": {"unitId": "intercessor-squad", "profileIndex": 0},
            "context": {"phase": "shooting", "attackerStationary": false, "withinHalfRange": false},
            "buffs": []
        }
    })]);
    assert_eq!(responses[0]["ok"], true);
    let stages = responses[0]["value"].as_array().expect("stages array");
    assert_eq!(stages.len(), 7);
    let first = &stages[0];
    assert_eq!(first["name"], "attacks");
    // No groupable buffs → lifts must be empty, baseline ≈ expected.
    assert_eq!(first["lifts"].as_array().unwrap().len(), 0);
    let baseline = first["baseline"].as_f64().unwrap();
    let expected = first["expected"].as_f64().unwrap();
    assert!(
        (baseline - expected).abs() < 1e-9,
        "baseline {baseline} vs expected {expected}"
    );
}

#[test]
fn shutdown_returns_ok_null() {
    // drive() always appends shutdown; the last response is shutdown's.
    let v = spec_version();
    let responses = drive(&[json!({
        "op": "init",
        "args": {"spec_version": v, "locale": "C", "tz": "UTC", "seed": 0}
    })]);
    let last = responses.last().expect("shutdown response");
    assert_eq!(last["ok"], true);
    assert!(last["value"].is_null());
}

// ---------------------------------------------------------------------------
// Wire hygiene
// ---------------------------------------------------------------------------

#[test]
fn malformed_json_returns_invalid_input_without_crashing() {
    let mut child = Command::new(RUNNER_BIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn runner");
    {
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, "{{not json").unwrap();
        writeln!(stdin, "{}", json!({"op": "shutdown"})).unwrap();
    }
    let out = child.wait_with_output().expect("wait");
    assert!(out.status.success(), "runner crashed on malformed input");
    let stdout = String::from_utf8(out.stdout).unwrap();
    let first: Value = serde_json::from_str(stdout.lines().next().unwrap()).unwrap();
    assert_eq!(first["error_kind"], "INVALID_INPUT");
}

#[test]
fn preserves_pipelined_response_ordering() {
    let v = spec_version();
    let mut requests = vec![json!({
        "op": "init",
        "args": {"spec_version": v, "locale": "C", "tz": "UTC", "seed": 0}
    })];
    for i in 0..10 {
        requests.push(json!({
            "op": "normalize",
            "args": {"input": format!("Input {i} Khârn")}
        }));
    }
    let responses = drive(&requests);
    // init + 10 normalize + shutdown = 12 responses
    assert_eq!(responses.len(), 12);
    for i in 0..10 {
        assert_eq!(
            responses[1 + i]["value"],
            Value::String(format!("input {i} kharn"))
        );
    }
}
