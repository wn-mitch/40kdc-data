//! An alternate wargear slot that lists an empty choice: leaving the alternate
//! untaken keeps the standard loadout, so a model carrying nothing is still
//! not a legal loadout.
use std::collections::BTreeMap;

fn rules() -> wh40kdc::MfmLoadoutRules {
    serde_json::from_str(r#"{"stock":[{"model":"Trooper","models":1,"items":[{"id":"gun","count":1}]}],"templates":[{"model":"Trooper","items":[{"id":"gun","count":1}]}],"slots":[{"model":"Trooper","picks":1,"repeats":false,"alternate":false,"choices":[[{"id":"gun","count":1}]]},{"model":"Trooper","picks":1,"repeats":false,"alternate":true,"choices":[[],[{"id":"sword","count":1}]]}],"limits":[],"uniform":[],"options":[]}"#).expect("rules parse")
}

fn check(counts: &[(&str, i64)]) -> Vec<&'static str> {
    let models = BTreeMap::from([("Trooper".to_string(), 1)]);
    let counts = counts.iter().map(|(id, n)| (id.to_string(), *n)).collect();
    wh40kdc::check_mfm_loadout(&rules(), &models, &counts)
        .into_iter()
        .map(|v| v.code)
        .collect()
}

#[test]
fn refuses_a_model_the_empty_alternate_leaves_unarmed() {
    assert_eq!(check(&[]), vec!["no-assignment"]);
}

#[test]
fn allows_the_standard_loadout_or_the_alternate() {
    assert!(check(&[("gun", 1)]).is_empty());
    assert!(check(&[("sword", 1)]).is_empty());
}
