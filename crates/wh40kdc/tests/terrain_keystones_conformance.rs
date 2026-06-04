//! Cross-implementation conformance for measurement-keystone derivation. The
//! Rust port must reproduce the `conformance/terrain-keystones/cases.json`
//! goldens produced by the TS reference (`tools/src/terrain/keystones.ts`,
//! generated via `npm run gen:conformance`). Distances are compared within
//! 5e-4 (the corpus float tolerance); piece_index / piece_id / edge / ref are
//! compared exactly.

use std::path::PathBuf;

use serde::Deserialize;
use wh40kdc::terrain::{
    keystone_measurements, BoardExtents, KeystoneMeasurement, TerrainLayout, TerrainTemplate,
    BOARD_INCHES,
};

const TOLERANCE: f64 = 5e-4;

fn conformance_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance")
}

#[derive(Deserialize)]
struct KeystoneCase {
    name: String,
    templates: Vec<TerrainTemplate>,
    layout: TerrainLayout,
    #[serde(default)]
    board: Option<BoardExtents>,
    expected: ExpectedMeasurements,
}

#[derive(Deserialize)]
struct ExpectedMeasurements {
    measurements: Vec<KeystoneMeasurement>,
}

#[test]
fn terrain_keystones_corpus_matches() {
    let path = conformance_dir()
        .join("terrain-keystones")
        .join("cases.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<KeystoneCase> = serde_json::from_str(&raw).expect("parse keystone cases");
    assert!(
        !cases.is_empty(),
        "no terrain-keystones conformance cases found"
    );

    for case in &cases {
        let board = case.board.unwrap_or(BOARD_INCHES);
        let actual = keystone_measurements(&case.layout, &case.templates, board)
            .unwrap_or_else(|e| panic!("case {}: derivation failed: {e}", case.name));
        let expected = &case.expected.measurements;
        assert_eq!(
            actual.len(),
            expected.len(),
            "case {}: measurement count",
            case.name
        );
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            assert_eq!(
                a.piece_index, e.piece_index,
                "case {} measurement {i}: piece_index",
                case.name
            );
            assert_eq!(
                a.piece_id, e.piece_id,
                "case {} measurement {i}: piece_id",
                case.name
            );
            assert_eq!(a.edge, e.edge, "case {} measurement {i}: edge", case.name);
            assert_eq!(a.r#ref, e.r#ref, "case {} measurement {i}: ref", case.name);
            assert!(
                (a.distance - e.distance).abs() <= TOLERANCE,
                "case {} measurement {i}: distance got {}, expected {}",
                case.name,
                a.distance,
                e.distance
            );
        }
    }
}
