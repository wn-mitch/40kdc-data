//! Cross-implementation conformance for wargear legality under each unit's MFM
//! loadout rules. The Rust runner must reproduce
//! `conformance/mfm_loadout/{defaults,checks}.json` produced by the TS reference
//! (`tools/src/data/mfm-loadout.ts`).
//!
//! Driven through the actual `wh40kdc-runner` binary (the cross-impl differ's
//! path), so this pins the wire contract. Values compared exactly.

#![cfg(feature = "bundled-data")]

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde_json::{json, Value};

const RUNNER_BIN: &str = env!("CARGO_BIN_EXE_wh40kdc-runner");

fn conformance_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance")
}

fn spec_version() -> i64 {
    std::fs::read_to_string(conformance_dir().join("SPEC_VERSION"))
        .expect("read SPEC_VERSION")
        .trim()
        .parse()
        .expect("SPEC_VERSION integer")
}

fn drive_post_init(requests: Vec<Value>) -> Vec<Value> {
    let v = spec_version();
    let mut full = vec![
        json!({"op": "init", "args": {"spec_version": v, "locale": "C", "tz": "UTC", "seed": 0}}),
    ];
    full.extend(requests);

    let mut child = Command::new(RUNNER_BIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn runner");
    // A large corpus fills the runner's stdout pipe before every request is
    // written, so requests go in from their own thread while this one reads.
    let mut stdin = child.stdin.take().expect("runner stdin");
    let writer = std::thread::spawn(move || {
        for req in &full {
            writeln!(stdin, "{req}").expect("write request");
        }
        writeln!(stdin, "{}", json!({"op": "shutdown"})).expect("write shutdown");
    });
    let out = child.wait_with_output().expect("wait for runner");
    writer.join().expect("request writer");
    assert!(
        out.status.success(),
        "runner exited {:?}; stderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );
    let stdout = String::from_utf8(out.stdout).expect("runner stdout is utf-8");
    let responses: Vec<Value> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("non-JSON line {l:?}: {e}")))
        .collect();
    assert_eq!(responses[0]["ok"].as_bool(), Some(true), "init failed");
    responses[1..responses.len() - 1].to_vec()
}

#[derive(Deserialize)]
struct MfmLoadoutCase {
    name: String,
    args: Value,
    expected: Value,
}

fn run_corpus(file: &str, op: &str) {
    let path = conformance_dir().join("mfm_loadout").join(file);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<MfmLoadoutCase> = serde_json::from_str(&raw).expect("parse mfm_loadout cases");
    assert!(!cases.is_empty(), "no mfm_loadout/{file} cases found");

    let requests: Vec<Value> = cases
        .iter()
        .map(|c| json!({"op": op, "args": c.args}))
        .collect();
    let responses = drive_post_init(requests);
    assert_eq!(responses.len(), cases.len(), "response count must match");

    for (case, response) in cases.iter().zip(responses.iter()) {
        assert_eq!(
            response["ok"].as_bool(),
            Some(true),
            "mfm_loadout/{}: runner errored: {response}",
            case.name
        );
        assert_eq!(
            response["value"], case.expected,
            "mfm_loadout/{}: value diverged from the TS golden",
            case.name
        );
    }
}

#[test]
fn mfm_loadout_defaults_match_reference() {
    run_corpus("defaults.json", "default_mfm_loadout");
}

#[test]
fn mfm_loadout_checks_match_reference() {
    run_corpus("checks.json", "check_mfm_loadout");
}

/// A fractional or negative count is not a configuration, so the op refuses it
/// rather than truncating it into one.
#[test]
fn mfm_loadout_rejects_malformed_counts() {
    let requests = [json!(1.5), json!(-1)]
        .into_iter()
        .map(|n| {
            json!({"op": "check_mfm_loadout", "args": {
                "unitId": "deff-dread", "factionId": "orks", "models": {}, "counts": {"dread-klaw": n},
            }})
        })
        .collect();
    for response in drive_post_init(requests) {
        assert_eq!(response["error_kind"], "INVALID_INPUT", "{response}");
    }
}
