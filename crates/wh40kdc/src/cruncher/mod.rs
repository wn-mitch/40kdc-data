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
//! let mut context = EngineContext::new(Phase::Shooting);
//! context.attacker_stationary = Some(false);
//! context.within_half_range = Some(false);
//! let input = EngineInput {
//!     attacker: AttackProfileRef { weapon, profile_index: 0 },
//!     target: TargetProfileRef { unit: target, profile_index: 0, model_count: None },
//!     models_firing: 5,
//!     buffs: Vec::new(),
//!     context,
//! };
//! let out = crunch(&input, None).expect("crunch succeeds");
//! assert_eq!(out.stages.len(), 7);
//! ```

pub mod allocation;
mod attack_compare;
pub mod attribution;
pub mod buffs;
pub mod condition_facts;
mod context;
mod critical_wounds;
mod damage_roll;
pub mod engine;
pub mod from_dsl;
pub mod from_keyword;
mod gates;
pub mod granted_records;
pub mod recipient_snapshots;
mod resolved;
pub mod scenario;
mod scenario_conditions;
mod scenario_facts;
mod weapon_bindings;

pub use allocation::{
    allocate, allocate_model, allocate_model_with, allocate_with, AllocationDefences,
    AllocationError, AllocationOutput, DamageZeroing, ZeroingPer, MAX_EVENT_WORK,
};
pub use attack_compare::attack_comparison_holds;
pub use attribution::{attribute_stages, AttributedStage, StageLift};
pub use buffs::{
    combined_toughness, resolve_buffs, AbilityKind, AttachmentRole, Buff, BuffApplicability,
    BuffContribution, BuffSource, EngineContext, RerollSubset, ResolvedModifiers, RollKind,
    WeaponKeywordRef,
};
pub use buffs::{AttackComparison, AttackOperand, AttackSide, AttackStatOperand, Comparison};
pub use condition_facts::{canonical_json, condition_fact_key, condition_needs, ConditionNeed};
pub use engine::{
    crunch, crunch_model, AttackModel, AttackProfileRef, CruncherError, EngineInput, EngineOutput,
    RollProbabilities, Stage, StageName, TargetProfileRef,
};
pub use from_dsl::{
    apply_activation, effect_to_buffs, ActivatableBuff, ActivatableGroupRef, CapRaise,
    EffectTranslation, StanceOptionRef, TranslationPerspective, UnsupportedFragment,
};
pub use from_keyword::buffs_from_keyword;
pub use granted_records::resolve_granted_records;
pub use recipient_snapshots::RecipientSnapshot;
pub use scenario::{
    ActiveRule, AttachedMember, MemberRole, ModelWounds, NeighbourOwner, ObjectiveController,
    ObjectiveTerritory, ObjectivesControlled, ScenarioNeighbour, ScenarioObjective, ScenarioRegion,
    ScenarioSide, UnitState, UnitStrength,
};
