//! Which buffs in a stack are live against an [`EngineContext`]: each buff's `applicable_when`
//! gates, plus the weapon-keyword gate that also reads the keywords other live buffs grant.
//! Mirrors `applies` and `liveBuffs` in `tools/src/cruncher/buffs.ts`.

use super::buffs::{Buff, BuffContribution, EngineContext};

fn applies(buff: &Buff, ctx: &EngineContext) -> bool {
    let Some(w) = buff.applicable_when.as_ref() else {
        return true;
    };
    if let Some(phases) = &w.phases {
        if !phases.is_empty() && !phases.contains(&ctx.phase) {
            return false;
        }
    }
    if let (Some(want), BuffContribution::Reroll { roll, .. }) = (w.roll_type, &buff.contribution) {
        if *roll != want {
            return false;
        }
    }
    if let Some(req) = &w.requires_target_keyword {
        let req_lower = req.to_lowercase();
        let ok = ctx
            .target_keywords
            .as_ref()
            .is_some_and(|kws| kws.iter().any(|k| k == &req_lower));
        if !ok {
            return false;
        }
    }
    if let Some(req) = &w.requires_attacker_keyword {
        let req_lower = req.to_lowercase();
        let ok = ctx
            .attacker_keywords
            .as_ref()
            .is_some_and(|kws| kws.iter().any(|k| k == &req_lower));
        if !ok {
            return false;
        }
    }
    if let (Some(excluded), Some(target)) = (&w.excluded_target_keywords, &ctx.target_keywords) {
        if excluded
            .iter()
            .any(|keyword| target.contains(&keyword.to_lowercase()))
        {
            return false;
        }
    }
    // Range gate: drop only when the distance is known and exceeds the range.
    // Unknown distance is permissive.
    if let (Some(max), Some(dist)) = (w.max_range_inches, ctx.distance_inches) {
        if dist > max {
            return false;
        }
    }
    if let (Some(name), Some(names)) = (&w.weapon_name, &ctx.weapon_names) {
        if !names.contains(name) {
            return false;
        }
    }
    true
}

/// The buffs whose gates hold, in input order. A weapon-keyword gate reads the weapon's printed
/// keywords plus the keywords other live buffs grant, so one pass is repeated until no further
/// gated buff joins ("weapons with Lethal Hits gain Rapid Fire 1" sees a granted Lethal Hits).
pub(super) fn live_buffs<'a>(buffs: &'a [Buff], ctx: &EngineContext) -> Vec<&'a Buff> {
    let gated = |b: &Buff| {
        b.applicable_when
            .as_ref()
            .and_then(|w| w.weapon_keyword.as_ref())
            .is_some()
    };
    let Some(printed) = &ctx.weapon_keywords else {
        return buffs.iter().filter(|b| applies(b, ctx)).collect();
    };
    // `live[i]`: buff `i` passes its other gates and, if keyword-gated, its keyword is present.
    let mut live: Vec<bool> = buffs.iter().map(|b| !gated(b) && applies(b, ctx)).collect();
    let mut pending: Vec<usize> = (0..buffs.len())
        .filter(|&i| gated(&buffs[i]) && applies(&buffs[i], ctx))
        .collect();
    loop {
        let mut keywords: Vec<&str> = printed.iter().map(String::as_str).collect();
        for (i, b) in buffs.iter().enumerate() {
            if let (true, BuffContribution::ExtraKeyword { keyword_ref }) =
                (live[i], &b.contribution)
            {
                keywords.push(keyword_ref.keyword_id.as_str());
            }
        }
        let next: Vec<usize> = pending
            .iter()
            .copied()
            .filter(|&i| {
                let want = buffs[i]
                    .applicable_when
                    .as_ref()
                    .and_then(|w| w.weapon_keyword.as_deref())
                    .unwrap_or_default();
                keywords.contains(&want)
            })
            .collect();
        if next.is_empty() {
            break;
        }
        for &i in &next {
            live[i] = true;
        }
        pending.retain(|i| !next.contains(i));
    }
    // Keep the caller's order so ranking ties break as they did before.
    buffs
        .iter()
        .enumerate()
        .filter(|(i, _)| live[*i])
        .map(|(_, b)| b)
        .collect()
}
