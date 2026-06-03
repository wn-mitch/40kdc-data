//! Cross-implementation conformance for the scoring engine. The Rust runner
//! must reproduce the `conformance/scoring/cases.json` goldens produced by the
//! TS reference (`tools/src/scoring/`, generated via `npm run gen:conformance`).
//!
//! Driven through the actual `wh40kdc-runner` binary — the same path the
//! cross-impl differ uses — so this pins the wire contract, not just the
//! library functions. Values are compared exactly (integers, no tolerance).

#![cfg(feature = "cruncher")]

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
    let p = conformance_dir().join("SPEC_VERSION");
    std::fs::read_to_string(&p)
        .unwrap_or_else(|e| panic!("reading {}: {e}", p.display()))
        .trim()
        .parse()
        .expect("SPEC_VERSION integer")
}

/// Spawn the runner, feed the requests as NDJSON (with init prepended and
/// shutdown appended), and return the post-init responses in order.
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
    {
        let mut stdin = child.stdin.take().expect("runner stdin");
        for req in &full {
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
    let responses: Vec<Value> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("non-JSON line {l:?}: {e}")))
        .collect();
    assert_eq!(
        responses[0]["ok"].as_bool(),
        Some(true),
        "init failed: {}",
        responses[0]
    );
    // Drop init at front and shutdown at back.
    responses[1..responses.len() - 1].to_vec()
}

#[derive(Deserialize)]
struct ScoringCase {
    name: String,
    op: String,
    args: Value,
    expected: Value,
}

#[test]
fn scoring_corpus_matches_reference() {
    let path = conformance_dir().join("scoring").join("cases.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<ScoringCase> = serde_json::from_str(&raw).expect("parse scoring cases");
    assert!(!cases.is_empty(), "no scoring conformance cases found");

    let requests: Vec<Value> = cases
        .iter()
        .map(|c| json!({"op": c.op, "args": c.args}))
        .collect();
    let responses = drive_post_init(requests);
    assert_eq!(
        responses.len(),
        cases.len(),
        "response count must match case count"
    );

    for (case, response) in cases.iter().zip(responses.iter()) {
        assert_eq!(
            response["ok"].as_bool(),
            Some(true),
            "scoring/{}: runner errored: {response}",
            case.name
        );
        assert_eq!(
            response["value"], case.expected,
            "scoring/{}: value diverged from the TS golden",
            case.name
        );
    }
}
