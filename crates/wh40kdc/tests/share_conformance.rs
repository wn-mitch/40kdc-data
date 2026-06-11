//! Cross-implementation conformance for the `share-v1` list codec.
//!
//! Each case in `conformance/share/cases.json` is either a round-trip
//! (`{name, list, token}`) or a negative decode (`{name, decode_token,
//! expected_decode}`). The Rust crate must reproduce the reference (TS) token
//! byte-for-byte and the exact decode verdict. See `CONFORMANCE.md` "share/"
//! and `tools/docs/share-token.md` for the wire-format contract.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use wh40kdc::share::{decode_share_token, encode_share_token, DecodeResult, ShareList};

fn cases() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance/share/cases.json");
    let raw = fs::read_to_string(&path).expect("read conformance/share/cases.json");
    serde_json::from_str(&raw).expect("parse share cases")
}

#[test]
fn share_corpus_is_non_empty() {
    assert!(!cases().is_empty());
}

#[test]
fn round_trip_cases_match_golden_tokens() {
    let mut checked = 0;
    for case in cases() {
        let (Some(list_val), Some(token)) = (case.get("list"), case.get("token")) else {
            continue;
        };
        let name = case["name"].as_str().unwrap_or("?");
        let list: ShareList =
            serde_json::from_value(list_val.clone()).expect("deserialize ShareList");
        let expected_token = token.as_str().expect("token is a string");

        // Encode must reproduce the golden token byte-for-byte.
        let actual = encode_share_token(&list).expect("encode");
        assert_eq!(actual, expected_token, "share/{name}: token mismatch");

        // Decode of the golden token must round-trip to the input list.
        match decode_share_token(expected_token) {
            DecodeResult::Ok(decoded) => {
                assert_eq!(decoded, list, "share/{name}: decode did not round-trip")
            }
            DecodeResult::Err(e) => panic!("share/{name}: golden token failed to decode: {e:?}"),
        }
        checked += 1;
    }
    assert!(checked > 0, "no round-trip cases found");
}

#[test]
fn negative_decode_cases_match_verdict() {
    let mut checked = 0;
    for case in cases() {
        let Some(token) = case.get("decode_token").and_then(Value::as_str) else {
            continue;
        };
        let name = case["name"].as_str().unwrap_or("?");
        let expected = &case["expected_decode"];
        // Serialize the actual verdict to JSON and compare structurally with the
        // golden — exactly what the differ does across implementations.
        let actual = serde_json::to_value(decode_share_token(token)).expect("serialize verdict");
        assert_eq!(&actual, expected, "share/{name}: decode verdict mismatch");
        checked += 1;
    }
    assert!(checked > 0, "no negative decode cases found");
}
