//! A unit's `ability_ids` entry: an ability id, or an object for a rated rule (`{id, value}`:
//! Deadly Demise D3, Feel No Pain 5+) or for the ability a wargear item prints
//! (`{id, wargear}`). Mirrors `tools/src/data/ability-refs.ts`.

use serde_json::Value;

use crate::{Unit, UnitAbilityIdsItem};

impl UnitAbilityIdsItem {
    /// The ability id the entry names.
    pub fn id(&self) -> &str {
        match self {
            Self::EntityId(id) => id.as_str(),
            Self::UnitAbilityRef { id, .. } => id.as_str(),
        }
    }

    /// The rating the entry prints, if it is a rated rule (`5` for Feel No Pain 5+, `"D3"`
    /// for Deadly Demise D3), as its JSON value.
    pub fn value(&self) -> Option<Value> {
        match self {
            Self::UnitAbilityRef { value: Some(v), .. } => serde_json::to_value(v).ok(),
            _ => None,
        }
    }

    /// The wargear item whose printed ability this entry is, if any.
    pub fn wargear(&self) -> Option<&str> {
        match self {
            Self::UnitAbilityRef {
                wargear: Some(w), ..
            } => Some(w.as_str()),
            _ => None,
        }
    }
}

/// The ability ids of a unit's `ability_ids`, in order.
pub fn unit_ability_ids(unit: &Unit) -> Vec<&str> {
    unit.ability_ids
        .iter()
        .map(UnitAbilityIdsItem::id)
        .collect()
}

/// The wargear ids whose printed ability the unit lists (its datasheet prints that rule).
pub fn printed_wargear_ids(unit: &Unit) -> Vec<&str> {
    unit.ability_ids
        .iter()
        .filter_map(UnitAbilityIdsItem::wargear)
        .collect()
}

/// The rating the unit's datasheet prints for a rated rule (the D3 of Deadly Demise D3).
/// Mirrors TS `UnitView.ratingOf`: the first entry naming the ability decides.
pub fn rating_of(unit: &Unit, ability_id: &str) -> Option<Value> {
    unit.ability_ids
        .iter()
        .find(|r| r.id() == ability_id)
        .and_then(UnitAbilityIdsItem::value)
}

/// `{rating: true}` and nothing else.
fn is_rating_ref(v: &Value) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == 1 && o.get("rating") == Some(&Value::Bool(true)))
}

/// An effect with every `{rating: true}` replaced by the unit's printed rating. Without a
/// rating (no unit in context) the effect is returned as is. Mirrors TS `withRating`.
pub fn with_rating(effect: &Value, rating: Option<&Value>) -> Value {
    let Some(rating) = rating else {
        return effect.clone();
    };
    fn walk(v: &Value, rating: &Value) -> Value {
        if is_rating_ref(v) {
            return rating.clone();
        }
        match v {
            Value::Array(a) => Value::Array(a.iter().map(|x| walk(x, rating)).collect()),
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, x)| (k.clone(), walk(x, rating)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    walk(effect, rating)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_rating_ref_is_replaced_only_when_it_is_exactly_rating_true() {
        let effect = json!({ "type": "feel-no-pain", "modifier": { "threshold": { "rating": true } },
                             "other": { "rating": true, "extra": 1 } });
        let rated = with_rating(&effect, Some(&json!(5)));
        assert_eq!(rated["modifier"]["threshold"], json!(5));
        assert_eq!(rated["other"], effect["other"]);
        assert_eq!(with_rating(&effect, None), effect);
    }

    #[test]
    fn unit_refs_read_ids_ratings_and_wargear() {
        let unit: Unit = serde_json::from_value(json!({
            "id": "test-unit", "name": "Test Unit", "faction_id": "orks",
            "game_version": { "dataslate": "codex-orks", "edition": "11th" },
            "ability_ids": ["deep-strike", { "id": "feel-no-pain", "value": 5 },
                            { "id": "grot-oiler-orks", "wargear": "grot-oiler" },
                            { "id": "feel-no-pain", "value": 6 }],
            "profiles": [], "points": [],
        }))
        .expect("unit");
        assert_eq!(
            unit_ability_ids(&unit),
            [
                "deep-strike",
                "feel-no-pain",
                "grot-oiler-orks",
                "feel-no-pain"
            ]
        );
        assert_eq!(printed_wargear_ids(&unit), ["grot-oiler"]);
        assert_eq!(rating_of(&unit, "feel-no-pain"), Some(json!(5)));
        assert_eq!(rating_of(&unit, "deep-strike"), None);
    }
}
