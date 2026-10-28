//! A queryable view over one entity collection.
//!
//! Indexes (by id, by normalized name, by faction) are built once at
//! construction. Records are deduplicated by a caller-supplied key (default:
//! id, first occurrence wins). Some records are intentionally shared: the same
//! id (e.g. unit `ministorum-priest`, ability `deadly-demise-d3`) appears under
//! several factions with per-faction copies that may diverge, so those
//! collections dedupe on `(faction_id, id)` to keep each faction's copy and
//! resolve via [`get_in_faction`](Collection::get_in_faction).
//!
//! [`find`](Collection::find) returns the first match when an id is shared
//! across factions; use [`by_faction`](Collection::by_faction) or
//! [`find_all`](Collection::find_all) to disambiguate. Collections whose
//! per-faction copies diverge arm [`with_unscoped_guard`](Collection::with_unscoped_guard)
//! so a faction-less [`get`](Collection::get) of a shared id panics in debug
//! builds; deliberately faction-less callers use [`get_any`](Collection::get_any).
//!
//! A collection whose records carry `game_modes` is game-mode scoped (see
//! [`super::game_mode`]): its listings (`all`, `iter`, `len`, `by_faction`,
//! `find`, `find_all`) show only the records its view's mode includes, while id
//! lookups (`get`, `get_any`, `get_in_faction`, `has`, `by_external_ref`)
//! resolve every record. Views share the records and indexes through an `Arc`,
//! so cloning a collection or re-viewing it in another mode copies pointers.
//!
//! This mirrors the TypeScript `Collection` (`tools/src/data/collection.ts`);
//! unlike TS it stores owned records and hands back borrows (`&T`) rather than
//! lazily-wrapped view objects.

use crate::generated::ExternalReference;
use std::collections::HashMap;
use std::sync::Arc;

use super::game_mode::{GameModeView, Listed, ModeScope, ModesOf};
use super::normalize::normalize_name;

/// A collection of one entity type, exposing id / name / faction lookups.
///
/// `T` is the raw (generated) record type. Built via [`Collection::build`],
/// which takes extractor closures but does not retain them — every index is
/// precomputed, so the struct holds no borrows and is free of self-referential
/// lifetimes.
pub struct Collection<T> {
    core: Arc<Core<T>>,
    /// The game mode this view lists.
    view: GameModeView,
    /// The records this view lists (positions in `core.items` plus a
    /// materialised copy), shared per mode; `None` lists every record.
    listed: Option<Arc<Listed<T>>>,
}

impl<T> Clone for Collection<T> {
    fn clone(&self) -> Self {
        Self {
            core: Arc::clone(&self.core),
            view: self.view,
            listed: self.listed.clone(),
        }
    }
}

/// The records and indexes every view of a collection shares.
struct Core<T> {
    items: Vec<T>,
    by_id: HashMap<String, usize>,
    by_norm: HashMap<String, Vec<usize>>,
    by_faction: HashMap<String, Vec<usize>>,
    /// Per-faction id index: faction_id → (id → item index). Lets an id shared
    /// across factions resolve to a specific faction's copy (see `get_in_faction`).
    by_faction_id: HashMap<String, HashMap<String, usize>>,
    /// Exact external source identity → every matching item index.
    by_external_ref: HashMap<String, Vec<usize>>,
    /// Normalized name per item (parallel to `items`), for the substring fallback.
    norm_names: Vec<Option<String>>,
    /// Ids registered under >1 faction; populated by
    /// [`with_unscoped_guard`](Self::with_unscoped_guard).
    ambiguous_ids: Option<std::collections::HashSet<String>>,
    /// Renamed-id map (old id → current id), consulted by id lookups only on a
    /// `by_id` miss so a persisted reference to a since-renamed id still
    /// resolves. Pre-flattened, so one hop suffices. Populated by
    /// [`with_id_aliases`](Self::with_id_aliases). Mirror of the TS `idAliases`.
    id_aliases: Option<HashMap<String, String>>,
    /// Noun for the guard panic message (e.g. `"unit"`).
    entity_label: &'static str,
    /// How records map to game modes, plus the cached per-mode listings.
    scope: ModeScope<T>,
}

impl<T> Collection<T> {
    /// Build a collection, indexing each kept record by id, normalized name, and
    /// faction.
    ///
    /// - `id_of` — the record's primary id (e.g. `|u| u.id.to_string()`).
    ///   Returns an owned `String` so string-newtype ids (`EntityId`) and
    ///   `Display`-based string enums (e.g. `ForceDispositionId`) work alike;
    ///   it is only invoked at build time.
    /// - `name_of` — its display name, if any (drives [`find`](Self::find)).
    /// - `faction_of` — its owning faction id, if any (drives
    ///   [`by_faction`](Self::by_faction)).
    /// - `dedupe_of` — the uniqueness key; first occurrence wins. Pass a
    ///   composite (e.g. `(faction_id, id)`) for records that legitimately share
    ///   an id across factions so distinct copies are preserved.
    pub fn build(
        items: Vec<T>,
        id_of: impl Fn(&T) -> String,
        name_of: impl Fn(&T) -> Option<&str>,
        faction_of: impl Fn(&T) -> Option<&str>,
        dedupe_of: impl Fn(&T) -> String,
    ) -> Self {
        // No aliases by default — only some collections (units) answer to them.
        Self::build_with_aliases(items, id_of, name_of, |_| Vec::new(), faction_of, dedupe_of)
    }

    /// Like [`build`](Self::build) but also indexes alternate names.
    ///
    /// - `aliases_of` — alternate names the record answers to (e.g. spelling
    ///   variants from other tools' exports). Each is indexed into the
    ///   normalized-name map alongside the canonical name, so
    ///   [`find`](Self::find) / [`find_all`](Self::find_all) match an alias
    ///   exactly — but an alias is never returned as the record's display name,
    ///   and the canonical name always wins a collision (aliases are appended
    ///   after the canonical entry and any alias that normalizes to the record's
    ///   own canonical name is skipped). Mirror of the TS `aliasesOf`.
    pub fn build_with_aliases(
        items: Vec<T>,
        id_of: impl Fn(&T) -> String,
        name_of: impl Fn(&T) -> Option<&str>,
        aliases_of: impl Fn(&T) -> Vec<&str>,
        faction_of: impl Fn(&T) -> Option<&str>,
        dedupe_of: impl Fn(&T) -> String,
    ) -> Self {
        let mut kept: Vec<T> = Vec::with_capacity(items.len());
        let mut by_id: HashMap<String, usize> = HashMap::new();
        let mut by_norm: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_faction: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_faction_id: HashMap<String, HashMap<String, usize>> = HashMap::new();
        let mut norm_names: Vec<Option<String>> = Vec::with_capacity(items.len());
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        for item in items {
            if !seen.insert(dedupe_of(&item)) {
                continue; // first-wins dedup
            }
            let idx = kept.len();

            // First-wins for shared ids (a later faction copy doesn't clobber).
            by_id.entry(id_of(&item)).or_insert(idx);

            let norm = name_of(&item).map(normalize_name);
            if let Some(key) = &norm {
                by_norm.entry(key.clone()).or_default().push(idx);
            }
            // Index aliases after the canonical name, skipping empties and any
            // alias that normalizes to the canonical name, so an alias can never
            // displace the canonical owner of a normalized key.
            for alias in aliases_of(&item) {
                let alias_key = normalize_name(alias);
                if alias_key.is_empty() || norm.as_deref() == Some(alias_key.as_str()) {
                    continue;
                }
                by_norm.entry(alias_key).or_default().push(idx);
            }
            norm_names.push(norm);

            if let Some(faction) = faction_of(&item) {
                by_faction.entry(faction.to_string()).or_default().push(idx);
                by_faction_id
                    .entry(faction.to_string())
                    .or_default()
                    .entry(id_of(&item))
                    .or_insert(idx);
            }

            kept.push(item);
        }

        Self {
            core: Arc::new(Core {
                items: kept,
                by_id,
                by_norm,
                by_faction,
                by_faction_id,
                by_external_ref: HashMap::new(),
                norm_names,
                ambiguous_ids: None,
                id_aliases: None,
                entity_label: "entity",
                scope: ModeScope::unscoped(),
            }),
            view: GameModeView::All,
            listed: None,
        }
    }

    /// The shared core, mutably — only while building, before any view of
    /// this collection exists.
    fn core_mut(&mut self) -> &mut Core<T> {
        Arc::get_mut(&mut self.core).expect("collection builders run before any view is taken")
    }

    /// Scope the collection by game mode: `modes_of` reads a record's
    /// `game_modes`. Builder step; the collection keeps listing every record
    /// until [`with_game_mode`](Self::with_game_mode) picks a view.
    pub(super) fn with_game_modes(mut self, modes_of: ModesOf<T>) -> Self {
        self.core_mut().scope = ModeScope::scoped(modes_of);
        self
    }

    /// This collection viewed in another game mode, sharing the record store
    /// and every index. Listings borrow a per-mode copy of the listed records,
    /// cloned once per mode and shared by every view of this collection.
    /// Unscoped collections list every record in every view.
    pub fn with_game_mode(&self, view: GameModeView) -> Self
    where
        T: Clone,
    {
        Self {
            core: Arc::clone(&self.core),
            view,
            listed: self.core.scope.listed(&self.core.items, view),
        }
    }

    /// The game mode this view lists.
    pub fn game_mode(&self) -> GameModeView {
        self.view
    }

    /// Whether this view lists `item` (a record of this collection).
    pub fn lists(&self, item: &T) -> bool {
        self.core.scope.lists(item, self.view)
    }

    /// Arm the unscoped-lookup tripwire: after this, a faction-less
    /// [`get`](Self::get) of an id that exists under more than one faction
    /// panics in debug builds (it would silently return whichever copy
    /// registered first — the wrong divergent fields). Use for collections
    /// whose per-faction copies diverge (units, detachments, weapons,
    /// abilities), so callers are forced through
    /// [`get_in_faction`](Self::get_in_faction) or opt out explicitly with
    /// [`get_any`](Self::get_any). Release builds degrade to the historical
    /// first-wins behaviour rather than crashing a consumer. Mirror of the TS
    /// `guardUnscoped` (whose non-production tripwire maps to
    /// `debug_assertions` here).
    pub fn with_unscoped_guard(mut self, entity_label: &'static str) -> Self {
        let mut ambiguous: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut seen: HashMap<&str, u32> = HashMap::new();
        for per_faction in self.core.by_faction_id.values() {
            for id in per_faction.keys() {
                *seen.entry(id.as_str()).or_insert(0) += 1;
            }
        }
        for (id, count) in seen {
            if count > 1 {
                ambiguous.insert(id.to_string());
            }
        }
        let core = self.core_mut();
        core.ambiguous_ids = Some(ambiguous);
        core.entity_label = entity_label;
        self
    }

    /// Attach a renamed-id map (old id → current id). Id lookups
    /// ([`get`](Self::get)/[`get_any`](Self::get_any)/[`get_in_faction`](Self::get_in_faction)/
    /// [`has`](Self::has)) consult it only when the exact id misses, so a
    /// persisted reference to a since-renamed id still resolves. The map is
    /// expected to be pre-flattened (each key maps directly to a terminal live
    /// id). Mirror of the TS `idAliases` (typically the share registry's
    /// `aliases`).
    pub fn with_id_aliases(mut self, id_aliases: HashMap<String, String>) -> Self {
        self.core_mut().id_aliases = Some(id_aliases);
        self
    }

    /// Build the many-to-many external-source identity index.
    pub fn with_external_refs(mut self, refs_of: impl Fn(&T) -> &[ExternalReference]) -> Self {
        let core = self.core_mut();
        for (index, item) in core.items.iter().enumerate() {
            for reference in refs_of(item) {
                let key = format!(
                    "{}\0{}",
                    reference.namespace.as_str(),
                    reference.id.as_str()
                );
                core.by_external_ref.entry(key).or_default().push(index);
            }
        }
        self
    }

    /// Item index for an id: exact `by_id`, falling back through the
    /// [`id_aliases`](Self::with_id_aliases) map (one hop) on a miss.
    fn raw_index(&self, id: &str) -> Option<usize> {
        let core = &*self.core;
        if let Some(&i) = core.by_id.get(id) {
            return Some(i);
        }
        core.id_aliases
            .as_ref()
            .and_then(|m| m.get(id))
            .and_then(|new_id| core.by_id.get(new_id).copied())
    }

    /// Every record this view lists, deduplicated, in first-seen order.
    pub fn all(&self) -> &[T] {
        match &self.listed {
            Some(listed) => &listed.items,
            None => &self.core.items,
        }
    }

    /// Number of distinct records this view lists.
    pub fn len(&self) -> usize {
        self.all().len()
    }

    /// Whether this view lists no records.
    pub fn is_empty(&self) -> bool {
        self.all().is_empty()
    }

    /// Every record in every game mode, ignoring this view's mode. For
    /// internal enumerations that must see the whole dataset and for the
    /// reverse indexes, whose stored positions index this slice.
    pub(super) fn every(&self) -> &[T] {
        &self.core.items
    }

    /// Return every record carrying the exact external source identity, in
    /// every game mode (an id lookup, not a listing).
    ///
    /// External mappings are many-to-many, so this always returns a collection.
    pub fn by_external_ref(&self, namespace: &str, id: &str) -> Vec<&T> {
        let key = format!("{namespace}\0{id}");
        self.core
            .by_external_ref
            .get(&key)
            .map(|indices| {
                indices
                    .iter()
                    .map(|&index| &self.core.items[index])
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Look up by exact id, in every game mode.
    ///
    /// For a guarded collection (see
    /// [`with_unscoped_guard`](Self::with_unscoped_guard)), an id that exists
    /// under more than one faction panics in debug builds — pass a faction via
    /// [`get_in_faction`](Self::get_in_faction), or call
    /// [`get_any`](Self::get_any) when faction is genuinely unknown. Release
    /// builds degrade to first-wins.
    pub fn get(&self, id: &str) -> Option<&T> {
        #[cfg(debug_assertions)]
        if let Some(ambiguous) = &self.core.ambiguous_ids {
            if ambiguous.contains(id) {
                panic!(
                    "Ambiguous {} lookup: \"{id}\" exists under multiple factions; \
                     a faction-less get() would return whichever copy registered first \
                     (wrong divergent fields). Use get_in_faction(\"{id}\", faction_id), \
                     or get_any(\"{id}\") when faction is genuinely unknown (import / conformance).",
                    self.core.entity_label,
                );
            }
        }
        self.raw_index(id).map(|i| &self.core.items[i])
    }

    /// First-wins lookup by exact id that never panics, for callers with no
    /// faction context on purpose (roster import, the conformance runner). For
    /// a guarded collection this is the explicit opt-out of
    /// [`get`](Self::get)'s ambiguity tripwire; for an unguarded one it is
    /// identical to `get`. Resolves in every game mode. Mirror of the TS
    /// `getAny`.
    pub fn get_any(&self, id: &str) -> Option<&T> {
        self.raw_index(id).map(|i| &self.core.items[i])
    }

    /// Look up by exact id *within a faction*, in every game mode. Returns the
    /// record with `id` belonging to `faction_id`, or `None`. Use when an id is
    /// shared across factions and faction context is known — [`get`](Self::get)
    /// returns whichever copy registered first, which may be the wrong
    /// faction's. Mirror of the TS `getInFaction`.
    pub fn get_in_faction(&self, id: &str, faction_id: &str) -> Option<&T> {
        let core = &*self.core;
        // Resolve a renamed id to its current form before scoping to the faction.
        let resolved: &str = if core.by_id.contains_key(id) {
            id
        } else {
            core.id_aliases
                .as_ref()
                .and_then(|m| m.get(id))
                .map(String::as_str)
                .unwrap_or(id)
        };
        core.by_faction_id
            .get(faction_id)
            .and_then(|m| m.get(resolved))
            .map(|&i| &core.items[i])
    }

    /// Whether a record with this exact id (or a renamed alias of it) exists,
    /// in any game mode.
    pub fn has(&self, id: &str) -> bool {
        self.raw_index(id).is_some()
    }

    /// Record at a stored index into [`every`](Self::every) (used by
    /// [`Dataset`](super::Dataset)'s reverse indexes), or `None` when this
    /// view does not list it.
    pub(super) fn listed_at(&self, idx: usize) -> Option<&T> {
        let item = &self.core.items[idx];
        self.lists(item).then_some(item)
    }

    /// Record at a stored index into [`every`](Self::every), in any game mode.
    pub(super) fn at(&self, idx: usize) -> &T {
        &self.core.items[idx]
    }

    /// Find one record this view lists by id or name, returning the first
    /// match.
    ///
    /// Name matching is diacritic- and punctuation-insensitive (see
    /// [`normalize_name`](super::normalize_name)), trying in order: exact id →
    /// exact normalized name → normalized-name substring. Names can repeat
    /// across factions, so use [`find_all`](Self::find_all) or
    /// [`by_faction`](Self::by_faction) when a query may be ambiguous.
    pub fn find(&self, query: &str) -> Option<&T> {
        self.find_all(query).into_iter().next()
    }

    /// All records this view lists matching a query, by the same rules as
    /// [`find`](Self::find).
    ///
    /// An exact id match returns just that record; otherwise every
    /// normalized-name-exact match is returned, falling back to every
    /// normalized-name-substring match. Surfaces (rather than silently
    /// collapses) names shared across factions. Every step skips records
    /// outside this view's game mode, the exact-id step included: a search
    /// lists, so it never returns a hidden record (use
    /// [`get_any`](Self::get_any) to resolve one by id).
    pub fn find_all(&self, query: &str) -> Vec<&T> {
        let core = &*self.core;
        if let Some(i) = self.raw_index(query) {
            if let Some(item) = self.listed_at(i) {
                return vec![item];
            }
        }
        let key = normalize_name(query);
        if let Some(idxs) = core.by_norm.get(&key) {
            let exact: Vec<&T> = idxs.iter().filter_map(|&i| self.listed_at(i)).collect();
            if !exact.is_empty() {
                return exact;
            }
        }
        if key.is_empty() {
            return Vec::new();
        }
        self.iter_indexed()
            .filter_map(|(i, item)| match &core.norm_names[i] {
                Some(name) if name.contains(&key) => Some(item),
                _ => None,
            })
            .collect()
    }

    /// Records of a faction id that this view lists (empty if the type has no
    /// faction).
    pub fn by_faction(&self, faction_id: &str) -> Vec<&T> {
        self.core
            .by_faction
            .get(faction_id)
            .map(|idxs| idxs.iter().filter_map(|&i| self.listed_at(i)).collect())
            .unwrap_or_default()
    }

    /// Iterate the distinct records this view lists, in first-seen order.
    pub fn iter(&self) -> std::slice::Iter<'_, T> {
        self.all().iter()
    }

    /// Listed records paired with their index into [`every`](Self::every).
    fn iter_indexed(&self) -> impl Iterator<Item = (usize, &T)> {
        let items = &self.core.items;
        let indices: Box<dyn Iterator<Item = usize> + '_> = match &self.listed {
            Some(listed) => Box::new(listed.indices.iter().copied()),
            None => Box::new(0..items.len()),
        };
        indices.map(move |i| (i, &items[i]))
    }
}

impl<'a, T> IntoIterator for &'a Collection<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
