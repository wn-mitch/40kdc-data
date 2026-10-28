//! Translate an Ability DSL `effect` tree into the [`Buff`] stack it contributes, plus the
//! effect fragments the buff layer cannot auto-apply and the buffs that sit behind a player
//! decision. The Rust mirror of `tools/src/cruncher/from-dsl.ts`; the
//! `conformance/abilities-resolver/{from-dsl,defensive-from-dsl}.json` corpus pins both.
//!
//! The walker reads the effect's JSON form with the TS translator's semantics. A typed round
//! trip writes an absent optional field as `null`, which the TS oracle never sees, so the
//! input is stripped of null-valued keys first.
//!
//! The target of each leaf is classified against the perspective: the ability's own unit
//! (`this-unit`, `ability-unit`, `this-model`, `selected-unit`, `recipient`, a friendly unit
//! filter) is the buffed side; `defender` and an enemy filter are the other side. An
//! `event-subject` under a trigger naming who acts is bound to the buffed unit or to another
//! unit (see `selection::bind_event_subject`); a binding still unknown (`event-subject`,
//! `event-object`, `stratagem-target`, `bearer-transport`) is reported as unsupported, and any
//! other binding is not known to be the buffed unit and contributes nothing. Core rule 19.04: a
//! `this-model` effect pooled in from another member of a combined unit stays on its model.
//! Common filters use three-valued matching: unresolved board or model membership
//! never turns into an automatic buff. Explicit selection levers retain those
//! requirements for the player, rather than pretending that the engine resolved them.

mod applicability;
mod attack_scope;
pub(crate) mod conditions;
mod damage_leaves;
mod gated;
mod js;
mod leaves;
mod levers;
mod selection;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::buffs::{AbilityKind, Buff, BuffSource, EngineContext};
use js::*;

pub use levers::{
    is_attack_step, is_post_own_attack_moment, moment_gate, moment_key, POST_ATTACK_MOMENT,
};

pub(crate) use super::recipient_snapshots::recipient_snapshot_reason;

pub(crate) use selection::bind_event_subject;

pub(crate) fn bind_snapshot_recipient(node: &Obj, target: &Value) -> Option<Value> {
    selection::bind_recipient(node, Some(target))
}

/// A fragment the translator could not turn into a buff; a UI renders these as warnings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedFragment {
    pub reason: String,
    pub effect_fragment: Value,
}

/// A mutually-limited pool of [`ActivatableBuff`] levers: at most `max_activations` of the
/// levers sharing `id` fire at once.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivatableGroupRef {
    pub id: String,
    pub max_activations: i64,
}

/// A buff-bearing player decision the cruncher cannot make on its own: a dice-pool option, a
/// `choice` branch, or an activation gated on a timing the player controls. Not auto-applied.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivatableBuff {
    /// Stable toggle id, e.g. `"blessings-of-khorne#Warp Blades"`.
    pub id: String,
    /// Human label for the lever (option name, or a summary of its buffs).
    pub label: String,
    /// Contributions this activation adds when the player opts in (at least one, or none for a
    /// [`cap_raise`](Self::cap_raise) lever).
    pub buffs: Vec<Buff>,
    /// Set when the lever belongs to a mutually-limited pool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<ActivatableGroupRef>,
    /// Additional independent caps, such as a parent ability's shared usage pool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<ActivatableGroupRef>>,
    /// The lever raises the cap of another ability's lever pool instead of adding buffs ("select
    /// one more augmentation").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap_raise: Option<CapRaise>,
    /// DSL fragments the player vouches for when opting in, in the order they apply: a unit
    /// selection (its range, visibility and eligibility), a gating roll, a model count. Absent
    /// when the lever assumes nothing beyond the choice itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Vec<Value>>,
    /// The stance option the lever applies under: a `rule-active` gate on an option the
    /// context's `active_rules` does not declare. The lever pool binds it to that option's own
    /// lever.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_option: Option<StanceOptionRef>,
    /// The stance option the lever does not apply under: a negated `rule-active` gate on it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excludes_option: Option<StanceOptionRef>,
}

/// An [`ActivatableBuff`] that raises another ability's lever cap: `ability` names that ability
/// as the DSL does, `by` the extra activations.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CapRaise {
    pub ability: String,
    pub by: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allocation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option: Option<StanceOptionRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<StanceOptionRef>>,
}

/// Stable authored option reference, independent of its display label.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StanceOptionRef {
    pub ability_id: String,
    pub option_id: String,
}

/// The result of [`effect_to_buffs`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EffectTranslation {
    pub applied: Vec<Buff>,
    pub unsupported: Vec<UnsupportedFragment>,
    /// Buffs sitting behind a player decision — see [`ActivatableBuff`].
    pub activatable: Vec<ActivatableBuff>,
}

/// Whose perspective the translation runs from: the buffed unit attacking, or being attacked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranslationPerspective {
    #[default]
    Attacker,
    Target,
}

/// A lever while walking: buffs stay JSON until the walk ends.
pub(crate) struct Lever {
    id: String,
    label: String,
    buffs: Vec<Value>,
    group: Option<(String, i64)>,
    requires: Option<Vec<Value>>,
    cap_raise: Option<CapRaise>,
    gate: Option<gated::StanceGate>,
}

/// The walk's sink, mirroring the TS `EffectTranslation` with JSON buffs.
#[derive(Default)]
pub(crate) struct Out {
    applied: Vec<Value>,
    unsupported: Vec<(String, Value)>,
    activatable: Vec<Lever>,
}

impl Out {
    fn unsupported(&mut self, reason: impl Into<String>, fragment: &Obj) {
        self.unsupported
            .push((reason.into(), Value::Object(fragment.clone())));
    }
}

/// Walk options: the context, perspective and the owning ability id that seeds lever ids.
#[derive(Clone)]
pub(crate) struct WalkOpts<'a> {
    context: &'a EngineContext,
    perspective: TranslationPerspective,
    ability_id: &'a str,
    source: &'a Value,
    ability_kind: Option<AbilityKind>,
    source_meta: &'a BuffSource,
    duration: Option<Value>,
    /// Usage limit inherited from the owning ability or nearest ability part.
    usage: Option<Value>,
    granted_holder: bool,
    /// Tags the owning ability designates on the units holding it
    /// ([`gated::self_designations`]).
    self_designations: &'a std::collections::BTreeSet<String>,
}

const STOCHASTIC_DICE_GATED: &str = "dice-gated effect: stochastic; not expressible as a buff";
const MODEL_SCOPED_REASON: &str =
    "model-scoped effect from an attached model: applies to that model only (core rule 19.04)";
/// Diagnostic emitted for a model-scoped effect of a Stratagem that targets one model.
const STRATAGEM_MODEL_REASON: &str = "model-only target";
const FIDELITY_BINDING_REASON: &str =
    "selection/history/model/attack predicates are not resolved by the buff engine";
const ALTERNATIVES_REASON: &str =
    "unit-filter target: identity, state or model membership is unresolved";

/// Owner selects the side; every remaining predicate must be known on that side.
fn alternatives_match(node: &Obj, opts: &WalkOpts) -> Option<bool> {
    let Some(target) = node.get("target").and_then(Value::as_object) else {
        return Some(true);
    };
    let owner = target
        .get("owner")
        .and_then(Value::as_str)
        .unwrap_or("friendly");
    let side = match target.get("member_of").and_then(Value::as_str) {
        Some("attacker") => TranslationPerspective::Attacker,
        Some("defender") => TranslationPerspective::Target,
        _ if owner == "enemy" => TranslationPerspective::Target,
        _ => opts.perspective,
    };
    conditions::matches_unit_filter(node.get("target")?, opts.context, side, owner)
}

/// Walk an ability DSL `effect` tree and produce the buff stack it contributes against
/// `context` from `perspective`, plus the fragments the buff layer cannot express.
pub fn effect_to_buffs(
    effect: &Value,
    source: &BuffSource,
    context: &EngineContext,
    perspective: TranslationPerspective,
) -> EffectTranslation {
    effect_to_buffs_with_duration(effect, source, context, perspective, None, None)
}

/// Translate an effect while retaining the owning ability's lifetime for activation gates.
pub(crate) fn effect_to_buffs_with_duration(
    effect: &Value,
    source: &BuffSource,
    context: &EngineContext,
    perspective: TranslationPerspective,
    duration: Option<&Value>,
    usage: Option<&Value>,
) -> EffectTranslation {
    let effect = strip_nulls(effect);
    let effect = if recipient_snapshot_reason(None, &effect).is_some() {
        match super::recipient_snapshots::resolve_recipient_snapshots(
            None,
            &effect,
            source,
            context,
            perspective,
        ) {
            Ok(effect) => effect,
            Err(reason) => {
                return EffectTranslation {
                    unsupported: vec![UnsupportedFragment {
                        reason: reason.into(),
                        effect_fragment: effect,
                    }],
                    ..Default::default()
                }
            }
        }
    } else {
        effect
    };
    let effect = super::weapon_bindings::resolve_named_weapon_bindings(&effect);
    let (ability_id, ability_kind) = match source {
        BuffSource::Ability {
            ability_id,
            ability_kind,
            ..
        } => (ability_id.as_str(), Some(ability_kind.clone())),
        _ => ("effect", None),
    };
    let source_value = serde_json::to_value(source).expect("a buff source serializes");
    let self_designations = gated::self_designations(&effect, ability_id);
    let opts = WalkOpts {
        context,
        perspective,
        ability_id,
        source: &source_value,
        source_meta: source,
        ability_kind,
        duration: duration.cloned(),
        usage: usage.cloned(),
        granted_holder: false,
        self_designations: &self_designations,
    };
    let mut out = Out::default();
    walk(&effect, &opts, &mut out);
    finish(out)
}

/// Typed output from the JSON sink. Every buff the walker builds has a known contribution
/// shape, so a failed conversion is a translator bug.
fn finish(out: Out) -> EffectTranslation {
    let buff = |v: Value| -> Buff {
        serde_json::from_value(v.clone())
            .unwrap_or_else(|e| panic!("from-dsl built an invalid buff {v}: {e}"))
    };
    EffectTranslation {
        applied: out.applied.into_iter().map(buff).collect(),
        unsupported: out
            .unsupported
            .into_iter()
            .map(|(reason, effect_fragment)| UnsupportedFragment {
                reason,
                effect_fragment,
            })
            .collect(),
        activatable: out
            .activatable
            .into_iter()
            .map(|l| ActivatableBuff {
                id: l.id,
                label: l.label,
                buffs: l.buffs.into_iter().map(buff).collect(),
                group: l.group.map(|(id, max_activations)| ActivatableGroupRef {
                    id,
                    max_activations,
                }),
                groups: None,
                cap_raise: l.cap_raise,
                requires_option: l
                    .gate
                    .as_ref()
                    .filter(|gate| !gate.negated)
                    .map(|gate| gate.option.clone()),
                excludes_option: l.gate.filter(|gate| gate.negated).map(|gate| gate.option),
                requires: l.requires,
            })
            .collect(),
    }
}

/// Attach parent activation requirements after walking so child option groups
/// and local triggers remain intact instead of being flattened by a wrapper.
pub fn apply_activation(result: &mut EffectTranslation, ability_id: &str, activation: Value) {
    if activation.get("usage").is_none_or(Value::is_null)
        && activation.get("cost").is_none_or(Value::is_null)
        && activation.get("optional").and_then(Value::as_bool) != Some(true)
    {
        return;
    }
    let limits = activation
        .get("usage")
        .map(|usage| match usage {
            Value::Array(limits) => limits.as_slice(),
            other => std::slice::from_ref(other),
        })
        .unwrap_or_default();
    let count = limits
        .iter()
        .filter(|limit| {
            limit.is_object() && limit.get("per").and_then(Value::as_str) != Some("model")
        })
        .filter_map(|limit| {
            limit.get("count").and_then(Value::as_i64).or_else(|| {
                (limit.get("frequency").and_then(Value::as_str) != Some("n-per-battle"))
                    .then_some(1)
            })
        })
        .min();
    let group = count.map(|max_activations| ActivatableGroupRef {
        id: format!("{ability_id}?usage"),
        max_activations,
    });
    let mut requirement = activation.clone();
    if let Some(requirement) = requirement.as_object_mut() {
        requirement.remove("duration");
    }
    if !result.applied.is_empty() {
        let buffs = std::mem::take(&mut result.applied);
        let raw: Vec<Value> = buffs
            .iter()
            .map(|buff| serde_json::to_value(buff).expect("buff serializes"))
            .collect();
        result.activatable.push(ActivatableBuff {
            id: format!("{ability_id}#activate"),
            label: applicability::label_for_buffs(&raw),
            buffs,
            group: None,
            groups: None,
            cap_raise: None,
            requires_option: None,
            excludes_option: None,
            requires: None,
        });
    }
    for lever in &mut result.activatable {
        if let Some(group) = &group {
            if lever
                .group
                .as_ref()
                .is_none_or(|current| current.id != group.id)
            {
                if lever.group.is_some() {
                    lever
                        .groups
                        .get_or_insert_with(Vec::new)
                        .push(group.clone());
                } else {
                    lever.group = Some(group.clone());
                }
            }
        }
        lever
            .requires
            .get_or_insert_with(Vec::new)
            .insert(0, requirement.clone());
    }
}

/// Unit-refs that name a unit the buff layer cannot identify with the buffed unit.
const UNRESOLVED_TARGETS: &[&str] = &[
    "event-subject",
    "event-object",
    "stratagem-target",
    "bearer-transport",
];

/// `{source, contribution}` as JSON.
pub(crate) fn buff(opts: &WalkOpts, contribution: Value) -> Value {
    json!({ "source": opts.source, "contribution": contribution })
}

/// Walk one node into `out`.
pub(crate) fn walk(node: &Value, opts: &WalkOpts, out: &mut Out) {
    let Some(current) = node.as_object() else {
        return;
    };
    // Core rule 19.04, before any leaf translation and under both perspectives.
    if opts.ability_kind == Some(AbilityKind::Attached)
        && matches!(
            current.get("target").and_then(Value::as_str),
            Some("this-model" | "model-in-this-unit")
        )
    {
        out.unsupported(MODEL_SCOPED_REASON, current);
        return;
    }
    // A Stratagem that targets one model reaches that model alone: a buff on the buffed unit only
    // when the unit is that one model. An unknown model count is not assumed to be one.
    if matches!(
        opts.source_meta,
        BuffSource::Ability {
            selects_model: Some(true),
            ..
        }
    ) && matches!(
        current.get("target").and_then(Value::as_str),
        Some("this-model" | "model-in-this-unit")
    ) && match opts.perspective {
        TranslationPerspective::Attacker => opts.context.attacker_model_count,
        TranslationPerspective::Target => opts.context.target_model_count,
    } != Some(1)
    {
        out.unsupported(STRATAGEM_MODEL_REASON, current);
        return;
    }
    if is_str(current, "target", "model-in-this-unit") {
        out.unsupported(
            "model-in-this-unit: individual model identity is unresolved",
            current,
        );
        return;
    }
    // An ability grant reports its own unresolved holders.
    if let Some(target) = current
        .get("target")
        .and_then(Value::as_str)
        .filter(|target| UNRESOLVED_TARGETS.contains(target))
    {
        if !is_str(current, "type", "ability-grant") {
            out.unsupported(
                format!("target \"{target}\" is not resolved by the buff engine"),
                current,
            );
            return;
        }
    }
    if is_str(current, "type", "ability-part") {
        if let Some(reason) = recipient_snapshot_reason(
            current.get("trigger"),
            current.get("effect").unwrap_or(&Value::Null),
        ) {
            out.unsupported(reason, current);
            return;
        }
    }
    // A unit selection reaching the selected unit is a player lever; its eligibility is what the
    // player vouches for, so it is planned before the fidelity check below.
    if is_str(current, "type", "select-units") {
        let plan = selection::plan_selection(current, opts);
        if !matches!(plan, selection::SelectionPlan::None) {
            selection::translate_selection(plan, current, opts, out);
            return;
        }
    }
    if is_str(current, "type", "for-each-unit") {
        if let Some(bound) = selection::bind_each_recipient(current) {
            walk(&bound, opts, out);
            return;
        }
    }
    if has_unresolved_fidelity_binding(current) {
        out.unsupported(FIDELITY_BINDING_REASON, current);
        return;
    }
    // A scaled or bound value has no fixed size here: applying the printed value would misstate it.
    if let Some(reason) = unsized_value_reason(current) {
        // A capped scaling is a lever at its cap; the player vouches for the count that reaches it.
        if let Some(at_cap) = selection::scaled_to_cap(current) {
            let requires = vec![current.get("scaling").cloned().unwrap_or(Value::Null)];
            let id = format!("{}#at-cap", opts.ability_id);
            selection::offer_lever(
                &Value::Object(at_cap),
                opts,
                out,
                id,
                "At its maximum",
                requires,
                None,
            );
            return;
        }
        out.unsupported(reason, current);
        return;
    }
    // An ability another unit provides reaches the crunched unit only through a friendly filter,
    // an aura's recipient or a selection; its own unit and model are the provider.
    if selection::targets_provider(current, opts) {
        return;
    }
    // Targets require positive evidence for every canonical filter predicate.
    match alternatives_match(current, opts) {
        Some(false) => return,
        None => {
            out.unsupported(ALTERNATIVES_REASON, current);
            return;
        }
        Some(true) => {}
    }
    // An `incoming` change modifies attacks made against its target: the attacker's side of them.
    let modifier = object(current.get("modifier"));
    // On the defender it changes every friendly attack against that unit, the buffed unit's among
    // them, so the attacker perspective reads it as a change for friendly units; the target
    // perspective has no such attack.
    if modifier.is_some_and(|m| is_true(m, "incoming"))
        && classify_target(current) == Side::Defender
    {
        if opts.perspective == TranslationPerspective::Attacker {
            let mut m = modifier.cloned().unwrap_or_default();
            m.remove("incoming");
            let mut owned = current.clone();
            owned.insert("target".into(), json!({ "owner": "friendly" }));
            owned.insert("modifier".into(), Value::Object(m));
            walk(&Value::Object(owned), opts, out);
        }
        return;
    }
    if modifier.is_some_and(|m| is_true(m, "incoming")) && classify_target(current) == Side::Buffed
    {
        if opts.perspective == TranslationPerspective::Attacker {
            return;
        }
        let ty = js_string(current.get("type"));
        if ty == "roll-modifier" || ty == "stat-modifier" {
            let mut m = modifier.cloned().unwrap_or_default();
            m.remove("incoming");
            let mut owned = current.clone();
            owned.insert("target".into(), Value::from("attacker"));
            owned.insert("modifier".into(), Value::Object(m));
            walk(&Value::Object(owned), opts, out);
        } else {
            out.unsupported(
                format!("{ty}: an incoming change to attacks against the unit is not modelled"),
                current,
            );
        }
        return;
    }
    dispatch(current, opts, out);
}

fn dispatch(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let ty = node.get("type");
    match ty.and_then(Value::as_str) {
        Some("re-roll") => leaves::reroll(node, opts, out),
        Some("roll-modifier") => leaves::roll_modifier(node, opts, out),
        Some("stat-modifier") => leaves::stat_modifier(node, opts, out),
        Some("feel-no-pain") => leaves::feel_no_pain(node, opts, out),
        Some("weapon-ability-grant") => leaves::keyword_grant(node, opts, out),
        Some("damage-reduction") => leaves::damage_reduction(node, opts, out),
        Some("invulnerable-save") => leaves::invulnerable_save(node, opts, out),
        Some("named-region-state") => leaves::named_region_state(node, opts, out),
        Some("conditional") => levers::conditional(node, opts, out),
        Some("rules-bundle" | "sequence") => {
            for step in list(node.get("steps")) {
                walk(step, opts, out);
            }
        }
        Some("ability-part") => {
            // Orders are issued at their own moment and last for the part's duration: each Order
            // is a lever for the attacks made while it lasts, as a stance option is.
            if let Some(effect) = node
                .get("effect")
                .filter(|e| e.as_object().is_some_and(|o| is_str(o, "type", "issue-orders")))
            {
                let mut part_opts = opts.clone();
                if let Some(duration) = present(node, "duration") {
                    part_opts.duration = Some(duration.clone());
                }
                if let Some(usage) = present(node, "usage") {
                    part_opts.usage = Some(usage.clone());
                }
                walk(effect, &part_opts, out);
                return;
            }
            if let Some(trigger) = present(node, "trigger") {
                if let Some(bound) = selection::bind_event_subject(
                    Some(trigger),
                    node.get("effect").unwrap_or(&Value::Null),
                    opts.context,
                    opts.perspective,
                ) {
                    let mut part = node.clone();
                    part.insert("effect".into(), bound);
                    walk(&Value::Object(part), opts, out);
                    return;
                }
            }
            let mut part_opts = opts.clone();
            if let Some(duration) = present(node, "duration") {
                part_opts.duration = Some(duration.clone());
            }
            if let Some(usage) = present(node, "usage") {
                part_opts.usage = Some(usage.clone());
            }
            // A part firing on its own moment is gated like a timing-is step; one with only a
            // cost, a choice or a usage limit is an activation, as a named effect is.
            let activation = is_true(node, "optional")
                || present(node, "cost").is_some()
                || present(node, "usage").is_some();
            if activation {
                levers::named_effect(node, &part_opts, out);
            } else {
                let effect = node.get("effect").cloned().unwrap_or(Value::Null);
                let gated = levers::moment_gate_with_source(
                    node.get("trigger"),
                    &effect,
                    Some(node),
                )
                .unwrap_or(effect);
                walk(&gated, &part_opts, out);
            }
        }
        Some("choice") => levers::enumerate_choice(node, opts, out),
        Some("dice-gated") => out.unsupported(STOCHASTIC_DICE_GATED, node),
        Some("dice-pool-allocation") => levers::enumerate_dice_pool(node, opts, out),
        Some("roll") => {
            // A pool roll whose dice are allocated to named options is the same lever set
            // dice-pool-allocation produced; any other bound roll only scopes its nested effect.
            if !levers::enumerate_roll_allocation(node, opts, out) {
                walk(node.get("effect").unwrap_or(&Value::Null), opts, out);
            }
        }
        Some("select-objective") => out.unsupported(
            "select-objective: the bound objective marker is not resolved by the buff engine",
            node,
        ),
        Some("characteristic-resolution") => out.unsupported(
            "characteristic-resolution: which models' characteristic applies depends on the unit's model mix; not resolved by the buff engine",
            node,
        ),
        Some("borrow-weapons") => out.unsupported(
            "borrow-weapons: the passengers' weapons are not added to the Transport's profile by the buff engine",
            node,
        ),
        Some("select-weapon") => out.unsupported(
            "select-weapon: a bound weapon is not resolved by the buff engine",
            node,
        ),
        Some("select-units") => walk(node.get("effect").unwrap_or(&Value::Null), opts, out),
        Some("aura") => aura(node, opts, out),
        Some("persistent-designation") => out.unsupported(
            "persistent-designation: retained selection state is not resolved by the buff engine",
            node,
        ),
        Some("designate-target") => {
            let applies = object(node.get("applies"));
            if applies.is_some_and(|a| {
                is_str(a, "to", "attackers-of-target") || is_str(a, "to", "bearer-attacks-target")
            }) {
                for key in ["attacker_filter", "attacker_unit_filter"] {
                    if let Some(filter) = applies.and_then(|applies| applies.get(key)) {
                        match conditions::matches_unit_filter(filter, opts.context, TranslationPerspective::Attacker, "friendly") {
                            Some(false) => return,
                            None => {
                                out.unsupported("designate-target attacker filter is unresolved", node);
                                return;
                            }
                            Some(true) => {}
                        }
                    }
                }
                // A designation restricted to units the target is not (e.g. an enemy VEHICLE)
                // never marks it.
                let selector_filter = object(node.get("select"))
                    .filter(|select| is_str(select, "kind", "unit"))
                    .and_then(|select| object(select.get("selector")))
                    .and_then(|selector| selector.get("filter"));
                if let Some(filter) = selector_filter {
                    if conditions::matches_unit_filter(filter, opts.context, TranslationPerspective::Target, "enemy") == Some(false) {
                        return;
                    }
                }
                // Which enemy unit is designated is the player's pick, so its buffs are one opt-in
                // lever ("this defender is the designated unit"); the player vouches for the
                // selection's eligibility (range, visibility, "hit by those attacks").
                let effect = applies.and_then(|a| a.get("effect"));
                let mut sub = Out::default();
                walk(effect.unwrap_or(&Value::Null), opts, &mut sub);
                out.unsupported.extend(sub.unsupported);
                let requirement = Value::Object(
                    ["select", "duration"]
                        .into_iter()
                        .filter_map(|key| {
                            node.get(key)
                                .map(|value| (key.into(), value.clone()))
                        })
                        .collect(),
                );
                for mut lever in sub.activatable {
                    let mut requirements = vec![requirement.clone()];
                    requirements.extend(lever.requires.take().unwrap_or_default());
                    lever.requires = Some(requirements);
                    out.activatable.push(lever);
                }
                if !sub.applied.is_empty() {
                    let designation = node
                        .get("designation")
                        .and_then(Value::as_str)
                        .unwrap_or("designated");
                    out.activatable.push(Lever {
                        id: format!("{}#{designation}", opts.ability_id),
                        label: format!(
                            "Designated target: {}",
                            applicability::label_for_buffs(&sub.applied)
                        ),
                        buffs: sub.applied,
                        group: None,
                        requires: Some(vec![requirement]),
                        cap_raise: None,
                        gate: None,
                    });
                }
            } else {
                out.unsupported(
                    "designate-target debuff on the marked unit: not a buff on the bearer",
                    node,
                );
            }
        }
        Some("risk-reward") => walk(node.get("reward").unwrap_or(&Value::Null), opts, out),
        Some("stance-select") => {
            let group = format!("{}?stance", opts.ability_id);
            levers::enumerate_named_options(node, opts, out, &group, node.get("max_choices").and_then(Value::as_i64).unwrap_or(1));
        }
        Some("issue-orders") => {
            let group = format!("{}?order", opts.ability_id);
            levers::enumerate_named_options(node, opts, out, &group, 1);
        }
        Some("resource-action-menu") => levers::enumerate_menu_actions(node, opts, out),
        Some("roll-result") => damage_leaves::roll_result(node, opts, out),
        Some("ignore-modifiers") => damage_leaves::ignore_modifiers(node, opts, out),
        Some("ability-grant") => damage_leaves::ability_grant(node, opts, out),
        Some("ability-modifier") => selection::ability_modifier(node, opts, out),
        Some("stance-selection-capacity") => selection::stance_capacity(node, opts, out),
        Some("rule-state") => {
            let modifier = object(node.get("modifier"));
            let persistent = modifier.is_some_and(|modifier| modifier.get("rule").is_some_and(Value::is_object)
                || is_str(modifier, "direction", "exchanged") || modifier.contains_key("except_from"));
            out.unsupported(if persistent {
                "rule-state: persistent ability ownership and suppression are not resolved by the buff engine"
            } else {
                "effect type \"rule-state\" is not modelled by the buff layer"
            }, node);
        }
        _ => out.unsupported(
            format!(
                "effect type \"{}\" is not modelled by the buff layer",
                js_string(ty)
            ),
            node,
        ),
    }
}

fn aura(node: &Obj, opts: &WalkOpts, out: &mut Out) {
    let modifier = object(node.get("modifier"));
    // An aura's own target names the side it reaches: friendly recipients are the buffed side.
    let side = match node.get("target").and_then(Value::as_str) {
        Some("friendly-within-aura") => Side::Buffed,
        Some("enemy-within-aura") => Side::Defender,
        _ => Side::Unknown,
    };
    if side == Side::Unknown
        || (side == Side::Defender && opts.perspective != TranslationPerspective::Target)
    {
        return;
    }
    if let Some(filter) = modifier.and_then(|m| m.get("recipient_filter")) {
        match conditions::matches_unit_filter(
            filter,
            opts.context,
            opts.perspective,
            if side == Side::Defender {
                "enemy"
            } else {
                "friendly"
            },
        ) {
            Some(false) => return,
            None => {
                out.unsupported(
                    "aura recipient keywords are unavailable or its filter is malformed",
                    node,
                );
                return;
            }
            Some(true) => {}
        }
    }
    if let Some(filter) = modifier.and_then(|m| m.get("emitter_filter")) {
        if conditions::evaluate_keyword_filter(filter, None) != Some(true) {
            out.unsupported(
                "aura emitter filter requires the source unit's keywords",
                node,
            );
            return;
        }
    }
    match modifier
        .and_then(|m| m.get("effect"))
        .filter(|e| e.is_object())
    {
        Some(effect) => walk(effect, opts, out),
        None => out.unsupported("aura without nested effect: not a combat buff", node),
    }
}

/// Which side of an attack a node's target names.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    Buffed,
    Attacker,
    Defender,
    Unknown,
}

/// Classify a node's `target` against the buffed unit.
pub(crate) fn classify_target(node: &Obj) -> Side {
    match node.get("target") {
        // A unit filter reaches every unit it matches: friendly ones are the buffed side.
        Some(Value::Object(t))
            if !t.contains_key("event_var") && !t.contains_key("selection_var") =>
        {
            if is_str(t, "member_of", "attacker") {
                return Side::Attacker;
            }
            if is_str(t, "member_of", "defender") {
                return Side::Defender;
            }
            match t.get("owner").and_then(Value::as_str) {
                None | Some("any") if t.get("unit_ids").is_some_and(Value::is_array) => {
                    Side::Buffed
                }
                Some("friendly") => Side::Buffed,
                None if is_str(t, "member_of", "this-unit") => Side::Buffed,
                Some("enemy") => Side::Defender,
                _ => Side::Unknown,
            }
        }
        Some(Value::String(t)) => match t.as_str() {
            "attacker" => Side::Attacker,
            "defender" => Side::Defender,
            "this-unit" | "ability-unit" | "this-model" | "selected-unit" | "recipient" => {
                Side::Buffed
            }
            _ => Side::Unknown,
        },
        _ => Side::Unknown,
    }
}

/// Does this node's target match the buffed unit under `perspective`?
pub(crate) fn applies_to_buffed_unit(node: &Obj, perspective: TranslationPerspective) -> bool {
    match classify_target(node) {
        Side::Buffed => true,
        Side::Attacker => perspective == TranslationPerspective::Attacker,
        Side::Defender => perspective == TranslationPerspective::Target,
        Side::Unknown => false,
    }
}

/// Why a leaf's size cannot be read here: a `scaling` block, or a value bound to the battle
/// size, a roll or a count.
fn unsized_value_reason(node: &Obj) -> Option<String> {
    let modifier = object(node.get("modifier"))?;
    let ty = node.get("type").and_then(Value::as_str)?;
    if let Some(scaling) = object(node.get("scaling")) {
        return Some(format!(
            "{ty}: the value scales with {}; not resolved by the buff engine",
            js_string(scaling.get("of"))
        ));
    }
    for field in ["value", "count", "amount"] {
        let Some(v) = object(modifier.get(field)) else {
            continue;
        };
        let what = if v.get("roll_var").is_some_and(Value::is_string) {
            "a bound roll".to_string()
        } else if let Some(of) = v.get("count_of").and_then(Value::as_str) {
            format!("the number of {of}")
        } else {
            "the battle size".to_string()
        };
        return Some(format!(
            "{ty}: its {field} is set by {what}; not resolved by the buff engine"
        ));
    }
    None
}

fn has_unresolved_fidelity_binding(node: &Obj) -> bool {
    let ty = node.get("type").and_then(Value::as_str);
    let has = |o: Option<&Obj>, k: &str| o.is_some_and(|o| present(o, k).is_some());
    match ty {
        Some("select-units" | "for-each-unit") => object(node.get("selector")).is_some(),
        // A designation's own selection (range, visibility, eligibility) is what its lever's
        // player vouches for; only the applied effect's bindings are unresolved.
        Some("designate-target") => {
            let applies = object(node.get("applies"));
            ["beneficiary", "reference"].iter().any(|k| has(applies, k))
        }
        Some("ability-part") => has_unresolved_trigger_binding(node.get("trigger")),
        _ => false,
    }
}

fn has_unresolved_trigger_binding(trigger: Option<&Value>) -> bool {
    match trigger {
        Some(Value::Array(a)) => a.iter().any(|t| has_unresolved_trigger_binding(Some(t))),
        Some(Value::Object(t)) => {
            object(t.get("filter")).is_some_and(|f| present(f, "by").is_some())
                || present(t, "source_ability").is_some()
        }
        _ => false,
    }
}

/// `v` without null-valued object keys (the TS oracle reads the authored JSON, which omits them).
pub fn strip_nulls(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, x)| !x.is_null())
                .map(|(k, x)| (k.clone(), strip_nulls(x)))
                .collect::<Map<_, _>>(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip_nulls).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests;
