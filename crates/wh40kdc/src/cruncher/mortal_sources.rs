//! Mortal wounds an ability inflicts on an enemy unit outside an attack: after a Charge move, at
//! the start of a phase, when a unit is selected. Each is a [`MortalWoundSource`]: the expected
//! number of mortal wounds the target suffers each time its moment comes, before Feel No Pain.
//!
//! Mortal wounds an attack's own hit or wound rolls inflict are not sources; the buff layer turns
//! them into a `mortal-wounds-on-roll` contribution the engine applies per attack. Mirrors
//! `tools/src/cruncher/mortal-sources.ts`; `conformance/abilities-resolver/mortal-sources.json`
//! pins both.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::buffs::EngineContext;
use super::condition_facts::{condition_needs, ConditionNeed};
use super::damage_roll::quantity_distribution;
use super::from_dsl::conditions::evaluate_condition;
use super::from_dsl::{TranslationPerspective, UnsupportedFragment};

type Obj = Map<String, Value>;
type Dist = Vec<(f64, f64)>;

/// Mortal wounds one ability inflicts on the target at one moment.
#[derive(Clone, Debug, PartialEq)]
pub struct MortalWoundSource {
    /// The ability id, then `?<option index>` for each enclosing `choice` option.
    pub id: String,
    /// When they are inflicted: the trigger's event and its distinguishing filter value
    /// (`move-ended:charge`, `phase-started:shooting`), or `None` for an ability with no trigger.
    pub moment: Option<String>,
    /// Expected mortal wounds the target suffers each time the moment comes, before Feel No Pain,
    /// when every condition in `needs` holds.
    pub expected: f64,
    /// Leaf conditions the context leaves undecided; answering one false removes the source.
    pub needs: Vec<ConditionNeed>,
}

/// The sources an effect yields and the fragments that could not be modelled.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MortalWoundTranslation {
    pub sources: Vec<MortalWoundSource>,
    pub unsupported: Vec<UnsupportedFragment>,
}

#[derive(Clone)]
struct WalkState {
    probability: f64,
    moment: Option<String>,
    needs: Vec<ConditionNeed>,
    id: String,
    /// Whether the nearest enclosing `select-units` selects enemy units.
    selected_enemy: Option<bool>,
    /// Whether the nearest trigger's subject is an enemy unit.
    subject_enemy: Option<bool>,
    /// Whether the nearest `for-each-unit` reaches enemy units.
    recipient_enemy: Option<bool>,
}

const SELF_TARGETS: &[&str] = &["this-unit", "this-model", "bearer", "self", "attacker"];

/// JS `String(v)` for the values these reasons print.
fn js_str(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".to_string(),
        Some(other) => other.to_string(),
    }
}

/// JS `JSON.stringify(v)`; `None` is `undefined`.
fn stringify(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(v) => v.to_string(),
    }
}

fn as_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// The mortal wounds `effect` (with the record's own `trigger`) inflicts on an enemy unit outside
/// an attack. A condition the context leaves undecided is reported as a need and assumed to hold;
/// one it decides false removes what it gates. `phase-is` conditions never gate a source: the
/// moment names when it happens, whatever phase the attack is made in. Mortal wounds the
/// ability's own unit suffers are not sources.
pub fn mortal_wound_sources(
    ability_id: &str,
    effect: &Value,
    trigger: &Value,
    context: &EngineContext,
    rating: Option<&Value>,
) -> MortalWoundTranslation {
    let mut walker = Walker {
        ctx: context,
        rating,
        sources: Vec::new(),
        unsupported: Vec::new(),
    };
    let start = WalkState {
        probability: 1.0,
        moment: None,
        needs: Vec::new(),
        id: ability_id.to_string(),
        selected_enemy: None,
        subject_enemy: None,
        recipient_enemy: None,
    };
    if let Some(start) = walker.enter_trigger(trigger, start) {
        walker.walk(effect, start);
    }
    MortalWoundTranslation {
        sources: walker
            .sources
            .into_iter()
            .filter(|source| source.expected > 0.0)
            .collect(),
        unsupported: walker.unsupported,
    }
}

struct Walker<'a> {
    ctx: &'a EngineContext,
    rating: Option<&'a Value>,
    sources: Vec<MortalWoundSource>,
    unsupported: Vec<UnsupportedFragment>,
}

impl Walker<'_> {
    fn report(&mut self, node: &Value, reason: impl Into<String>) {
        self.unsupported.push(UnsupportedFragment {
            reason: reason.into(),
            effect_fragment: node.clone(),
            needs: None,
        });
    }

    /// The state once `raw` holds, or `None` when the context decides it false. A condition the
    /// context leaves undecided adds its leaves as needs.
    fn decide(&self, raw: Option<&Value>, state: WalkState) -> Option<WalkState> {
        let Some(condition) = without_phase(raw) else {
            return Some(state);
        };
        let perspective = TranslationPerspective::Attacker;
        match evaluate_condition(&condition, self.ctx, perspective) {
            Some(false) => None,
            Some(true) => Some(state),
            None => {
                let needs = condition_needs(&condition, perspective, |node| {
                    evaluate_condition(node, self.ctx, perspective)
                })
                .into_iter()
                .filter(|need| {
                    need.condition.get("type").and_then(Value::as_str) != Some("timing-is")
                });
                let mut state = state;
                state.needs = merge_needs(state.needs, needs.collect());
                Some(state)
            }
        }
    }

    fn enter_trigger(&self, value: &Value, state: WalkState) -> Option<WalkState> {
        let triggers: Vec<&Obj> = match value {
            Value::Array(items) => items.iter().filter_map(Value::as_object).collect(),
            Value::Object(object) => vec![object],
            _ => Vec::new(),
        };
        if triggers.is_empty() {
            return Some(state);
        }
        let mut next = state;
        next.moment = Some(
            triggers
                .iter()
                .map(|trigger| moment_of(trigger))
                .collect::<Vec<_>>()
                .join("|"),
        );
        let owners: Vec<Option<&Value>> = triggers
            .iter()
            .map(|item| {
                item.get("subject")
                    .and_then(Value::as_object)
                    .and_then(|subject| subject.get("owner"))
            })
            .collect();
        // A nested moment with no subject of its own ("roll for that unit") keeps the enclosing one.
        if owners.iter().any(Option::is_some) {
            let all = |wanted: &str| {
                owners
                    .iter()
                    .all(|owner| owner.and_then(Value::as_str) == Some(wanted))
            };
            next.subject_enemy = if all("enemy") {
                Some(true)
            } else if all("friendly") {
                Some(false)
            } else {
                None
            };
        }
        // Alternative moments are each enough on their own; only a single trigger's condition gates.
        if triggers.len() == 1 {
            return self.decide(triggers[0].get("condition"), next);
        }
        Some(next)
    }

    fn walk(&mut self, node: &Value, state: WalkState) {
        let Some(object) = node.as_object() else {
            return;
        };
        if state.probability == 0.0 {
            return;
        }
        match object.get("type").and_then(Value::as_str) {
            Some("sequence" | "rules-bundle") => {
                for step in array(object.get("steps")) {
                    self.walk(step, state.clone());
                }
            }
            Some("ability-part") => {
                let next = match object.get("trigger") {
                    None | Some(Value::Null) => Some(state),
                    Some(trigger) => self.enter_trigger(trigger, state),
                };
                if let Some(next) = next {
                    self.walk(object.get("effect").unwrap_or(&Value::Null), next);
                }
            }
            Some("conditional") => {
                if let Some(next) = self.decide(object.get("condition"), state) {
                    self.walk(object.get("effect").unwrap_or(&Value::Null), next);
                }
            }
            Some("select-units") => {
                let selector = obj_of(object.get("selector"));
                let owner = obj_of(selector.get("filter"))
                    .get("owner")
                    .and_then(Value::as_str);
                let mut state = state;
                state.selected_enemy = match owner {
                    Some("enemy") => Some(true),
                    Some("friendly") => Some(false),
                    _ => None,
                };
                if let Some(next) = self.decide(selector.get("eligibility"), state) {
                    self.walk(object.get("effect").unwrap_or(&Value::Null), next);
                }
            }
            Some("for-each-unit") => {
                let selector = obj_of(object.get("selector"));
                let filter = obj_of(selector.get("filter"));
                let owner = filter.get("owner").and_then(Value::as_str);
                if owner != Some("enemy") {
                    let effect = object.get("effect").unwrap_or(&Value::Null);
                    if owner != Some("friendly") && contains_mortal_wounds(effect) {
                        self.report(
                            node,
                            "mortal-wounds: for-each-unit reaches units of either side",
                        );
                    }
                    return;
                }
                if let Some(mut next) = self.reaches(filter, state) {
                    next.recipient_enemy = Some(true);
                    self.walk(object.get("effect").unwrap_or(&Value::Null), next);
                }
            }
            Some("roll") => self.walk(object.get("effect").unwrap_or(&Value::Null), state),
            Some("choice") => {
                for (index, option) in array(object.get("options")).iter().enumerate() {
                    let mut option_state = state.clone();
                    option_state.id = format!("{}?{index}", state.id);
                    self.walk(option, option_state);
                }
            }
            Some("dice-gated") => {
                let Some(success) = gate_probability(object) else {
                    self.report(
                        node,
                        "dice-gated: only a fixed threshold on rolled dice is modelled",
                    );
                    return;
                };
                let mut on_success = state.clone();
                on_success.probability *= success;
                self.walk(object.get("on_success").unwrap_or(&Value::Null), on_success);
                let mut on_fail = state;
                on_fail.probability *= 1.0 - success;
                self.walk(object.get("on_fail").unwrap_or(&Value::Null), on_fail);
            }
            Some("dice-table") => {
                if object.get("distinct") == Some(&Value::Bool(true)) {
                    self.report(node, "dice-table: distinct results are not modelled");
                    return;
                }
                let faces = if object.get("dice").and_then(Value::as_str) == Some("D3") {
                    3.0
                } else {
                    6.0
                };
                let dice = as_f64(object.get("count")).unwrap_or(1.0);
                for outcome in array(object.get("outcomes")) {
                    let Some(outcome) = outcome.as_object() else {
                        continue;
                    };
                    let Some(results) = outcome.get("results").and_then(Value::as_array) else {
                        continue;
                    };
                    let hits = results
                        .iter()
                        .filter_map(Value::as_f64)
                        .filter(|face| *face >= 1.0 && *face <= faces)
                        .count() as f64;
                    let mut next = state.clone();
                    next.probability *= dice * (hits / faces);
                    self.walk(outcome.get("effect").unwrap_or(&Value::Null), next);
                }
            }
            Some("mortal-wounds") => self.inflict(node, state),
            _ => {
                if contains_mortal_wounds(node) {
                    let reason = format!(
                        "mortal-wounds inside \"{}\" are not modelled",
                        js_str(object.get("type"))
                    );
                    self.report(node, reason);
                }
            }
        }
    }

    /// The state once the target is one of the units `filter` reaches, or `None` when the context
    /// rules it out. Its range and other unit facts are needs on the target.
    fn reaches(&self, filter: &Obj, state: WalkState) -> Option<WalkState> {
        let rest: Obj = filter
            .iter()
            .filter(|(key, _)| key.as_str() != "owner")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        if rest.is_empty() {
            return Some(state);
        }
        let condition = json!({
            "type": "matches",
            "parameters": { "subject": "target", "filter": rest },
        });
        self.decide(Some(&condition), state)
    }

    fn inflict(&mut self, node: &Value, mut state: WalkState) {
        let object = node.as_object().expect("a mortal-wounds node is an object");
        if let Some(target) = object.get("target").and_then(Value::as_object) {
            let owner = target.get("owner").and_then(Value::as_str);
            if matches!(owner, Some("enemy" | "any"))
                && !target.contains_key("selection_var")
                && !target.contains_key("event_var")
            {
                if let Some(next) = self.reaches(target, state) {
                    let mut rewritten = object.clone();
                    rewritten.insert("target".into(), json!("defender"));
                    self.inflict(&Value::Object(rewritten), next);
                }
                return;
            }
        }
        let target = object.get("target");
        match target_is_enemy(target, &state) {
            Some(false) => return,
            None => {
                let reason = format!(
                    "mortal-wounds: cannot tell whether {} is the target",
                    stringify(target)
                );
                self.report(node, reason);
                return;
            }
            Some(true) => {}
        }
        let empty = Obj::new();
        let modifier = object
            .get("modifier")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let roll = modifier
            .get("roll")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let mut models = None;
        if roll.contains_key("per_model") || roll.contains_key("for_each") {
            match self.models_rolling(roll, state) {
                Err(reason) => {
                    self.report(node, format!("mortal-wounds: {reason}"));
                    return;
                }
                Ok((_, None)) => return,
                Ok((counted, Some(next))) => {
                    models = Some(counted);
                    state = next;
                }
            }
        }
        let expected = match self.expected_mortal_wounds(modifier, models) {
            Ok(expected) => expected,
            Err(reason) => {
                self.report(node, format!("mortal-wounds: {reason}"));
                return;
            }
        };
        let contributed = state.probability * expected;
        match self
            .sources
            .iter_mut()
            .find(|source| source.id == state.id && source.moment == state.moment)
        {
            Some(existing) => {
                existing.expected += contributed;
                existing.needs = merge_needs(std::mem::take(&mut existing.needs), state.needs);
            }
            None => self.sources.push(MortalWoundSource {
                id: state.id,
                moment: state.moment,
                expected: contributed,
                needs: state.needs,
            }),
        }
    }

    /// How many models roll dice for a per-model roll, or why that is not known.
    #[allow(clippy::type_complexity)]
    fn models_rolling(
        &self,
        roll: &Obj,
        state: WalkState,
    ) -> Result<(u32, Option<WalkState>), String> {
        let own = self.ctx.attacker_model_count;
        let target = self.ctx.target_model_count;
        if let Some(reference) = roll.get("per_model") {
            let on_target = reference
                .as_str()
                .and_then(|name| target_is_enemy(Some(&json!(name)), &state));
            let is_own = reference.as_str() == Some("this-unit");
            if !is_own && on_target != Some(true) {
                return Err(format!(
                    "dice rolled for each model of {} are not modelled",
                    stringify(Some(reference))
                ));
            }
            let count = if is_own { own } else { target };
            return count
                .map(|models| (models, Some(state)))
                .ok_or_else(|| "the number of models rolling is not in the context".to_string());
        }
        let empty = Obj::new();
        let each = obj_of_or(roll.get("for_each"), &empty);
        let filter = obj_of_or(each.get("filter"), &empty);
        let own_models = filter.get("level").and_then(Value::as_str) == Some("model")
            && filter.get("member_of").and_then(Value::as_str) == Some("this-unit")
            && filter
                .keys()
                .all(|key| matches!(key.as_str(), "level" | "member_of" | "owner"));
        if !own_models {
            return Err("dice rolled for each of a subset of models are not modelled".into());
        }
        let Some(own) = own else {
            return Err("the number of models rolling is not in the context".into());
        };
        // Which of the unit's models meet the eligibility is a fact about all of them: answered
        // yes, every model rolls.
        Ok((own, self.decide(each.get("eligibility"), state)))
    }

    /// Expected mortal wounds from a `mortal-wounds` modifier, or why it cannot be computed.
    fn expected_mortal_wounds(&self, modifier: &Obj, models: Option<u32>) -> Result<f64, String> {
        for key in modifier.keys() {
            if !matches!(key.as_str(), "count" | "max" | "per" | "roll" | "psychic") {
                return Err(format!("{key} is not modelled"));
            }
        }
        let count = modifier.get("count");
        let rated = count
            .and_then(Value::as_object)
            .is_some_and(|c| c.get("rating") == Some(&Value::Bool(true)));
        let not_quantity = || format!("count {} is not a fixed or dice quantity", stringify(count));
        let per_wound: Dist = if rated {
            match self.rating {
                None => Vec::new(),
                Some(rating) => quantity_distribution(rating).map_err(|_| not_quantity())?,
            }
        } else {
            quantity_distribution(count.unwrap_or(&Value::Null)).map_err(|_| not_quantity())?
        };
        if per_wound.is_empty() {
            return Err("count follows the ability's rating, which is not given".into());
        }
        let mut total = per_wound.clone();
        if modifier.contains_key("roll") || modifier.contains_key("per") {
            let roll = modifier.get("roll").and_then(Value::as_object);
            let per = modifier.get("per");
            let Some(roll) = roll.filter(|_| per.and_then(Value::as_str) == Some("success")) else {
                return Err(format!("per {} is not modelled", js_str(per)));
            };
            let mut dice = quantity_distribution(roll.get("dice").unwrap_or(&Value::Null))
                .map_err(|_| {
                    format!(
                        "dice {} is not a fixed or dice quantity",
                        stringify(roll.get("dice"))
                    )
                })?;
            // Dice for each model: the per-model dice, rolled once for every model.
            if let Some(models) = models {
                dice = sum_distribution(&dice, models);
            }
            let comparison = roll
                .get("comparison")
                .and_then(Value::as_str)
                .unwrap_or("gte");
            let Some(success) = face_probability(js_number(roll.get("threshold")), comparison)
            else {
                return Err(format!(
                    "threshold {} is not modelled",
                    stringify(roll.get("threshold"))
                ));
            };
            total = success_totals(&dice, success, &per_wound);
        }
        let max = as_f64(modifier.get("max")).unwrap_or(f64::INFINITY);
        Ok(total
            .iter()
            .map(|(value, probability)| value.min(max) * probability)
            .sum())
    }
}

/// JS `Number(v)` for the thresholds these rows carry: a number, a numeric string, else NaN.
fn js_number(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(f64::NAN),
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Null) => 0.0,
        _ => f64::NAN,
    }
}

fn array(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn obj_of(v: Option<&Value>) -> &Obj {
    static EMPTY: std::sync::OnceLock<Obj> = std::sync::OnceLock::new();
    v.and_then(Value::as_object)
        .unwrap_or_else(|| EMPTY.get_or_init(Obj::new))
}

fn obj_of_or<'a>(v: Option<&'a Value>, empty: &'a Obj) -> &'a Obj {
    v.and_then(Value::as_object).unwrap_or(empty)
}

/// The condition with its `phase-is` leaves taken as satisfied (a compound keeps its other
/// operands), or `None` when nothing else remains. A negated `phase-is` is satisfied too.
fn without_phase(condition: Option<&Value>) -> Option<Obj> {
    let condition = condition?.as_object()?;
    if condition.get("type").and_then(Value::as_str) == Some("phase-is") {
        return None;
    }
    let (Some(operator), Some(operands)) = (
        condition.get("operator").and_then(Value::as_str),
        condition.get("operands").and_then(Value::as_array),
    ) else {
        return Some(condition.clone());
    };
    let mut kept: Vec<Obj> = operands
        .iter()
        .filter_map(|operand| without_phase(Some(operand)))
        .collect();
    if kept.is_empty() {
        return None;
    }
    if operator == "not" && kept.len() != operands.len() {
        return None;
    }
    if operator != "not" && kept.len() == 1 {
        return kept.pop();
    }
    let mut out = condition.clone();
    out.insert(
        "operands".into(),
        Value::Array(kept.into_iter().map(Value::Object).collect()),
    );
    Some(out)
}

/// The trigger's event and the filter value that tells its moments apart.
fn moment_of(trigger: &Obj) -> String {
    let empty = Obj::new();
    let filter = obj_of_or(trigger.get("filter"), &empty);
    let move_types = filter
        .get("move_types")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| js_str(Some(item)))
                .collect::<Vec<_>>()
                .join("+")
        });
    let string = |key: &str| filter.get(key).and_then(Value::as_str).map(str::to_string);
    let detail = [
        string("phase"),
        string("to"),
        string("kind"),
        string("roll"),
        move_types,
        string("from"),
    ]
    .into_iter()
    .flatten()
    .find(|value| !value.is_empty());
    let event = js_str(trigger.get("event"));
    match detail {
        Some(detail) => format!("{event}:{detail}"),
        None => event,
    }
}

/// True when the mortal wounds land on an enemy unit, false on the ability's own side, `None`
/// when unknown.
fn target_is_enemy(target: Option<&Value>, state: &WalkState) -> Option<bool> {
    match target? {
        Value::String(name) => {
            let name = name.as_str();
            if SELF_TARGETS.contains(&name) {
                return Some(false);
            }
            match name {
                "defender" => Some(true),
                "selected-unit" => state.selected_enemy,
                "event-subject" => state.subject_enemy,
                "recipient" => state.recipient_enemy,
                _ => None,
            }
        }
        Value::Object(object)
            if object.get("owner").and_then(Value::as_str) == Some("friendly") =>
        {
            Some(false)
        }
        _ => None,
    }
}

/// Distribution of the summed counts over the dice that succeed.
fn success_totals(dice: &Dist, success: f64, count: &Dist) -> Dist {
    let mut out: BTreeMap<i64, f64> = BTreeMap::new();
    for (n, pn) in dice {
        let n = *n as usize;
        let mut sums: BTreeMap<i64, f64> = BTreeMap::from([(0, 1.0)]);
        for k in 0..=n {
            let pk = binomial(n, k) * success.powi(k as i32) * (1.0 - success).powi((n - k) as i32);
            for (value, probability) in &sums {
                *out.entry(*value).or_insert(0.0) += pn * pk * probability;
            }
            sums = convolve(&sums, count);
        }
    }
    out.into_iter().map(|(v, p)| (v as f64, p)).collect()
}

/// Distribution of the sum of `times` independent draws.
fn sum_distribution(draw: &Dist, times: u32) -> Dist {
    let mut sums: BTreeMap<i64, f64> = BTreeMap::from([(0, 1.0)]);
    for _ in 0..times {
        sums = convolve(&sums, draw);
    }
    sums.into_iter().map(|(v, p)| (v as f64, p)).collect()
}

fn convolve(left: &BTreeMap<i64, f64>, right: &Dist) -> BTreeMap<i64, f64> {
    let mut out = BTreeMap::new();
    for (a, pa) in left {
        for (b, pb) in right {
            *out.entry(a + *b as i64).or_insert(0.0) += pa * pb;
        }
    }
    out
}

fn binomial(n: usize, k: usize) -> f64 {
    let mut result = 1.0;
    for i in 1..=k {
        result = (result * (n - k + i) as f64) / i as f64;
    }
    result
}

/// Probability one D6 meets `threshold` under `comparison`; `None` for a threshold that is not a
/// face.
fn face_probability(threshold: f64, comparison: &str) -> Option<f64> {
    if !threshold.is_finite() || threshold.fract() != 0.0 {
        return None;
    }
    let faces = (1..=6)
        .filter(|face| compare(f64::from(*face), threshold, comparison))
        .count();
    Some(faces as f64 / 6.0)
}

/// Probability a `dice-gated` node succeeds; `None` when it is not a fixed threshold on rolled
/// dice.
fn gate_probability(node: &Obj) -> Option<f64> {
    if node.contains_key("test") || node.contains_key("from") || node.contains_key("requirement") {
        return None;
    }
    let threshold = node.get("threshold").and_then(Value::as_f64)?;
    let dice = quantity_distribution(node.get("dice").unwrap_or(&json!("D6"))).ok()?;
    let comparison = node
        .get("comparison")
        .and_then(Value::as_str)
        .unwrap_or("gte");
    Some(
        dice.iter()
            .map(|(value, probability)| {
                if compare(*value, threshold, comparison) {
                    *probability
                } else {
                    0.0
                }
            })
            .sum(),
    )
}

fn compare(value: f64, threshold: f64, comparison: &str) -> bool {
    match comparison {
        "lte" => value <= threshold,
        "lt" => value < threshold,
        "gt" => value > threshold,
        "eq" => value == threshold,
        _ => value >= threshold,
    }
}

fn merge_needs(left: Vec<ConditionNeed>, right: Vec<ConditionNeed>) -> Vec<ConditionNeed> {
    let mut out = left;
    for need in right {
        if !out.iter().any(|existing| existing.key == need.key) {
            out.push(need);
        }
    }
    out
}

fn contains_mortal_wounds(node: &Value) -> bool {
    match node {
        Value::Array(items) => items.iter().any(contains_mortal_wounds),
        Value::Object(object) => {
            object.get("type").and_then(Value::as_str) == Some("mortal-wounds")
                || object.values().any(contains_mortal_wounds)
        }
        _ => false,
    }
}
