//! Condition evaluators that read declared scenario state: which rules are active, which regions
//! a unit is in, how many objectives each side controls, which units make up a combined unit and
//! which other units are near a unit. Each returns `None` (unknown) when the context does not
//! declare the fact it needs. Mirrors `tools/src/cruncher/scenario-conditions.ts`, the
//! `attachmentFromFlags` helper of `from-dsl.ts` and `withinNeighbour` in `unit-filter.ts`.

use serde_json::{Map, Value};

use super::buffs::{AbilityKind, AttachmentRole, BuffSource, EngineContext};
use super::from_dsl::TranslationPerspective;
use super::scenario::{
    ActiveRule, AttachedMember, MemberRole, NeighbourOwner, ObjectiveTerritory, ScenarioNeighbour,
    ScenarioRegion, ScenarioSide,
};

type Obj = Map<String, Value>;

const KEYWORD_CLAUSES: [&str; 4] = ["all_of", "any_of", "none_of", "not_all_of"];

fn other(side: TranslationPerspective) -> TranslationPerspective {
    match side {
        TranslationPerspective::Attacker => TranslationPerspective::Target,
        TranslationPerspective::Target => TranslationPerspective::Attacker,
    }
}

fn scenario_side(side: TranslationPerspective) -> ScenarioSide {
    match side {
        TranslationPerspective::Attacker => ScenarioSide::Attacker,
        TranslationPerspective::Target => ScenarioSide::Target,
    }
}

/// A value the TS evaluator treats as stated (`!== undefined`); a stripped `null` is absent.
fn stated(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| !value.is_null())
}

/// Every stated clause of a keyword predicate holds; empty `any_of` and `not_all_of` are false.
/// Mirrors `keywordMatchesPredicate` in `tools/src/scope.ts`.
fn keyword_predicate_holds(predicate: &[(&str, Vec<&str>)], keywords: &[String]) -> bool {
    let owned: Vec<String> = keywords
        .iter()
        .map(|k| crate::scope::keyword_key(k))
        .collect();
    let has = |keyword: &&str| owned.contains(&crate::scope::keyword_key(keyword));
    predicate.iter().all(|(clause, list)| match *clause {
        "all_of" => list.iter().all(has),
        "any_of" => list.iter().any(has),
        "none_of" => !list.iter().any(has),
        _ => !list.iter().all(has),
    })
}

/// The keyword clauses of a filter, or `None` when one is not a list of strings.
fn keyword_predicate(filter: &Obj) -> Option<Vec<(&'static str, Vec<&str>)>> {
    let mut predicate = Vec::new();
    for clause in KEYWORD_CLAUSES {
        let Some(value) = stated(filter.get(clause)) else {
            continue;
        };
        let list = value
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()?;
        predicate.push((clause, list));
    }
    Some(predicate)
}

/// `rule-active`: a rule id is active when it, or one of its options or definitions, is listed;
/// an option or definition reference needs that exact entry.
pub(crate) fn evaluate_rule_active(params: &Obj, ctx: &EngineContext) -> Option<bool> {
    let active = ctx.active_rules.as_ref()?;
    let rule = params.get("rule");
    if let Some(rule) = rule.and_then(Value::as_str) {
        return Some(active.iter().any(|entry| match entry {
            ActiveRule::Id(id) => id == rule,
            ActiveRule::Part { ability_id, .. } => ability_id == rule,
        }));
    }
    let rule = rule.and_then(Value::as_object)?;
    let ability = rule.get("ability_id").and_then(Value::as_str)?;
    let option = rule.get("option_id").and_then(Value::as_str);
    let definition = rule.get("definition_id").and_then(Value::as_str);
    if option.is_none() && definition.is_none() {
        return None;
    }
    Some(active.iter().any(|entry| match entry {
        ActiveRule::Id(_) => false,
        ActiveRule::Part {
            ability_id,
            option_id,
            definition_id,
        } => {
            ability_id == ability
                && match option {
                    Some(option) => option_id.as_deref() == Some(option),
                    None => definition_id.as_deref() == definition,
                }
        }
    }))
}

/// `in-region` for the unit on `side`. Territory and deployment zones are read from the
/// ability's side. "Wholly" and "every model" need an entry that declares the unit wholly in it.
pub(crate) fn evaluate_in_region(
    params: &Obj,
    ctx: &EngineContext,
    side: TranslationPerspective,
    ability_side: TranslationPerspective,
) -> Option<bool> {
    let regions = match side {
        TranslationPerspective::Attacker => ctx.attacker_regions.as_ref(),
        TranslationPerspective::Target => ctx.target_regions.as_ref(),
    }?;
    let region = params.get("region").and_then(Value::as_object)?;
    let models = stated(params.get("models"));
    if models.is_some_and(|models| !matches!(models.as_str(), Some("any" | "every"))) {
        return None;
    }
    let wholly = params.get("wholly") == Some(&Value::Bool(true))
        || models.and_then(Value::as_str) == Some("every");
    let matches = region_matcher(region, ability_side)?;
    Some(
        regions
            .iter()
            .any(|entry| matches(entry) && (!wholly || entry.wholly == Some(true))),
    )
}

type RegionMatcher = Box<dyn Fn(&ScenarioRegion) -> bool>;

fn region_matcher(region: &Obj, ability_side: TranslationPerspective) -> Option<RegionMatcher> {
    let mine = scenario_side(ability_side);
    let theirs = scenario_side(other(ability_side));
    let territory_of = |side: ScenarioSide| match side {
        ScenarioSide::Attacker => ObjectiveTerritory::Attacker,
        ScenarioSide::Target => ObjectiveTerritory::Target,
    };
    if let Some(territory) = region.get("territory").and_then(Value::as_str) {
        let territory_is = |want: ObjectiveTerritory| -> Option<RegionMatcher> {
            Some(Box::new(move |entry: &ScenarioRegion| {
                entry.territory == Some(want)
            }))
        };
        let zone_is = |want: ScenarioSide| -> Option<RegionMatcher> {
            Some(Box::new(move |entry: &ScenarioRegion| {
                entry.deployment_zone == Some(want)
            }))
        };
        return match territory {
            "your-territory" => territory_is(territory_of(mine)),
            "enemy-territory" => territory_is(territory_of(theirs)),
            "attacker-territory" => territory_is(ObjectiveTerritory::Attacker),
            "no-mans-land" => territory_is(ObjectiveTerritory::NoMansLand),
            "your-deployment-zone" => zone_is(mine),
            "enemy-deployment-zone" => zone_is(theirs),
            _ => None,
        };
    }
    if let Some(area) = region.get("terrain_area").and_then(Value::as_object) {
        // A designated terrain area needs designations the scenario does not carry.
        if stated(area.get("designated")).is_some() {
            return None;
        }
        return Some(Box::new(|entry: &ScenarioRegion| {
            entry.terrain_area == Some(true)
        }));
    }
    let id = region
        .get("rule_region")
        .and_then(Value::as_object)?
        .get("region_id")
        .and_then(Value::as_str)?
        .to_string();
    Some(Box::new(move |entry: &ScenarioRegion| {
        entry.rule_region.as_deref() == Some(id.as_str())
    }))
}

fn compare(left: f64, comparison: Option<&Value>, right: f64) -> Option<bool> {
    match comparison.and_then(Value::as_str)? {
        "gt" => Some(left > right),
        "gte" => Some(left >= right),
        "lt" => Some(left < right),
        "lte" => Some(left <= right),
        "eq" => Some(left == right),
        _ => None,
    }
}

/// `controls`: objectives the `by` side (friendly unless stated, relative to the ability's side)
/// controls, bounded by `count`, compared with the other side's, or as a `proportion` of every
/// objective. Every stated clause must hold. An objective filter needs per-objective state.
pub(crate) fn evaluate_controls(
    params: &Obj,
    ctx: &EngineContext,
    ability_side: TranslationPerspective,
) -> Option<bool> {
    let control = ctx.objectives_controlled?;
    if stated(params.get("objective")).is_some() {
        return None;
    }
    let side_of = |owner: Option<&Value>| match stated(owner).map(Value::as_str) {
        None | Some(Some("friendly")) => Some(ability_side),
        Some(Some("enemy")) => Some(other(ability_side)),
        _ => None,
    };
    let held = |side: TranslationPerspective| match side {
        TranslationPerspective::Attacker => control.attacker,
        TranslationPerspective::Target => control.target,
    };
    let count = held(side_of(params.get("by"))?);
    let mut verdicts: Vec<Option<bool>> = Vec::new();
    if let Some(bounds) = stated(params.get("count")) {
        let bounds = bounds.as_object()?;
        let bound = |key: &str| match stated(bounds.get(key)) {
            None => Some(None),
            Some(value) => value.as_f64().map(Some),
        };
        let (min, max) = (bound("min")?, bound("max")?);
        verdicts.push(Some(
            min.is_none_or(|min| count >= min) && max.is_none_or(|max| count <= max),
        ));
    }
    if let Some(against) = stated(params.get("compare")) {
        let against = against.as_object()?;
        let side = side_of(against.get("owner"))?;
        verdicts.push(compare(count, against.get("comparison"), held(side)));
    }
    if let Some(proportion) = stated(params.get("proportion")) {
        let proportion = proportion.as_object()?;
        let fraction = proportion.get("fraction").and_then(Value::as_f64)?;
        if control.total <= 0.0 {
            return None;
        }
        verdicts.push(compare(
            count / control.total,
            proportion.get("comparison"),
            fraction,
        ));
    }
    // Bare `controls` means at least one objective.
    if verdicts.is_empty() {
        verdicts.push(Some(count >= 1.0));
    }
    if verdicts.contains(&Some(false)) {
        return Some(false);
    }
    if verdicts.contains(&None) {
        None
    } else {
        Some(true)
    }
}

/// `attachment` from the attachment flags and roles alone; `with` filters are left to the
/// members.
pub(crate) fn attachment_from_flags(
    params: &Obj,
    ctx: &EngineContext,
    perspective: TranslationPerspective,
    source: Option<&BuffSource>,
) -> Option<bool> {
    let explicit_side = match params.get("subject").and_then(Value::as_str) {
        Some("attacker") => Some(TranslationPerspective::Attacker),
        Some("defender") => Some(TranslationPerspective::Target),
        _ => None,
    };
    let side = explicit_side.unwrap_or(perspective);
    let (mut attached, mut role) = match side {
        TranslationPerspective::Attacker => (ctx.attacker_attached, ctx.attacker_attachment_role),
        TranslationPerspective::Target => (ctx.target_attached, ctx.target_attachment_role),
    };
    if let (
        None,
        Some(BuffSource::Ability {
            ability_kind: kind @ (AbilityKind::Attached | AbilityKind::Support),
            source_unit_id,
            ..
        }),
    ) = (explicit_side, source)
    {
        role = source_unit_id
            .as_ref()
            .and_then(|id| ctx.attachment_roles.as_ref()?.get(id))
            .copied();
        attached = if *kind == AbilityKind::Attached {
            Some(true)
        } else {
            role.map(|_| true)
        };
    }
    if attached == Some(false) {
        return Some(false);
    }
    match params.get("role").and_then(Value::as_str) {
        Some("attached") => attached,
        Some("leading") => role.map(|role| role == AttachmentRole::Leader),
        // A bodyguard is known to be led; other combined-unit leadership needs more facts.
        Some("led") if role == Some(AttachmentRole::Bodyguard) => Some(true),
        _ => None,
    }
}

/// `attachment` facts the combined unit's members settle. `own` is the unit the ability belongs
/// to. Leading needs `own` to be a Leader with a Bodyguard; led needs another member that is a
/// Leader; attached needs another member. `with` narrows those other members by keyword
/// (friendly units only).
pub(crate) fn attachment_from_members(
    role: Option<&Value>,
    with: Option<&Value>,
    members: Option<&[AttachedMember]>,
    own: Option<&str>,
) -> Option<bool> {
    let (members, own) = (members?, own?);
    let Some(own_member) = members.iter().find(|member| member.unit_id == own) else {
        return Some(false);
    };
    let others = members.iter().filter(|member| member.unit_id != own);
    let candidates: Vec<&AttachedMember> = match role.and_then(Value::as_str) {
        Some("leading") if own_member.role == MemberRole::Leader => others
            .filter(|member| member.role == MemberRole::Bodyguard)
            .collect(),
        Some("leading") => Vec::new(),
        Some("led") => others
            .filter(|member| member.role == MemberRole::Leader)
            .collect(),
        Some("attached") => others.collect(),
        _ => return None,
    };
    let Some(with) = stated(with) else {
        return Some(!candidates.is_empty());
    };
    let with = with.as_object()?;
    if with.get("owner").and_then(Value::as_str) == Some("enemy") {
        return Some(false);
    }
    if with
        .keys()
        .any(|key| key != "owner" && !KEYWORD_CLAUSES.contains(&key.as_str()))
    {
        return None;
    }
    let predicate = keyword_predicate(with)?;
    Some(
        candidates
            .iter()
            .any(|member| keyword_predicate_holds(&predicate, &member.keywords)),
    )
}

/// A `within.of` that names other units by keyword and owner.
pub(crate) fn is_neighbour_filter(of: &Obj) -> bool {
    !of.is_empty()
        && of.iter().all(|(key, value)| {
            if key == "owner" {
                matches!(value.as_str(), Some("friendly" | "enemy" | "any"))
            } else {
                KEYWORD_CLAUSES.contains(&key.as_str())
                    && value
                        .as_array()
                        .is_some_and(|items| items.iter().all(Value::is_string))
            }
        })
}

/// Whether a unit near the filtered unit meets a `within.of` filter within `inches`. The filter's
/// owner is relative to the ability's side; a neighbour's owner is relative to the filtered unit,
/// so they agree only when the ability belongs to the filtered unit's side.
pub(crate) fn within_neighbour(
    of: &Obj,
    inches: f64,
    neighbours: Option<&[ScenarioNeighbour]>,
    same_side: bool,
) -> Option<bool> {
    let neighbours = neighbours?;
    let predicate = keyword_predicate(of)?;
    let wanted = of.get("owner").and_then(Value::as_str);
    Some(neighbours.iter().any(|neighbour| {
        let owner = match (neighbour.owner == NeighbourOwner::Friendly) == same_side {
            true => "friendly",
            false => "enemy",
        };
        if wanted.is_some_and(|wanted| wanted != "any" && wanted != owner) {
            return false;
        }
        neighbour.distance_inches <= inches
            && keyword_predicate_holds(&predicate, &neighbour.keywords)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Phase;
    use serde_json::json;
    use TranslationPerspective::{Attacker, Target};

    fn obj(value: Value) -> Obj {
        value.as_object().cloned().expect("an object")
    }

    fn ctx(fields: Value) -> EngineContext {
        let mut value = fields;
        value["phase"] = json!("shooting");
        serde_json::from_value(value).expect("context deserializes")
    }

    #[test]
    fn rule_active_needs_the_exact_option_but_a_bare_id_matches_any_option() {
        let ctx =
            ctx(json!({ "activeRules": [{ "ability_id": "doctrines", "option_id": "assault" }] }));
        let option =
            |id: &str| obj(json!({ "rule": { "ability_id": "doctrines", "option_id": id } }));
        assert_eq!(evaluate_rule_active(&option("assault"), &ctx), Some(true));
        assert_eq!(evaluate_rule_active(&option("tactical"), &ctx), Some(false));
        let bare = obj(json!({ "rule": "doctrines" }));
        assert_eq!(evaluate_rule_active(&bare, &ctx), Some(true));
        let unscoped = obj(json!({ "rule": { "ability_id": "doctrines" } }));
        assert_eq!(evaluate_rule_active(&unscoped, &ctx), None);
        assert_eq!(
            evaluate_rule_active(&bare, &EngineContext::new(Phase::Shooting)),
            None
        );
    }

    #[test]
    fn in_region_reads_territory_from_the_abilitys_side_and_wholly_needs_a_wholly_entry() {
        let ctx = ctx(json!({ "targetRegions": [{ "territory": "attacker" }] }));
        let region = |territory: &str, extra: Value| {
            let mut params = json!({ "region": { "territory": territory } });
            if let Value::Object(extra) = extra {
                params.as_object_mut().unwrap().extend(extra);
            }
            obj(params)
        };
        // The target stands in the attacker's territory: "enemy territory" for a defensive rule.
        let enemy = region("enemy-territory", json!({}));
        assert_eq!(evaluate_in_region(&enemy, &ctx, Target, Target), Some(true));
        assert_eq!(
            evaluate_in_region(&enemy, &ctx, Target, Attacker),
            Some(false)
        );
        let wholly = region("enemy-territory", json!({ "models": "every" }));
        assert_eq!(
            evaluate_in_region(&wholly, &ctx, Target, Target),
            Some(false)
        );
        let designated = obj(json!({ "region": { "terrain_area": { "designated": "x" } } }));
        assert_eq!(evaluate_in_region(&designated, &ctx, Target, Target), None);
        assert_eq!(evaluate_in_region(&enemy, &ctx, Attacker, Target), None);
    }

    #[test]
    fn controls_checks_every_stated_clause_from_the_abilitys_side() {
        let ctx =
            ctx(json!({ "objectivesControlled": { "attacker": 2, "target": 3, "total": 6 } }));
        let bare = obj(json!({}));
        assert_eq!(evaluate_controls(&bare, &ctx, Attacker), Some(true));
        let more = obj(json!({ "compare": { "owner": "enemy", "comparison": "gt" } }));
        assert_eq!(evaluate_controls(&more, &ctx, Attacker), Some(false));
        assert_eq!(evaluate_controls(&more, &ctx, Target), Some(true));
        let half = obj(json!({ "proportion": { "fraction": 0.5, "comparison": "gte" } }));
        assert_eq!(evaluate_controls(&half, &ctx, Attacker), Some(false));
        assert_eq!(evaluate_controls(&half, &ctx, Target), Some(true));
        let bounded = obj(json!({ "by": "enemy", "count": { "min": 1, "max": 2 } }));
        assert_eq!(evaluate_controls(&bounded, &ctx, Target), Some(true));
        let filtered = obj(json!({ "objective": { "role": "home" } }));
        assert_eq!(evaluate_controls(&filtered, &ctx, Attacker), None);
        let bad = obj(json!({ "compare": { "owner": "enemy", "comparison": "ne" } }));
        assert_eq!(evaluate_controls(&bad, &ctx, Attacker), None);
    }

    #[test]
    fn attachment_members_settle_roles_and_with_filters() {
        let members: Vec<AttachedMember> = serde_json::from_value(json!([
            { "unitId": "captain", "role": "leader", "keywords": ["Character", "Infantry"] },
            { "unitId": "squad", "role": "bodyguard", "keywords": ["Infantry", "Battleline"] },
        ]))
        .unwrap();
        let role = |r: &str| json!(r);
        assert_eq!(
            attachment_from_members(
                Some(&role("leading")),
                None,
                Some(&members),
                Some("captain")
            ),
            Some(true)
        );
        assert_eq!(
            attachment_from_members(Some(&role("leading")), None, Some(&members), Some("squad")),
            Some(false)
        );
        let character = json!({ "all_of": ["CHARACTER"] });
        assert_eq!(
            attachment_from_members(
                Some(&role("led")),
                Some(&character),
                Some(&members),
                Some("squad")
            ),
            Some(true)
        );
        let battleline = json!({ "all_of": ["Battleline"] });
        assert_eq!(
            attachment_from_members(
                Some(&role("led")),
                Some(&battleline),
                Some(&members),
                Some("squad")
            ),
            Some(false)
        );
        let enemy = json!({ "owner": "enemy", "all_of": ["Character"] });
        assert_eq!(
            attachment_from_members(
                Some(&role("attached")),
                Some(&enemy),
                Some(&members),
                Some("squad")
            ),
            Some(false)
        );
        assert_eq!(
            attachment_from_members(
                Some(&role("attached")),
                None,
                Some(&members),
                Some("absent")
            ),
            Some(false)
        );
        assert_eq!(
            attachment_from_members(Some(&role("attached")), None, None, Some("squad")),
            None
        );
    }

    #[test]
    fn a_neighbours_owner_flips_when_the_ability_belongs_to_the_other_side() {
        let neighbours: Vec<ScenarioNeighbour> = serde_json::from_value(json!([
            { "keywords": ["Vehicle"], "owner": "friendly", "distanceInches": 5 },
        ]))
        .unwrap();
        let friendly_vehicle = obj(json!({ "owner": "friendly", "all_of": ["Vehicle"] }));
        assert!(is_neighbour_filter(&friendly_vehicle));
        assert_eq!(
            within_neighbour(&friendly_vehicle, 6.0, Some(&neighbours), true),
            Some(true)
        );
        assert_eq!(
            within_neighbour(&friendly_vehicle, 3.0, Some(&neighbours), true),
            Some(false)
        );
        assert_eq!(
            within_neighbour(&friendly_vehicle, 6.0, Some(&neighbours), false),
            Some(false)
        );
        let enemy_vehicle = obj(json!({ "owner": "enemy", "all_of": ["Vehicle"] }));
        assert_eq!(
            within_neighbour(&enemy_vehicle, 6.0, Some(&neighbours), false),
            Some(true)
        );
        assert_eq!(within_neighbour(&enemy_vehicle, 6.0, None, false), None);
        assert!(!is_neighbour_filter(&obj(json!({ "objective": {} }))));
    }
}
