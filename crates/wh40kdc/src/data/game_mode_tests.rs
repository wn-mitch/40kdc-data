//! Game-mode views over the embedded dataset. The adeptus-mechanicus Combat
//! Patrol box (unit `manipulus-skand`, detachment `purge-corps-deltic-9`,
//! Enhancement "Empowered Mechanisms") is tagged `["combat-patrol"]` only.

use super::*;
use std::collections::HashSet;

const SKAND: &str = "manipulus-skand";
const DELTIC: &str = "purge-corps-deltic-9";
const MECHANISMS: &str = "empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus";
const ADMECH: &str = "adeptus-mechanicus";

fn ds() -> &'static Dataset {
    Dataset::embedded()
}

fn unit_ids(ds: &Dataset) -> HashSet<String> {
    ds.units
        .by_faction(ADMECH)
        .into_iter()
        .map(|u| u.id.to_string())
        .collect()
}

#[test]
fn embedded_is_the_matched_play_view() {
    assert_eq!(ds().game_mode(), GameModeView::MATCHED_PLAY);
    assert_eq!(
        ds().for_game_mode("combat-patrol").unwrap().game_mode(),
        GameModeView::Mode(GameModeId::CombatPatrol)
    );
}

#[test]
fn default_view_hides_combat_patrol_unit_from_listings() {
    let ds = ds();
    assert!(!unit_ids(ds).contains(SKAND));
    assert!(!ds.units.iter().any(|u| u.id.as_str() == SKAND));
    assert!(!ds.units.all().iter().any(|u| u.id.as_str() == SKAND));
    assert_eq!(ds.units.len(), ds.units.iter().count());
    assert!(ds.find_unit("Manipulus Skand").is_none());
    // The exact-id step of find skips hidden records too.
    assert!(ds.units.find(SKAND).is_none());
    assert!(ds.units.find_all(SKAND).is_empty());
}

#[test]
fn default_view_id_lookups_resolve_combat_patrol_unit() {
    let ds = ds();
    assert_eq!(ds.units.get_any(SKAND).unwrap().id.as_str(), SKAND);
    assert_eq!(
        ds.units.get_in_faction(SKAND, ADMECH).unwrap().id.as_str(),
        SKAND
    );
    assert!(ds.units.has(SKAND));
    // Per-unit lookups stay unfiltered.
    let skand = ds.units.get_any(SKAND).unwrap();
    assert!(ds.unit_composition_of(skand).is_some());
}

#[test]
fn combat_patrol_view_lists_combat_patrol_unit() {
    let cp = ds().for_game_mode("combat-patrol").unwrap();
    let ids = unit_ids(cp);
    assert!(ids.contains(SKAND));
    assert!(ids
        .iter()
        .all(|id| id == SKAND || id.starts_with("purge-corps-")));
    assert_eq!(cp.find_unit("Manipulus Skand").unwrap().id.as_str(), SKAND);
    assert!(cp.units.iter().all(|u| u
        .game_modes
        .as_ref()
        .is_some_and(|m| m.0.contains(&GameModeId::CombatPatrol))));
}

#[test]
fn unit_compositions_list_by_view_and_look_up_in_every_view() {
    // `sholgor-the-putrid`'s composition is tagged combat-patrol only.
    const SHOLGOR: &str = "sholgor-the-putrid";
    let listed = |d: &Dataset| {
        d.unit_compositions
            .iter()
            .any(|c| c.unit_id.as_str() == SHOLGOR)
    };
    let ds = ds();
    assert!(!listed(ds));
    assert!(listed(ds.for_game_mode("combat-patrol").unwrap()));
    assert!(listed(ds.for_game_mode("all").unwrap()));
    let unit = ds.units.get_in_faction(SHOLGOR, "death-guard").unwrap();
    assert!(ds.unit_composition_of(unit).is_some());
}

#[test]
fn all_view_is_the_union_of_every_mode() {
    let ds = ds();
    let all = ds.for_game_mode("all").unwrap();
    let mut union = unit_ids(ds);
    for mode in ["combat-patrol", "boarding-actions", "crusade"] {
        union.extend(unit_ids(ds.for_game_mode(mode).unwrap()));
    }
    assert_eq!(unit_ids(all), union);
    assert!(unit_ids(all).len() > unit_ids(ds).len());
    assert_eq!(all.units.len(), all.units.every().len());
    let mp = ds.units.len();
    let cp = ds.for_game_mode("combat-patrol").unwrap().units.len();
    assert!(all.units.len() >= mp.max(cp) && all.units.len() <= mp + cp);
}

#[test]
fn detachment_follows_the_view() {
    let ds = ds();
    let ids = |d: &Dataset| -> Vec<String> {
        d.detachments
            .by_faction(ADMECH)
            .into_iter()
            .map(|x| x.id.to_string())
            .collect()
    };
    assert!(!ids(ds).iter().any(|id| id == DELTIC));
    assert!(ds.detachments.find("Purge Corps Deltic-9").is_none());
    assert_eq!(ds.detachments.get_any(DELTIC).unwrap().id.as_str(), DELTIC);
    let cp = ds.for_game_mode("combat-patrol").unwrap();
    assert_eq!(ids(cp), [DELTIC]);
    assert_eq!(
        cp.detachments
            .find("Purge Corps Deltic-9")
            .unwrap()
            .id
            .as_str(),
        DELTIC
    );
    assert!(ids(ds.for_game_mode("all").unwrap())
        .iter()
        .any(|id| id == DELTIC));
}

#[test]
fn enhancement_follows_the_view() {
    let ds = ds();
    assert!(ds.enhancements.find("Empowered Mechanisms").is_none());
    assert!(!ds.enhancements.iter().any(|e| e.id.as_str() == MECHANISMS));
    assert_eq!(
        ds.enhancements.get(MECHANISMS).unwrap().id.as_str(),
        MECHANISMS
    );
    let cp = ds.for_game_mode("combat-patrol").unwrap();
    assert_eq!(
        cp.enhancements
            .find("Empowered Mechanisms")
            .unwrap()
            .id
            .as_str(),
        MECHANISMS
    );
}

#[test]
fn reverse_listings_follow_the_view() {
    let ds = ds();
    let skand = ds.units.get_any(SKAND).unwrap();
    let keyword = skand.keywords.as_ref().unwrap().0[0].as_str();
    let has = |d: &Dataset| {
        d.units_with_keyword(keyword)
            .iter()
            .any(|u| u.id.as_str() == SKAND)
    };
    assert!(!has(ds));
    assert!(has(ds.for_game_mode("combat-patrol").unwrap()));
    assert!(has(ds.for_game_mode("all").unwrap()));
}

#[test]
fn unfiltered_collections_ignore_the_view() {
    let ds = ds();
    let cp = ds.for_game_mode("combat-patrol").unwrap();
    assert_eq!(ds.factions.len(), cp.factions.len());
    assert_eq!(ds.abilities.len(), cp.abilities.len());
}

#[test]
fn unknown_game_mode_errors() {
    let err = ds().for_game_mode("narrative").err().unwrap();
    assert_eq!(err, UnknownGameMode("narrative".to_string()));
    assert!("".parse::<GameModeView>().is_err());
    assert_eq!("all".parse::<GameModeView>().unwrap(), GameModeView::All);
    assert_eq!(GameModeView::All.to_string(), "all");
    assert_eq!(GameModeView::MATCHED_PLAY.to_string(), "matched-play");
}

#[test]
fn views_share_records() {
    let ds = ds();
    let all = ds.for_game_mode("all").unwrap();
    let a = ds.units.get_any(SKAND).unwrap() as *const _;
    let b = all.units.get_any(SKAND).unwrap() as *const _;
    assert_eq!(a, b, "a view must share, not copy, the records");
}

#[test]
fn views_are_cached_and_list_through_slices() {
    let ds = ds();
    let cp = ds.for_game_mode("combat-patrol").unwrap();
    // The same view comes back on every call, and a view of its own mode is itself.
    assert!(std::ptr::eq(cp, ds.for_game_mode("combat-patrol").unwrap()));
    assert!(std::ptr::eq(ds, ds.for_game_mode("matched-play").unwrap()));
    // Listings are slices of the listed records only.
    let listed: &[Unit] = cp.units.all();
    assert_eq!(listed.len(), cp.units.len());
    assert!(listed.iter().any(|u| u.id.as_str() == SKAND));
    assert!(!ds.units.all().iter().any(|u| u.id.as_str() == SKAND));
    // The "all" view of a scoped collection lists the full record store.
    let all = ds.for_game_mode("all").unwrap();
    assert!(std::ptr::eq(all.units.all(), all.units.every()));
}
