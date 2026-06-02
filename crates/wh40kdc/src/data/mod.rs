//! Linked, typed access over the embedded 40kdc dataset.
//!
//! This is the Rust mirror of the `@alpaca-software/40kdc-data` npm package's
//! data API. Find an entity and follow it to its links:
//!
//! ```
//! use wh40kdc::Dataset;
//!
//! let ds = Dataset::embedded();
//! let kharn = ds.find_unit("Kharn").unwrap();
//! for ability in ds.abilities_of(kharn) {
//!     let phases = ds.phases_of(ability);
//!     println!("{} acts in {:?}", ability.ability_id.as_str(), phases);
//! }
//! ```
//!
//! The dataset is embedded at build time (see
//! `cargo run -p xtask -- bundle-data`) and exposed behind the default
//! `bundled-data` feature; build with `default-features = false` for a
//! types-only crate with no embedded data and no extra dependencies.

mod collection;
mod dataset;
mod loadout;
mod normalize;

pub use collection::Collection;
pub use dataset::{Dataset, RawData};
pub use loadout::{
    clamp_weapon_count, maximal_loadout, option_cap, validate_loadout, Loadout, Violation,
    ViolationCode, WeaponBound,
};
pub use normalize::normalize_name;
