//! Rust types for the [40kdc-data](https://github.com/alpaca-software/40kdc-data)
//! Warhammer 40K schema layer.
//!
//! Every type in this crate is generated from the canonical JSON Schemas by
//! `cargo run -p xtask -- codegen`. The schema content these types describe is
//! published under CC0 — see the crate README.
//!
//! ```
//! use wh40kdc::Unit;
//!
//! let data = std::fs::read_to_string("path/to/units.json").unwrap_or("[]".to_string());
//! let units: Vec<Unit> = serde_json::from_str(&data).unwrap();
//! ```
//!
//! With the default `bundled-data` feature the whole dataset ships embedded
//! behind a linked, typed API ([`Dataset`]) — find an entity and follow it to
//! its weapons, abilities, phases, and faction:
//!
//! ```
//! # #[cfg(feature = "bundled-data")] {
//! use wh40kdc::{Dataset, Phase};
//!
//! let ds = Dataset::embedded();
//! let kharn = ds.find_unit("Kharn").unwrap(); // resolves "Khârn the Betrayer"
//! let shooting: Vec<&str> = ds
//!     .abilities_of(kharn)
//!     .into_iter()
//!     .filter(|a| ds.phases_of(a).contains(&Phase::Shooting))
//!     .map(|a| a.ability_id.as_str())
//!     .collect();
//! assert_eq!(shooting, ["berzerker-frenzy"]);
//! # }
//! ```

// generated.rs is prettyplease-formatted by the codegen (see xtask); skip rustfmt
// so `cargo fmt` doesn't fight the committed output / CI drift check.
#[rustfmt::skip]
mod generated;

pub use generated::*;

/// Canonical string encoding of a base size, shared by the conformance runner and
/// its tests so both sides of the cross-impl contract agree byte-for-byte. Mirrors
/// the TS `encodeBase`. Examples: round 32 → `"round:32"`; oval 75×42 →
/// `"oval:75x42"`; small flyer → `"flying-base:small:draft"`; hull → `"hull:draft"`.
pub fn encode_base_size(b: &BaseSize) -> String {
    let mut parts = vec![b.shape.to_string()];
    match b.shape {
        BaseSizeShape::Round => {
            if let Some(d) = b.diameter {
                parts.push(d.to_string());
            }
        }
        BaseSizeShape::Oval => {
            if let (Some(w), Some(l)) = (b.width, b.length) {
                parts.push(format!("{}x{}", w, l));
            }
        }
        BaseSizeShape::FlyingBase => {
            if let Some(s) = &b.size {
                parts.push(s.to_string());
            }
        }
        _ => {}
    }
    if b.draft {
        parts.push("draft".to_string());
    }
    parts.join(":")
}

/// Linked, typed access over the embedded dataset (default `bundled-data`).
#[cfg(feature = "bundled-data")]
pub mod data;

#[cfg(feature = "bundled-data")]
pub use data::{normalize_name, Collection, Dataset, RawData};

pub use data::{
    clamp_weapon_count, maximal_loadout, option_cap, validate_loadout, Loadout, Violation,
    ViolationCode, WeaponBound,
};

/// Army-list importer: ListForge share payload + NewRecruit (JSON / wtc /
/// simple) → resolved 40kdc roster (default `import`). The same module
/// hosts the [`Roster`](import::Roster) domain types, which are also reused
/// by the exporter — so it stays available whenever either `import` or
/// `export` is enabled.
#[cfg(any(feature = "import", feature = "export"))]
pub mod import;

/// Roster exporter: resolved [`Roster`](import::Roster) → NewRecruit JSON /
/// wtc-compact / wtc-full / simple / canonical Roster JSON (default
/// `export`). Dataset-free — outputs depend only on the Roster shape, which
/// keeps Rust and TS byte-identical for export goldens.
#[cfg(feature = "export")]
pub mod export;

/// Expected-value damage-projection engine: pure-function math over schema
/// profiles and a flat [`Buff`](cruncher::Buff) stack (default `cruncher`).
/// Mirrors `tools/src/cruncher/` in the TS package; the
/// `conformance/cruncher/` corpus pins both implementations to within
/// `5e-4` per pipeline stage.
#[cfg(feature = "cruncher")]
pub mod cruncher;

/// Plain-English translation of `secondary-card` scoring `awards` (mission
/// "how to play" readouts) plus the shared Ability-DSL condition humanizer.
/// Mirrors `tools/src/translate/` in the TS package; the
/// `conformance/scoring-translation/` corpus pins both implementations to
/// byte-identical output. Depends only on the generated types, so it stays
/// available even in a types-only (`default-features = false`) build.
pub mod translate;

pub use translate::{describe_award, describe_condition, describe_scoring_card, describe_trigger};

/// Terrain layout geometry: resolve template-anchored layouts to absolute
/// board-space vertices. Pure (no data deps), so available in every build.
/// Cross-impl pinned by the `terrain-resolver` conformance corpus.
pub mod terrain;

pub use terrain::{resolve_layout, ResolvedPiece, TerrainResolveError};

/// The bundled, self-contained JSON Schema (draft 2020-12) these types were
/// generated from. Consumers can feed this to a JSON Schema validator to check
/// data before deserializing; the canonical validation CLI lives in the
/// `@alpaca-software/40kdc-data` npm package.
pub const BUNDLED_SCHEMA: &str = include_str!("../schemas/bundled.schema.json");
