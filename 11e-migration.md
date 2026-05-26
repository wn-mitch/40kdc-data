# 11th Edition Migration — TODO

The shared schema layer for the [Tabletop Developer Consortium](https://tabletop-developer-consortium.github.io) is migrating to Warhammer 40K 11th edition. This document is the durable, citable tracker for that migration. This file scopes the work to `40kdc-data` specifically; cross-repo strategic context (captured 11e intel, disposition matrix, sequencing) lives in the consortium's parent migration doc.

- **Parent (cross-repo)**: [`tabletop-developer-consortium.github.io/11e-migration.md`](https://github.com/Tabletop-Developer-Consortium/tabletop-developer-consortium.github.io/blob/main/11e-migration.md)
- **Sister trackers**: [`shadowboxing`](https://github.com/wn-mitch/shadowboxing/blob/main/11e-migration.md), [`army-assist`](https://github.com/wn-mitch/army-assist/blob/main/11e-migration.md)

## Positioning

**`40kdc-data` is the canonical upstream**, designed to be adopted by community tooling (BattleScribe, NewRecruit, Wahapedia, list builders) — not derived from them. We define the canonical encoding for new mechanics (Detachment Points, Force Dispositions, terrain-area keywords) ourselves and publish it. Downstream parsers in `bevy-deploy-helper`, `army-assist`, etc. translate from third-party list exports *into* our schema, not the reverse.

## Status

- **10e archive**: branch [`10e-archive`](https://github.com/Tabletop-Developer-Consortium/40kdc-data/tree/10e-archive), tags [`10th/2025-q3`](https://github.com/Tabletop-Developer-Consortium/40kdc-data/releases/tag/10th/2025-q3) and [`10e-final`](https://github.com/Tabletop-Developer-Consortium/40kdc-data/releases/tag/10e-final) — frozen snapshot of the 10th edition dataset. `10e-final` is the uniform cross-repo marker for the 10e freeze point; `10th/2025-q3` is the dataslate-style native tag (both point at the same commit).
- **`main`**: 11th edition development. The schema layer carries forward; `data/core/` is being repopulated faction-by-faction as 11e datasheets land.

## Confirmed 11e mechanics (from WCommunity previews, May 2026)

These are the schema-affecting facts. Sources at the bottom of the file.

### Detachments

- New `detachment_points` integer (1–3): a detachment carries a points cost in a new currency, separate from per-unit points.
- New `force_dispositions` array: each detachment grants one or more Force Dispositions.
- Battle size determines budget: **Incursion (1000 pts) = 2 detachment points**; **Strike Force (2000 pts) = 3 detachment points**.
- Existing 10e detachments remain valid in 11e; ~70 new ones arrive with the edition.

### Force Dispositions

Five values, exhaustive at launch — strategic-intent tags, not unit-category counters:

- `take-and-hold`
- `disruption`
- `purge-the-foe`
- `priority-assets`
- `reconnaissance`

Each Force Disposition has community-authored description text (IP stance: original prose only). Drives mission selection — players compare dispositions at game start to determine which mission both play; asymmetric primary objectives result.

### Missions / scoring

- **VP caps**: 45 VP per game per Primary, 15 VP per battle round per Primary; same caps for Secondaries.
- **Asymmetric primaries**: when sides pick different dispositions, they get different primary objectives.
- **Launch deployment patterns**: Dawn of War, Hammer and Anvil, Tipping Point.
- Three recommended terrain layouts ship at launch.

### Secondaries

- New deck mechanic: **draw 2 cards per turn, keep unscored cards** (no discard-on-fail penalty for early draws). Deck-level rule, separate from per-card structure.

### Combat / Fight phase

- **Engagement range = 2"** (was 1").
- **Charge: target selected after rolling**, not before. Charging units gain Fights First until end of turn.
- **Pile In timing**: all active-player Pile Ins resolved first, then opponent's, *before* fighting starts. Different from 10e's per-unit interleave.
- **Consolidate** moves resolve simultaneously after all fighting ends.
- **"Overrun Fight"**: units that became unengaged (targets destroyed) get an additional Pile In before fighting new targets. Replaces 10e Pile In/Consolidate semantics.
- **Deep Strike: 8" from enemies** (was 9").

### Terrain

New terrain-area keywords:

- **Obscuring** — blocks line of sight; gives Infantry/Beast/Swarm a **−1 to enemy Ballistic Skill** (replaces the old +1 save bonus).
- **Hidden** — Infantry/Beast/Swarm in a terrain area that didn't shoot last turn are only visible within 15".
- **Plunging Fire** — units on terrain 3"+ tall shooting ground-level targets get +1 BS; the `TOWERING` keyword interacts within 12".

Standard terrain area templates: four 7"×11.5" rectangles, two 8"×11.5" right triangles, four 6"×4" medium rectangles, two 10"×2.5" long lines, four 6"×2" short lines.

### Cover

Cover now confers **−1 BS to attackers**, not +1 save to defenders. Any 10e Ability DSL entries that modeled cover as `save-modifier +1` need re-targeting to `bs-modifier −1` when ported to 11e.

### Units / characters

- **Datasheet stat profile is unchanged** in 11e (M/T/W/Sv/invuln_sv/Ld/OC carry forward).
- Characters attach as **Leader** or **Support** — a unit can have one of each. Selection at list-build, not at game start. The **Support** role generalizes what were army-specific exceptions in 10e ("additional leader" attachments like Apothecaries, Ancients, Lieutenants, Plague Surgeons, Kroot Shapers, etc.). 11e standardizes this as a first-class ability — the Ork **Bannernob** is the canonical preview example. Asymmetry: **Support characters cannot be taken solo** — they are only legal in an army list when attached to a host unit. Leaders remain valid as standalone entries. List-build validation needs an `attachment_required` invariant for Support (or a documented rule that `attachment_role == "support"` implies it). Schema-side: `attachment_role` on the unit replaces the per-attachment `max_leaders_per_unit` escape hatch. Data-side: the port (Section 6) writes `attachment_role: "support"` directly from a curated registry — see `tools/src/known-support-10e.ts`.
- **Battleline units have doubled unit limits** in army-list construction.
- **Enhancements** can have an `upgrade_tag` flag that lets the enhancement apply to up to 3 non-character units while counting as one Enhancement choice.

---

## Section 1 — Branch + data hygiene

- [x] Cut `10e-archive` branch from `main` and push to origin.
- [x] Tag `10th/2025-q3` at the archive commit and push.
- [x] Add archive pointer banner to `README.md` on `main` so consumers landing during the transition find the archived data immediately.
- [x] Remove all 10e-tagged faction directories under `data/core/` and `data/enrichment/`. Keep the `_example/` directories.
- [x] Run `cd tools && npm run validate` — confirms pipeline stays green with empty data dirs.

## Section 2 — Schema audit + 11e additions

**Modify existing:**

- [ ] `schemas/$defs/common.schema.json` (phase enum, lines 44–48) — decide: extend with 11e additions, or split into edition-versioned `$defs`. Document resolution in `VERSIONING.md`. Previews don't show new top-level phases, but Pile In timing reshuffles within Fight.
- [ ] `schemas/core/stratagem.schema.json` `type` enum (`battle-tactic | strategic-ploy | epic-deed | wargear`) — confirm 11e card categories before bumping; allow free-form fallback if GW reshuffles.
- [x] `schemas/core/unit.schema.json` — added `attachment_role: "leader" | "support" | null` for character units that join other units (#5). **Decision**: the must-attach invariant for Support is encoded *implicitly on the enum value* (`"support"` is documented to imply the unit is not a legal standalone list entry; list-builders enforce), not as a separate `attachment_required: boolean`. Simpler schema, splittable later if 11e adds a standalone Support.
- [ ] `schemas/core/weapon.schema.json` — audit free-form ability list against 11e additions; no enum lock to break. Specific 11e keywords TBD on dataslate publish.
- [x] `schemas/core/enhancement.schema.json` — added `upgrade_tag: boolean` and `max_targets: integer` (default 1) (#5).
- [x] `schemas/core/detachment.schema.json` — added `detachment_points: integer | null` (1–3) and `force_dispositions: array of entity-id` referencing force-disposition entities (#5).
- [x] `schemas/core/leader-attachment.schema.json` — removed `max_leaders_per_unit` (#5). The 10e Support workaround is superseded by `attachment_role` on the character unit; the data-side companion transform is Section 6.2.
- [x] `schemas/core/game-version.schema.json` — already accepts `11th` via the existing pattern. Widened `$defs/dataslate-version` (#5) to accept named kebab-case slugs (e.g. `pre-launch-provisional`) alongside quarterly tags; added the dataslate to `data/core/_example/game-versions.example.json`. The real `data/core/game-versions.json` registry entry now exists alongside the port (PR #6).
- [ ] New `$defs/battle-size` — `incursion` (1000 pts / 2 DP), `strike-force` (2000 pts / 3 DP).
- [x] Added `points_provisional: boolean` (default `false`) sibling on the points-bearing schemas `unit` and `enhancement` (#5). **Correction**: `unit-composition` was listed here but carries no `points` field (per-composition costs live in `unit.points`), so it gets no flag. Set `true` during the 10e→11e port (Section 6); flipped to `false` when real 11e points land.

**New schemas:**

- [ ] `schemas/core/terrain-layout.schema.json` — pieces, footprints, `link_group` (linked terrain = single objective), `is_objective` flag with marker metadata, `terrain_area_keywords` enum (`obscuring | hidden | plunging-fire`, extensible), `height_inches` (gates Plunging Fire), footprint template enum aligned to GW's published shapes.
- [ ] `schemas/core/mission.schema.json` — primary mission entries with `vp_per_game_cap` (default 45), `vp_per_round_cap` (default 15), reference to deployment-pattern, force-disposition matchups → primary objective bindings.
- [ ] `schemas/core/deployment-pattern.schema.json` — launch patterns `dawn-of-war`, `hammer-and-anvil`, `tipping-point`. Each carries deployment-zone polygons and **territory polygons** (per-side, mirroring deployment shape). Recommended terrain layouts reference terrain-layout entities by id.
- [ ] `schemas/core/secondary-card.schema.json` — multi-block card structure (deck-level "draw 2 / keep unscored" rule separate from per-card shape):
  - `id` (stable; referenced by other cards by id)
  - `name`, `subtype`
  - `when_drawn`: optional Ability DSL block (reshuffle / replace / alt-draw, may reference other cards by id)
  - `action`: `starts` (phase trigger), `units` (eligibility predicate), `use_limit`, `completes`, `effect` (DSL effect, may mark transient state on terrain pieces)
  - `awards`: list of VP-award blocks, each with `trigger`, `when` (DSL condition), `vp` value
  - `text`: original consortium-authored prose, single-author → maintainer review
  - Primary mission cards reuse this shape.
- [x] `schemas/core/force-disposition.schema.json` — `id`: enum of the 5 confirmed values; `name`: display string; `text`: community-authored description (#5).

## Section 3 — Ability DSL primitives

Additive — these extend type enums without breaking existing abilities.

- [x] `schemas/enrichment/ability-dsl/condition.schema.json` `$defs/simple-condition/type` — add:
  - `terrain-area-control` (per-model count for a terrain footprint).
  - `engagement-state` (`engaged | within-engagement-range | unengaged`; 11e engagement range is 2").
  - `territory-control` (predicate over territory polygons).
  - `fights-first` (boolean predicate).
  - `disposition-matches` (predicate for asymmetric-primary mission resolution).
- [x] `schemas/enrichment/ability-dsl/effect.schema.json` `$defs/single-effect/type` — add:
  - `charge-roll-modifier`.
  - `terrain-area-tag` (sets transient state on a terrain piece, cleared on turn rollover).
  - `bs-modifier` (cover and the new terrain keywords all work through BS modification — applied to the *attacker's* BS via `target: "attacker"`, i.e. −1 to the incoming shot's hit roll, not a defender bonus).
  - `engagement-passthrough` (units can move through enemy engagement ranges in 11e movement).
- [x] `schemas/enrichment/ability-dsl/scope.schema.json` — added `terrain-within-range` to the `range` enum (pairs with the existing `range_inches`). **Decision**: landed now rather than held — the terrain-bearing condition/effect primitives in this same change (`terrain-area-control`, `terrain-area-tag`) are its natural consumers.
- [ ] **Cover audit**: when 10e enrichment is ported forward to 11e, any ability that modeled cover as `save-modifier +1` must be re-targeted to `bs-modifier −1`. The 10e archive remains untouched; the rewrite happens during 11e enrichment authoring.
- [x] Add valid + invalid test fixtures for each new primitive in `tools/test/fixtures/` — `valid/abilities-good.json` (one entry per primitive; `bs-modifier` uses the cover shape `target: "attacker"` / `−1`) and `invalid/abilities-bad.json` (misspelled enums, missing `target`, unknown condition type). First abilities fixtures in the repo; picked up automatically by the glob-driven `validate.test.ts`.

## Section 4 — Tools / pipeline

- [ ] **Authoring path**: hand-authored JSON validated against schemas is the primary workflow. `tools/src/convert-faction.ts` (the army-assist bootstrap) stays available for jump-starting a faction file but is not the long-term workflow. Document this in `CONTRIBUTING.md`.
- [ ] **Publish as npm package**: add `publishConfig` and version policy to `tools/package.json`. Embed schemas + generated TypeScript types in the package payload. CI auto-publish on tagged release.
- [ ] **Publish as Rust crate**: greenfield — no existing scaffold. Create `crates/40kdc-data/` with `schemars`/`typify`-generated structs from schemas. CI auto-publish to crates.io on tag.
- [ ] **Extend `tools/src/validate.ts` SCHEMA_MAP** (lines 27–43) with prefixes for new entities: `terrain-layouts`, `missions`, `deployment-patterns`, `secondary-cards`, `force-dispositions`.
- [ ] **CI extensions** (`.github/workflows/validate.yml`):
  - Block PRs on Ability DSL parse errors.
  - Block PRs on missing required 11e fields once schemas bump.
  - Auto-publish npm + crate on tag.

## Section 5 — Docs

- [ ] `VERSIONING.md` — add 11th-edition examples; clarify that `data/core/` will follow the same `{edition}/{dataslate}/` subdir convention as enrichment going forward.
- [ ] `CONTRIBUTING.md` — add the secondary-card text workflow: single-author drafts original prose, maintainers review for IP-cleanliness (no quoted GW text) and gameplay accuracy.
- [ ] `README.md` — once the npm package and Rust crate publish, add consumption snippets and drop "10th edition" phrasing in favor of edition-agnostic language. The archive-pointer banner stays until the transition completes.
- [ ] `CLAUDE.md` — update the "Game phases" line if the phase enum changes.

## Section 6 — Port 10e data forward as 11e seed

GW previews indicate datasheet stat profiles (M/T/W/Sv/invuln/Ld/OC) and most ability mechanics carry forward into 11e. The `10e-archive` branch is therefore viable as a *seed* for 11e: port it forward tagged provisional, let real 11e datasheets overwrite as they publish. This front-loads downstream tooling integration, exercises Section 2's schema deltas against realistic data, and surfaces the per-entity audit categories as concrete migration work.

**Prerequisite** (satisfied): Section 2 schema bumps for `attachment_role`, `upgrade_tag`/`max_targets`, `detachment_points`/`force_dispositions`, and `points_provisional` landed on `main` (PR #5). The port validates against them.

### 6.0 Strategy

- **Source**: `10e-archive` branch — `data/core/` (232 files across 35 factions) and `data/enrichment/` (23 factions with abilities + phase-mappings; `world-eaters` additionally has `resource-pools.json` and `timing-flags.json`).
- **Target dataslate**: `11th / pre-launch-provisional` (added in Section 2 alongside the `game-versions.json` entry). The dataslate name itself signals provisional status to consumers; real numbered dataslates overwrite as 11e datasheets publish.
- **Provisional points**: every entity carrying `points` gets `points_provisional: true` during the port (schema delta tracked in Section 2). Flipped to `false` per-entity when real 11e values land.
- **IP stance unchanged**: stat lines and points are numerical facts (permitted); ability DSL entries remain community-authored. The port does not introduce any original prose.

### 6.1 Tooling

- [x] Build `tools/src/port-10e-faction.ts <faction-id>` (and `--all`):
  - Reads `data/{core,enrichment}/<faction-id>/*.json` from the `10e-archive` ref via `git show`; discovers files with `git ls-tree`, porting only the files that exist (preserves SM-successor inheritance, see 6.5).
  - Rewrites every `game_version` to `{ edition: "11th", dataslate: "pre-launch-provisional" }`.
  - Sets `points_provisional: true` on the points-bearing schemas (`units`, `enhancements`).
  - Default-fills new schema fields where unambiguous: `enhancement.upgrade_tag = false`, `enhancement.max_targets = 1`, `detachment.detachment_points = null`, `detachment.force_dispositions = []`.
  - Emits `data/_port-audit/<faction>.json` (outside the `core/**` / `enrichment/**` validation globs) listing every entry needing manual review, plus a rolled-up `data/_port-audit/summary.md` (see 6.6).
- [x] Distinct from `tools/src/convert-faction.ts` (army-assist bootstrap). Both stay available; new script is purpose-built for archive→11e.
- [x] Exit non-zero if the resulting tree fails validation against the bumped schemas.

### 6.2 Per-entity transformations — `data/core/`

Items marked **audit** are flagged in `data/_port-audit/<faction>.json`, not auto-rewritten.

> **Correction (post-inspection).** The original plan keyed the Support migration on `max_leaders_per_unit > 1` in the 10e data. That signal **does not exist anywhere in the archive** (scanned all 35 factions; every `leader-attachments` entry is `max_leaders_per_unit: 1`), and no other structured field captures the 10e "additional leader" rule — it lived only in the (IP-restricted) datasheet text. Support is therefore sourced from `tools/src/known-support-10e.ts`, a two-layer registry: (1) `FROM_UPSTREAM_SCRAPE` derived deterministically from army-assist `Datasheets.json` `leader_head` text, and (2) `MANUAL_OVERLAY` for units the community scrapes missed (the three Kroot Shapers were dropped by both army-assist and shadowboxing) plus non-character special cases (Cryptothralls). The port writes `attachment_role: "support"` directly from the registry. The Ork Bannernob and any future Support entries that aren't in the 10e archive are net-new 11e authoring, not a port outcome.

- **`factions.json`** — bump `game_version`. No other changes.
- **`units.json`** — bump `game_version`; statlines carry verbatim; mark `points_provisional: true`. Attachment role is set with the registry taking precedence over the leader-attachment table: a unit listed in `tools/src/known-support-10e.ts` becomes `attachment_role: "support"` (even if it isn't a `leader_id` — the Cryptothralls case); otherwise a `leader_id` becomes `"leader"`; non-attaching units get no role. The port warns if a registry entry doesn't match an archive unit, and records each assignment in the audit as `support-assigned` so summary.md surfaces the roster.
- **`weapons.json`** — bump `game_version`; the `abilities` list is free-form and carries forward. **Audit**: flag weapons whose ability strings reference cover or engagement semantics for re-check once 11e weapon keywords publish.
- **`enhancements.json`** — bump `game_version`; mark `points_provisional: true` (the points field is `cost`; the flag is a sibling boolean); default-fill `upgrade_tag: false`, `max_targets: 1`.
- **`detachments.json`** — bump `game_version`; carry forward (10e detachments remain valid in 11e per the confirmed mechanics); default-fill `detachment_points: null` and `force_dispositions: []`. **Audit**: every detachment needs human-assigned DP cost (1–3) and Force Disposition list once GW publishes the mapping.
- **`stratagems.json`** — bump `game_version` only. (Originally held pending Section 2's `type`-enum decision; the 10e enum `battle-tactic | strategic-ploy | epic-deed | wargear` is unchanged on `main`, so the data validates as-is. Porting now keeps detachment→stratagem refs intact; **audit (stratagem-type)** flags every stratagem for 11e reconciliation if GW reshuffles categories.)
- **`unit-compositions.json`** — bump `game_version` only. Compositions carry no `points`/`cost` (per-composition costs live in `unit.points`), so no `points_provisional`. Battleline-doubling is army-list construction, not entity state — no schema impact.
- **`leader-attachments.json`** — drop the retired `max_leaders_per_unit` field from every entry (all are `1`), then bump `game_version`. The schema lost `max_leaders_per_unit` in Section 2 (`additionalProperties: false` would reject it otherwise); this is the data-side companion. No `"support"` cases arise here — see the correction above.

### 6.3 Per-entity transformations — `data/enrichment/`

- **`abilities.json`** — bump `game_version`. Three audit passes (flag only, no rewrite):
  1. **Cover audit**: the DSL has **no `save-modifier` effect type** — cover is encoded as `ability-grant` of `benefit-of-cover` (51 instances across the archive). The audit flags abilities granting `benefit-of-cover`; what changes in 11e is the *definition* of `benefit-of-cover` (was +1 Sv, becomes −1 BS), so the granted ability is the rewrite target, not the granting ability. (Section 3 owns the DSL primitive; Section 6 owns surfacing the data.)
  2. **Engagement-range audit**: flag abilities whose string values reference the 10e `1"` engagement constant → 2" review.
  3. **Charge-timing & Fights First audit**: flag abilities whose effect tree uses `fight-first` or `charged-this-turn`. 11e charging units gain Fights First by default — some 10e abilities are now redundant.
- **`phase-mappings.json`** — bump `game_version`. (No audit: phase-mappings are flat phase lists keyed by source id; the 11e Pile In reorder is a rules-level change not encoded per-entry, so there is nothing to detect.)
- **`resource-pools.json`** / **`timing-flags.json`** (world-eaters only) — bump `game_version`. Carry forward.

### 6.4 Canary: Orks end-to-end

Orks is the canary for the mechanical port. (The Bannernob is *not* in the 10e archive — it's net-new 11e content — so the canary verifies the `"leader"` default and the audit surfacing of support candidates, not a Bannernob→`"support"` transform.)

- [x] Port Orks: `npx tsx tools/src/port-10e-faction.ts orks`.
- [x] Hand-reviewed the resulting tree against `10e-archive:data/core/orks/` and `data/enrichment/orks/` — every transformation in 6.2/6.3 confirmed (game_version, points_provisional, leader role, default-fills, max_leaders dropped, statlines/points identical).
- [x] Verified support detection (initial pass): the FNP heuristic flagged Painboy and Big Mek in Mega Armour. That heuristic was later replaced — see 6.6 — once it became clear it both over-flagged (Tech-Priest Dominus, Overlord) and under-flagged (Apothecary, Ancient line) the real "additional leader" cohort.
- [x] `cd tools && npm test && npm run validate` green.
- [x] Inspected `data/_port-audit/orks.json` — surfaces cover-ability and the detachment-DP / stratagem-type bulk-review lists. (Orks has no Support assignments; no Ork character carries the 10e additional-leader rule per the registry.)
- [x] Spot-checked unit statlines round-trip identical to the 10e archive (all 69 units' profiles + points arrays match).

**Gate**: 6.5 does not start until the Orks canary is green and any script bugs are fixed. ✅ passed.

### 6.5 Bulk sweep — remaining 34 factions

- [x] Ran `npx tsx tools/src/port-10e-faction.ts --all` across all factions; each validates:
  - [x] `adepta-sororitas`, `adeptus-astartes`, `adeptus-custodes`, `adeptus-mechanicus`, `aeldari`, `agents-of-the-imperium`, `astra-militarum`
  - [x] `black-templars`, `blood-angels`, `chaos-daemons`, `chaos-knights`, `chaos-space-marines`, `crimson-fists`, `dark-angels`, `death-guard`, `deathwatch`, `drukhari`
  - [x] `emperors-children`, `genestealer-cults`, `grey-knights`, `imperial-fists`, `imperial-knights`, `iron-hands`, `leagues-of-votann`
  - [x] `necrons`, `raven-guard`, `salamanders`, `space-wolves`, `tau-empire`, `thousand-sons`, `tyranids`, `ultramarines`, `white-scars`, `world-eaters`
- [x] Per-faction validation gate inside the script; full `npm run validate` green afterward.
- [x] **Parent-faction inheritance**: Space Marine successor chapters (black-templars, blood-angels, crimson-fists, dark-angels, deathwatch, imperial-fists, iron-hands, raven-guard, salamanders, space-wolves, ultramarines, white-scars) lack their own `leader-attachments`/`unit-compositions`/`units`/`weapons` in the archive — they inherit from `adeptus-astartes` via `parent_faction_id`. Verified preserved: porting only the files that exist means successors carry only faction/detachment/enhancement/stratagem (e.g. `ultramarines` = 4 files).

### 6.6 Audit-driven human-review tasks

`data/_port-audit/<faction>.json` enumerates entries needing manual work; `data/_port-audit/summary.md` rolls them up. Counts from the completed sweep (35 factions):

- [x] **Support character migration** — 47 units assigned `attachment_role: "support"` directly by the port from `tools/src/known-support-10e.ts`. The registry is a two-layer source: a deterministic scrape of army-assist `Datasheets.json` `leader_head` text (43 units), plus a hand-maintained overlay for entries the upstream community sources missed (the three Kroot Shapers — confirmed missing in both army-assist and shadowboxing) and non-character special cases (Cryptothralls). The port is the durable source of truth — to revert any entry, remove it from the registry and re-run the port. (Net-new 11e Support units like the Ork Bannernob remain separate hand-authoring.)
- [ ] **Cover → BS modifier rewrites** — 51 abilities grant `benefit-of-cover`; the `benefit-of-cover` definition needs re-modelling for 11e (−1 BS, not +1 Sv).
- [ ] **Charge-timing / Fights First redundancy** — 35 abilities flagged.
- [ ] **Engagement-range references** — 0 flagged (no archive ability hard-codes `1"`).
- [ ] **Detachment DP + Force Disposition assignment** — 190 detachments need human-assigned values once GW publishes the mapping.
- [ ] **Stratagem type-enum reconciliation** — 1140 stratagems flagged; revisit if 11e reshuffles the `type` enum.

### 6.7 Verification

- [x] `cd tools && npm test && npm run validate` green with all 35 factions present (13,849 items, 0 failures).
- [x] CI green on the PR introducing the port (PR #6).
- [x] Every ported entity under `data/core/` and `data/enrichment/` carries `game_version.edition == "11th"` (grep check; only the kept `_example/` fixtures retain 10th).
- [x] Every points-bearing entity (`units`, `enhancements`) carries `points_provisional: true` (grep check; flips to `false` per-entity as real 11e values land).
- [x] No leader-attachment entry retains `max_leaders_per_unit` (grep check).
- [x] Audit reports committed under `data/_port-audit/` (per-faction json + `summary.md`) so the human-review queue is visible.

---

## Next steps (forward queue)

Section 6 (port) and Section 3 (DSL primitives) are both complete. The remaining work, in rough dependency order:

1. ~~**Section 3 — Ability DSL primitives**~~ ✅ done — added `bs-modifier`, `engagement-state`, `terrain-area-control`, `terrain-area-tag`, `charge-roll-modifier`, `fights-first`, `disposition-matches`, `engagement-passthrough` (+ scope `terrain-within-range`). The cover-rewrite item in 6.6 is now unblocked.
2. **Section 6.6 audit-driven follow-ups** (now unblocked by §3):
   - Cover rewrite: 51 abilities granting `benefit-of-cover` — re-model the `benefit-of-cover` ability's effect from `+1 Sv` to `-1 BS`.
   - Charge-timing review: 35 abilities — prune any that become redundant under 11e's "charging units gain Fights First by default".
   - Detachment DP + Force Disposition assignment: 190 detachments — gated on GW publishing the mapping.
   - Stratagem type-enum reconciliation: 1140 stratagems — gated on the 11e card categories being confirmed (Section 2's open stratagem item).
3. **Section 2 — remaining schema work**: phase-enum decision (`common.schema.json`), weapon-abilities audit, `$defs/battle-size`, and the four new schemas (`terrain-layout`, `mission`, `deployment-pattern`, `secondary-card`).
4. **Section 4 — tooling / publish**: npm + Rust crate publish, CI extensions (block on DSL parse errors, auto-publish on tag), extend `SCHEMA_MAP` for the new entity prefixes.
5. **Section 5 — docs**: `VERSIONING.md`, `CONTRIBUTING.md` (secondary-card text workflow), `README.md` consumption snippets.

Each numbered item above is a natural next PR.

## Out of scope

- Effort or timeline estimates.
- Specific 11e rule contents — items reference categories, not values.
- IP-stance changes — existing CC0 / CC BY 4.0 / MIT split is unchanged. Secondary-card original-text fits the existing community-authored model.

## Open / tracking

- Stratagem categories — may or may not survive 11e in current form.
- Specific 11e weapon keywords — free-form list in schema absorbs these; we'll list confirmed ones as they're published.
- Full terrain-area keyword catalog — `obscuring | hidden | plunging-fire` confirmed; more likely on dataslate publish.
- List-builder encoding alignment — not blocking. We define our canonical encoding for Detachment Points and Force Dispositions; downstream parsers translate from third-party formats into our schema.

## References

- Building an Army in 11e: https://www.warhammer-community.com/en-gb/articles/95fucn12/building-an-army-in-the-new-edition-of-warhammer-40000/
- How Your Army Affects Your Mission: https://www.warhammer-community.com/en-gb/articles/oefzq9fg/new40k-how-your-army-affects-your-mission/
- Updated Terrain Rules: https://www.warhammer-community.com/en-gb/articles/xlppkx5s/new40k-take-cover-with-updated-terrain-rules/
- Combat Changes: https://www.warhammer-community.com/en-gb/articles/m3son4il/new40k-combat-changes-shake-up-fighting-in-the-new-edition/
- Support ability preview (Ork Bannernob): https://www.warhammer-community.com/en-gb/articles/uwdimgen/new40k-rules-da-biggest-and-best-orks-in-da-box/
