//! The damage-projection engine: pure-function math over schema profiles
//! and a flat [`Buff`](buffs::Buff) stack.
//!
//! Rust mirror of `tools/src/cruncher/` in the
//! [`@alpaca-software/40kdc-data`](https://www.npmjs.com/package/@alpaca-software/40kdc-data)
//! npm package. Both implementations assert against the shared
//! `conformance/cruncher/` corpus to keep their per-stage expected values
//! within `5e-4` of each other.
//!
//! ```
//! use wh40kdc::{Dataset, Phase};
//! use wh40kdc::cruncher::{
//!     crunch, AttackProfileRef, EngineContext, EngineInput, TargetProfileRef,
//! };
//!
//! let ds = Dataset::embedded();
//! let weapon = ds.find_weapon("bolt-rifle").expect("bolt-rifle is bundled");
//! let target = ds.find_unit("intercessor-squad").expect("intercessor-squad is bundled");
//!
//! let input = EngineInput {
//!     attacker: AttackProfileRef { weapon, profile_index: 0 },
//!     target: TargetProfileRef { unit: target, profile_index: 0, model_count: None },
//!     models_firing: 5,
//!     buffs: Vec::new(),
//!     context: EngineContext {
//!         phase: Phase::Shooting,
//!         attacker_stationary: Some(false),
//!         attacker_charged: None,
//!         within_half_range: Some(false),
//!         attacker_in_cover: None,
//!         target_in_cover: None,
//!         attacker_keywords: None,
//!         target_keywords: None,
//!         timing: None,
//!         attacker_attached: None,
//!     },
//! };
//! let out = crunch(&input, None).expect("crunch succeeds");
//! assert_eq!(out.stages.len(), 7);
//! ```

pub mod attribution;
pub mod buffs;
pub mod engine;
pub mod from_keyword;

pub use attribution::{attribute_stages, AttributedStage, StageLift};
pub use buffs::{
    resolve_buffs, AbilityKind, Buff, BuffApplicability, BuffContribution, BuffSource,
    EngineContext, RerollSubset, ResolvedModifiers, RollKind, WeaponKeywordRef,
};
pub use engine::{
    crunch, AttackProfileRef, CruncherError, EngineInput, EngineOutput, Stage, StageName,
    TargetProfileRef,
};
pub use from_keyword::buffs_from_keyword;
