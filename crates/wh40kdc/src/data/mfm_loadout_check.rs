//! The assignment search behind [`check_mfm_loadout`].

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::{
    add, checkbox_caps, contains, copies_of, get, limit_holds, pick_combinations, row_bundles,
    slot_choices, Copies, MfmItem, MfmLoadoutRules, MfmLoadoutViolation, MfmUniform, MAX_BUNDLES,
};

fn violation(code: &'static str, message: impl Into<String>) -> Vec<MfmLoadoutViolation> {
    vec![MfmLoadoutViolation {
        code,
        message: message.into(),
    }]
}

/// Violations of `rules` by a unit with `models` models per row carrying
/// `counts` item copies. An empty result means some assignment of picks to
/// models produces exactly `counts`.
pub fn check_mfm_loadout(
    rules: &MfmLoadoutRules,
    models: &BTreeMap<String, i64>,
    counts: &BTreeMap<String, i64>,
) -> Vec<MfmLoadoutViolation> {
    // BTreeMap keys iterate in byte order, which is code-point order for UTF-8.
    let rows: Vec<&str> = models
        .iter()
        .filter(|(_, n)| **n > 0)
        .map(|(model, _)| model.as_str())
        .collect();
    let unit_models: i64 = models.values().sum();
    let model_count = |row: &str| models.get(row).copied().unwrap_or(0);

    let baseline_of = |model: Option<&str>| -> Copies {
        let mut out = Copies::new();
        for row in &rows {
            if model.is_some_and(|model| model != *row) {
                continue;
            }
            add(&mut out, rules.template(row), model_count(row));
        }
        out
    };

    let mut bundles_by_row: HashMap<&str, Vec<Copies>> = HashMap::new();
    for row in &rows {
        let fits = |bundle: &Copies| {
            bundle
                .iter()
                .all(|(id, n)| *n <= counts.get(id).copied().unwrap_or(0))
        };
        let Some(bundles) = row_bundles(rules, row, &fits, MAX_BUNDLES) else {
            return violation(
                "too-many-options",
                format!("{row}: more than {MAX_BUNDLES} wargear combinations to search"),
            );
        };
        bundles_by_row.insert(row, bundles);
    }
    let unit_caps = checkbox_caps(rules, None, 1);
    let row_caps: HashMap<&str, HashMap<String, i64>> = rows
        .iter()
        .map(|row| (*row, checkbox_caps(rules, Some(row), model_count(row))))
        .collect();
    let unit_picks = unit_picks_of(rules);

    let mut reachable: HashSet<&str> = HashSet::new();
    for bundle in bundles_by_row.values().flatten().chain(&unit_picks) {
        reachable.extend(
            bundle
                .iter()
                .filter(|(_, n)| **n > 0)
                .map(|(id, _)| id.as_str()),
        );
    }
    // Items a model or the unit could carry at all, before bundles are pruned
    // against the counts, so a count no assignment fits is reported as that.
    let scoped = |model: Option<&str>| model.is_none_or(|model| rows.contains(&model));
    let mut carriable: HashSet<&str> = HashSet::new();
    for slot in rules
        .slots
        .iter()
        .filter(|slot| scoped(slot.model.as_deref()))
    {
        carriable.extend(slot.choices.iter().flatten().map(|item| item.id.as_str()));
    }
    for entry in rules
        .templates
        .iter()
        .filter(|entry| scoped(Some(&entry.model)))
    {
        carriable.extend(entry.items.iter().map(|item| item.id.as_str()));
    }
    for entry in rules
        .stock
        .iter()
        .filter(|entry| scoped(entry.model.as_deref()))
    {
        carriable.extend(entry.items.iter().map(|item| item.id.as_str()));
    }
    let unknown: Vec<&str> = counts
        .iter()
        .filter(|(id, n)| **n > 0 && !carriable.contains(id.as_str()))
        .map(|(id, _)| id.as_str())
        .collect();
    if unknown.is_empty()
        && counts
            .iter()
            .any(|(id, n)| *n > 0 && !reachable.contains(id.as_str()))
    {
        return violation(
            "no-assignment",
            "no assignment of wargear choices to models gives these counts",
        );
    }
    if !unknown.is_empty() {
        return violation(
            "unknown-item",
            format!("no model of this unit can carry {}", unknown.join(", ")),
        );
    }

    let ids: Vec<&str> = counts
        .keys()
        .map(String::as_str)
        .chain(reachable.iter().copied())
        .collect::<BTreeSet<&str>>()
        .into_iter()
        .collect();
    let index_of: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    let vector = |copies: &mut dyn Iterator<Item = (&String, &i64)>| -> Vec<i64> {
        let mut out = vec![0; ids.len()];
        for (id, n) in copies {
            out[index_of[id.as_str()]] += n;
        }
        out
    };

    let attempts = uniform_attempts(rules);
    let row_accepts = |row: &str, totals: &[i64]| -> bool {
        let held = |id: &str| index_of.get(id).map_or(0, |i| totals[*i]);
        if row_caps[row].iter().any(|(id, cap)| held(id) > *cap) {
            return false;
        }
        rules
            .limits
            .iter()
            .filter(|limit| limit.model.as_deref() == Some(row))
            .all(|limit| {
                let copies: Copies = totals
                    .iter()
                    .enumerate()
                    .filter(|(_, n)| **n > 0)
                    .map(|(i, n)| (ids[i].to_string(), *n))
                    .collect();
                limit_holds(limit, unit_models, &copies, &baseline_of(Some(row)), false)
            })
    };

    let all_counts: Copies = counts.iter().map(|(id, n)| (id.clone(), *n)).collect();
    let total = vector(&mut counts.iter());
    for attempt in &attempts {
        let allowed: HashMap<&str, Vec<Vec<i64>>> = rows
            .iter()
            .map(|row| {
                let vectors = bundles_by_row[row]
                    .iter()
                    .filter(|bundle| uniform_allows(rules, row, bundle, attempt))
                    .map(|bundle| vector(&mut bundle.iter()))
                    .collect();
                (*row, vectors)
            })
            .collect();
        for unit_pick in &unit_picks {
            if unit_caps.iter().any(|(id, cap)| get(unit_pick, id) > *cap) {
                continue;
            }
            let pick = vector(&mut unit_pick.iter());
            let rest: Vec<i64> = total.iter().zip(&pick).map(|(n, p)| n - p).collect();
            if rest.iter().any(|n| *n < 0) {
                continue;
            }
            // A unit-wide limit counts the unit's copies, which the counts fix.
            let unit_limits_hold = rules.limits.iter().all(|limit| {
                limit.model.is_some()
                    || limit_holds(limit, unit_models, &all_counts, &baseline_of(None), false)
            });
            if !unit_limits_hold {
                continue;
            }
            if assign(&rows, &allowed, &model_count, rest, &row_accepts) {
                return Vec::new();
            }
        }
    }
    violation(
        "no-assignment",
        "no assignment of wargear choices to models gives these counts within the unit's limits",
    )
}

/// The unit's own picks: one pick combination per slot without a row, multiplied out.
pub(super) fn unit_picks_of(rules: &MfmLoadoutRules) -> Vec<Copies> {
    let unit_stock_items: Vec<MfmItem> = rules
        .stock
        .iter()
        .filter(|row| row.model.is_none())
        .flat_map(|row| row.items.iter().cloned())
        .collect();
    let unit_stock = copies_of(&unit_stock_items);
    let mut unit_picks: Vec<Copies> = vec![Copies::new()];
    for slot in rules.slots.iter().filter(|slot| slot.model.is_none()) {
        let picks = pick_combinations(
            &slot_choices(&slot.choices, &unit_stock),
            slot.picks,
            slot.repeats,
        );
        let mut next = Vec::new();
        for acc in &unit_picks {
            for pick in &picks {
                let mut merged = acc.clone();
                add(&mut merged, pick, 1);
                next.push(merged);
            }
        }
        unit_picks = next;
    }
    unit_picks
}

/// A uniform set's main options: its choices that are not substitutes and carry an item.
fn uniform_mains(set: &MfmUniform) -> Vec<&[MfmItem]> {
    set.choices
        .iter()
        .filter(|choice| !choice.substitute && !choice.items.is_empty())
        .map(|choice| choice.items.as_slice())
        .collect()
}

/// Every way to fix each uniform set's main option: one index per set into its main options.
pub(super) fn uniform_attempts(rules: &MfmLoadoutRules) -> Vec<Vec<usize>> {
    let mut attempts: Vec<Vec<usize>> = vec![Vec::new()];
    for set in &rules.uniform {
        let mains = uniform_mains(set).len();
        attempts = attempts
            .iter()
            .flat_map(|attempt| {
                (0..mains.max(1)).map(move |k| {
                    let mut next = attempt.clone();
                    next.push(k);
                    next
                })
            })
            .collect();
    }
    attempts
}

/// Whether a model of `row` may carry `bundle` when each uniform set's main
/// option is the one `attempt` fixes: a model in a set's scope that takes
/// another main option without a substitute is excluded.
pub(super) fn uniform_allows(
    rules: &MfmLoadoutRules,
    row: &str,
    bundle: &Copies,
    attempt: &[usize],
) -> bool {
    rules.uniform.iter().enumerate().all(|(s, set)| {
        if set.model.as_deref().is_some_and(|model| model != row) {
            return true;
        }
        let mains = uniform_mains(set);
        if mains.is_empty() {
            return true;
        }
        if set
            .choices
            .iter()
            .any(|choice| choice.substitute && contains(bundle, &choice.items))
        {
            return true;
        }
        mains
            .iter()
            .enumerate()
            .all(|(k, main)| k == attempt[s] || !contains(bundle, main))
    })
}

/// The state of one search for per-row bundle counts.
struct Assign<'a> {
    rows: &'a [&'a str],
    allowed: &'a HashMap<&'a str, Vec<Vec<i64>>>,
    model_count: &'a dyn Fn(&str) -> i64,
    row_accepts: &'a dyn Fn(&str, &[i64]) -> bool,
    // Failures depend only on the row, the copies left at the row's start and
    // the search position within it, so they are cached on those.
    failed: HashSet<(usize, Vec<i64>, usize, i64, Vec<i64>)>,
}

/// Whether per-row bundle counts use every model and exactly `rest` copies,
/// where each row's own copies pass `row_accepts`.
fn assign(
    rows: &[&str],
    allowed: &HashMap<&str, Vec<Vec<i64>>>,
    model_count: &dyn Fn(&str) -> i64,
    rest: Vec<i64>,
    row_accepts: &dyn Fn(&str, &[i64]) -> bool,
) -> bool {
    let mut search = Assign {
        rows,
        allowed,
        model_count,
        row_accepts,
        failed: HashSet::new(),
    };
    walk_row(&mut search, 0, rest)
}

fn walk_row(search: &mut Assign<'_>, r: usize, left: Vec<i64>) -> bool {
    if r == search.rows.len() {
        return left.iter().all(|n| *n == 0);
    }
    let models = (search.model_count)(search.rows[r]);
    walk_bundle(search, r, &left, 0, models, left.clone())
}

fn walk_bundle(
    search: &mut Assign<'_>,
    r: usize,
    start: &[i64],
    b: usize,
    models_left: i64,
    current: Vec<i64>,
) -> bool {
    let row = search.rows[r];
    if models_left == 0 {
        let used: Vec<i64> = start.iter().zip(&current).map(|(s, c)| s - c).collect();
        return (search.row_accepts)(row, &used) && walk_row(search, r + 1, current);
    }
    let bundles = &search.allowed[row];
    if b >= bundles.len() {
        return false;
    }
    let key = (r, start.to_vec(), b, models_left, current.clone());
    if search.failed.contains(&key) {
        return false;
    }
    let bundle = bundles[b].clone();
    let mut most = models_left;
    for (i, n) in bundle.iter().enumerate() {
        if *n > 0 {
            most = most.min(current[i] / n);
        }
    }
    for take in (0..=most).rev() {
        let next = if take == 0 {
            current.clone()
        } else {
            current
                .iter()
                .zip(&bundle)
                .map(|(c, n)| c - n * take)
                .collect()
        };
        if walk_bundle(search, r, start, b + 1, models_left - take, next) {
            return true;
        }
    }
    search.failed.insert(key);
    false
}
