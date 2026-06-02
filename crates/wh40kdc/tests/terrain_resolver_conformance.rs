//! Cross-implementation conformance for the terrain resolver. The Rust resolver
//! must reproduce the `conformance/terrain-resolver/cases.json` goldens produced
//! by the TS reference (`tools/src/terrain/resolve.ts`, generated via
//! `npm run gen:conformance`). Vertices are compared within 5e-4 (the corpus
//! float tolerance); piece id/name/type/floor are compared exactly.

use std::path::PathBuf;

use serde::Deserialize;
use wh40kdc::terrain::{resolve_layout, ResolvedPiece, TerrainLayout, TerrainTemplate};

const TOLERANCE: f64 = 5e-4;

fn conformance_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance")
}

#[derive(Deserialize)]
struct TerrainCase {
    name: String,
    templates: Vec<TerrainTemplate>,
    layout: TerrainLayout,
    expected: ExpectedPieces,
}

#[derive(Deserialize)]
struct ExpectedPieces {
    pieces: Vec<ResolvedPiece>,
}

#[test]
fn terrain_resolver_corpus_matches() {
    let path = conformance_dir().join("terrain-resolver").join("cases.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let cases: Vec<TerrainCase> = serde_json::from_str(&raw).expect("parse terrain cases");
    assert!(!cases.is_empty(), "no terrain-resolver conformance cases found");

    for case in &cases {
        let actual = resolve_layout(&case.layout, &case.templates)
            .unwrap_or_else(|e| panic!("case {}: resolve failed: {e}", case.name));
        let expected = &case.expected.pieces;
        assert_eq!(
            actual.len(),
            expected.len(),
            "case {}: piece count",
            case.name
        );
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            assert_eq!(a.id, e.id, "case {} piece {i}: id", case.name);
            assert_eq!(a.name, e.name, "case {} piece {i}: name", case.name);
            assert_eq!(a.piece_type, e.piece_type, "case {} piece {i}: piece_type", case.name);
            assert_eq!(a.floor, e.floor, "case {} piece {i}: floor", case.name);
            assert_eq!(
                a.vertices.len(),
                e.vertices.len(),
                "case {} piece {i}: vertex count",
                case.name
            );
            for (j, (va, ve)) in a.vertices.iter().zip(e.vertices.iter()).enumerate() {
                assert!(
                    (va.x - ve.x).abs() <= TOLERANCE && (va.y - ve.y).abs() <= TOLERANCE,
                    "case {} piece {i} vert {j}: got ({}, {}), expected ({}, {})",
                    case.name,
                    va.x,
                    va.y,
                    ve.x,
                    ve.y
                );
            }
        }
    }
}
