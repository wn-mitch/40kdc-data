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
//! filter) is the buffed side; `defender` and an enemy filter are the other side; any other
//! binding is not known to be the buffed unit and contributes nothing. Core rule 19.04: a
//! `this-model` effect pooled in from another member of a combined unit stays on its model.

mod applicability;
mod conditions;
mod js;
mod leaves;
mod levers;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::buffs::{AbilityKind, Buff, BuffSource, EngineContext};
use js::*;

pub use leaves::parse_keyword_grant;
pub use levers::{is_attack_step, moment_gate, moment_key};

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
    /// Contributions this activation adds when the player opts in (at least one).
    pub buffs: Vec<Buff>,
    /// Set when the lever belongs to a mutually-limited pool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<ActivatableGroupRef>,
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
pub(crate) struct WalkOpts<'a> {
    context: &'a EngineContext,
    perspective: TranslationPerspective,
    ability_id: String,
    source: Value,
    ability_kind: Option<AbilityKind>,
}

const STOCHASTIC_DICE_GATED: &str = "dice-gated effect: stochastic; not expressible as a buff";
const MODEL_SCOPED_REASON: &str =
    "model-scoped effect from an attached model: applies to that model only (core rule 19.04)";
const FIDELITY_BINDING_REASON: &str =
    "selection/history/model/attack predicates are not resolved by the buff engine";

/// Walk an ability DSL `effect` tree and produce the buff stack it contributes against
/// `context` from `perspective`, plus the fragments the buff layer cannot express.
pub fn effect_to_buffs(
    effect: &Value,
    source: &BuffSource,
    context: &EngineContext,
    perspective: TranslationPerspective,
) -> EffectTranslation {
    let (ability_id, ability_kind) = match source {
        BuffSource::Ability {
            ability_id,
            ability_kind,
            ..
        } => (ability_id.clone(), Some(ability_kind.clone())),
        _ => ("effect".to_string(), None),
    };
    let opts = WalkOpts {
        context,
        perspective,
        ability_id,
        source: serde_json::to_value(source).expect("a buff source serializes"),
        ability_kind,
    };
    let mut out = Out::default();
    walk(&strip_nulls(effect), &opts, &mut out);
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
            })
            .collect(),
    }
}

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
    if opts.ability_kind == Some(AbilityKind::Attached) && is_str(current, "target", "this-model") {
        out.unsupported(MODEL_SCOPED_REASON, current);
        return;
    }
    if has_unresolved_fidelity_binding(current) {
        out.unsupported(FIDELITY_BINDING_REASON, current);
        return;
    }
    // A scaled or bound value has no fixed size here: applying the printed value would misstate it.
    if let Some(reason) = unsized_value_reason(current) {
        out.unsupported(reason, current);
        return;
    }
    // An `incoming` change modifies attacks made against its target: the attacker's side of them.
    let modifier = object(current.get("modifier"));
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
            // A part firing on its own moment is gated like a timing-is step; one with only a
            // cost, a choice or a usage limit is an activation, as a named effect is.
            let activation = is_true(node, "optional")
                || present(node, "cost").is_some()
                || present(node, "usage").is_some();
            if present(node, "trigger").is_none() && activation {
                levers::named_effect(node, opts, out);
            } else {
                let effect = node.get("effect").cloned().unwrap_or(Value::Null);
                let gated = moment_gate(node.get("trigger"), &effect).unwrap_or(effect);
                walk(&gated, opts, out);
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
        Some("leader-model-ability-grant") => out.unsupported(
            "leader-model-ability-grant: attached leader beneficiary is not resolved by the buff engine",
            node,
        ),
        Some("persistent-designation") => out.unsupported(
            "persistent-designation: retained selection state is not resolved by the buff engine",
            node,
        ),
        Some("designate-target") => {
            let applies = object(node.get("applies"));
            if applies.is_some_and(|a| is_str(a, "to", "attackers-of-target")) {
                let effect = applies.and_then(|a| a.get("effect"));
                walk(effect.unwrap_or(&Value::Null), opts, out);
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
            levers::enumerate_named_options(node, opts, out, &group, 1);
        }
        Some("issue-orders") => {
            let group = format!("{}?order", opts.ability_id);
            levers::enumerate_named_options(node, opts, out, &group, 1);
        }
        Some("resource-action-menu") => levers::enumerate_menu_actions(node, opts, out),
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
        let keywords = if opts.perspective == TranslationPerspective::Attacker {
            opts.context.attacker_keywords.as_deref()
        } else {
            opts.context.target_keywords.as_deref()
        };
        match conditions::evaluate_keyword_filter(filter, keywords) {
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
            match t.get("owner").and_then(Value::as_str) {
                Some("friendly") => Side::Buffed,
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
    let truthy_flag = |o: Option<&Obj>, k: &str| o.is_some_and(|o| is_true(o, k));
    match ty {
        Some("select-units" | "for-each-unit") => {
            let sel = object(node.get("selector"));
            sel.is_some_and(|s| is_str(s, "target_kind", "model"))
                || [
                    "eligibility",
                    "reference",
                    "origin",
                    "selection_limit",
                    "bind_as",
                    "within_inches_from",
                    "visible_to",
                ]
                .iter()
                .any(|k| has(sel, k))
                || truthy_flag(sel, "visibility_required")
        }
        Some("designate-target") => {
            let select = object(node.get("select"));
            let applies = object(node.get("applies"));
            [
                "eligibility",
                "reference",
                "bind_as",
                "within_inches_from",
                "visible_to",
                "selection_limit",
            ]
            .iter()
            .any(|k| has(select, k))
                || truthy_flag(select, "visibility_required")
                || [
                    "attacker_keywords",
                    "attacker_unit_keywords",
                    "beneficiary",
                    "reference",
                ]
                .iter()
                .any(|k| has(applies, k))
        }
        Some("ability-part") => has_unresolved_trigger_binding(node.get("trigger")),
        Some("named-region-state") => {
            let consumer = object(node.get("modifier")).and_then(|m| object(m.get("consumer")));
            has(consumer, "attack_condition")
        }
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
