//! Resolve canonical weapon scopes without losing ratings, exclusions or conjunctions.
//! Positive grants reach a least fixed point; exclusions then prune grants and their
//! dependents. Missing weapon or board facts never satisfy a constrained gate.

use super::buffs::{Buff, BuffApplicability, BuffContribution, EngineContext, WeaponKeywordRef};

fn applies(buff: &Buff, ctx: &EngineContext) -> bool {
    let Some(w) = &buff.applicable_when else {
        return true;
    };
    if w.on_critical.is_some() && w.on_critical != ctx.critical_roll {
        return false;
    }
    for (filter, side) in [
        (
            &w.target_filter,
            super::from_dsl::TranslationPerspective::Target,
        ),
        (
            &w.attacker_filter,
            super::from_dsl::TranslationPerspective::Attacker,
        ),
    ] {
        if let Some(filter) = filter {
            if super::from_dsl::conditions::matches_unit_filter(
                filter,
                ctx,
                side,
                filter
                    .get("owner")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("friendly"),
            ) != Some(true)
            {
                return false;
            }
        }
    }
    if w.phases
        .as_ref()
        .is_some_and(|phases| !phases.contains(&ctx.phase))
    {
        return false;
    }
    if let (
        Some(want),
        BuffContribution::Reroll { roll, .. } | BuffContribution::RerollOne { roll },
    ) = (w.roll_type, &buff.contribution)
    {
        if *roll != want {
            return false;
        }
    }
    let has = |keywords: &Option<Vec<String>>, want: &str| {
        keywords.as_ref().is_some_and(|keys| {
            keys.iter()
                .any(|key| crate::scope::keyword_key(key) == crate::scope::keyword_key(want))
        })
    };
    if w.requires_target_keyword
        .as_ref()
        .is_some_and(|want| !has(&ctx.target_keywords, want))
        || w.requires_attacker_keyword
            .as_ref()
            .is_some_and(|want| !has(&ctx.attacker_keywords, want))
    {
        return false;
    }
    if let Some(excluded) = &w.excluded_target_keywords {
        if ctx.target_keywords.is_none()
            || excluded.iter().any(|want| has(&ctx.target_keywords, want))
        {
            return false;
        }
    }
    if !super::attack_compare::comparisons_hold(w, ctx) {
        return false;
    }
    if let Some(max) = w.max_range_inches {
        if !ctx.distance_inches.is_some_and(|distance| distance <= max) {
            return false;
        }
    }
    true
}

fn reference_matches(want: &WeaponKeywordRef, actual: &WeaponKeywordRef) -> bool {
    want.keyword_id == actual.keyword_id
        && want.parameters.as_ref().is_none_or(|parameters| {
            parameters.as_object().is_some_and(|expected| {
                expected.iter().all(|(key, value)| {
                    actual.parameters.as_ref().and_then(|p| p.get(key)) == Some(value)
                })
            })
        })
}

fn weapon_gate(
    w: &BuffApplicability,
    ctx: &EngineContext,
    keywords: &[&WeaponKeywordRef],
    exclusions: bool,
) -> bool {
    if !super::attack_compare::comparisons_hold(w, ctx) {
        return false;
    }
    if w.weapon_name.as_ref().is_some_and(|want| {
        !ctx.weapon_names
            .as_ref()
            .is_some_and(|names| names.contains(want))
    }) {
        return false;
    }
    if w.excluded_weapon_name.as_ref().is_some_and(|want| {
        !ctx.weapon_names
            .as_ref()
            .is_some_and(|names| !names.contains(want))
    }) {
        return false;
    }
    let known = ctx.weapon_keyword_refs.is_some() || ctx.weapon_keywords.is_some();
    let has = |want: &WeaponKeywordRef| {
        keywords
            .iter()
            .any(|actual| reference_matches(want, actual))
    };
    if let Some(wanted) = &w.weapon_keywords {
        if !wanted.iter().any(has) {
            return false;
        }
    }
    if exclusions {
        if let Some(excluded) = &w.excluded_weapon_keywords {
            let unresolved = excluded.iter().any(|want| {
                keywords.iter().any(|actual| {
                    want.keyword_id == actual.keyword_id
                        && want
                            .parameters
                            .as_ref()
                            .and_then(serde_json::Value::as_object)
                            .is_some_and(|expected| {
                                expected.keys().any(|key| {
                                    actual
                                        .parameters
                                        .as_ref()
                                        .and_then(|parameters| parameters.get(key))
                                        .is_none()
                                })
                            })
                })
            });
            if !known || unresolved || excluded.iter().any(has) {
                return false;
            }
        }
    }
    w.weapon_requirements.as_ref().is_none_or(|requirements| {
        requirements
            .iter()
            .all(|requirement| weapon_gate(requirement, ctx, keywords, exclusions))
    })
}

pub(super) fn live_buffs<'a>(buffs: &'a [Buff], ctx: &EngineContext) -> Vec<&'a Buff> {
    let id_refs: Vec<WeaponKeywordRef> = if ctx.weapon_keyword_refs.is_none() {
        ctx.weapon_keywords
            .iter()
            .flatten()
            .map(|id| WeaponKeywordRef {
                keyword_id: id.clone(),
                parameters: None,
            })
            .collect()
    } else {
        Vec::new()
    };
    let printed = ctx.weapon_keyword_refs.as_deref().unwrap_or(&id_refs);
    let eligible: Vec<bool> = buffs.iter().map(|buff| applies(buff, ctx)).collect();
    let mut live = vec![false; buffs.len()];
    let mut keywords: Vec<&WeaponKeywordRef> = printed.iter().collect();
    loop {
        let mut changed = false;
        for (index, buff) in buffs.iter().enumerate() {
            if !live[index]
                && eligible[index]
                && buff
                    .applicable_when
                    .as_ref()
                    .is_none_or(|w| weapon_gate(w, ctx, &keywords, false))
            {
                live[index] = true;
                changed = true;
                if let BuffContribution::ExtraKeyword { keyword_ref } = &buff.contribution {
                    keywords.push(keyword_ref);
                }
            }
        }
        if !changed {
            break;
        }
    }
    loop {
        keywords.clear();
        keywords.extend(printed.iter());
        for (index, buff) in buffs.iter().enumerate() {
            if let (true, BuffContribution::ExtraKeyword { keyword_ref }) =
                (live[index], &buff.contribution)
            {
                keywords.push(keyword_ref);
            }
        }
        let mut changed = false;
        for (index, buff) in buffs.iter().enumerate() {
            if live[index]
                && !buff
                    .applicable_when
                    .as_ref()
                    .is_none_or(|w| weapon_gate(w, ctx, &keywords, true))
            {
                live[index] = false;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    buffs
        .iter()
        .enumerate()
        .filter(|(index, _)| live[*index])
        .map(|(_, buff)| buff)
        .collect()
}
