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

Each Force Disposition has community-authored description text (IP stance: original prose only). Drives mission selection — players compare dispositions at game start to determine which mission each plays; asymmetric primary objectives result.

**Card structure (confirmed from card photos, "New Edition Live — Championship Rematch").** A Force Disposition is a physical card carrying a **5-row matchup table**: `PLAYER disposition × OPPONENT disposition → the mission that player plays`. Five dispositions ⇒ a **5×5 = 25 ordered-cell matrix**. Each side reads its own card, finds the opponent's column, and gets its (usually different) mission — so asymmetric primaries fall out of the two players reading different cards. Disposition icons (from the Force Dispositions legend card): green shield+skull = `take-and-hold`, blue hexagon+X = `disruption`, red inverted-triangle+sword = `purge-the-foe`, gold compass/diamond = `priority-assets`, teal eye = `reconnaissance`. All five identified.

### Missions / scoring

- **VP caps**: 45 VP per game per Primary, 15 VP per battle round per Primary; same caps for Secondaries. *(Unconfirmed: stream commentary suggested a single 15/round cap combined across primary + secondary; schema keeps 45-game / 15-round defaults pending the printed pack.)*
- **Asymmetric primaries**: when sides pick different dispositions, they get different primary objectives — each reads their own disposition card.
- **Missions are per-cell, not five global primaries.** Each cell of the matrix names its own mission. The two full disposition cards plus a third confirmed via a mission-card photo yield **11 confirmed mission names**:
  - Priority Assets card: `secure-asset`, `vital-link`, `extract-relic`, `vanguard-operation`, `sabotage`.
  - Reconnaissance card: `reconnaissance-sweep`, `triangulation`, `surveil-the-foe`, `gather-intel`, `search-and-scour`.
  - Purge the Foe (one cell): `destroyers-wrath` — confirmed from the **Destroyer's Wrath** mission card, whose icons read as a Purge the Foe player vs a Priority Assets opponent. It is the asymmetric counterpart to `vital-link` (the Priority Assets player's primary in that same pairing).
- **Encoding (landed).** Two normalized entities, linked by id (the cell→mission relationship is 1:1): `mission` (the objective — name, VP caps, deployment maps) and `mission-matchup` (one selector row — `disposition`, `opponent_disposition`, `mission_id`). The matchup is the thin lookup; mission-intrinsic detail lives once on the mission. **Scoring is not on the mission** — it lives on the matching `secondary-card` with `card_type: primary` (see Section 2), so the mission stays a pure objective record.
- **Launch deployment patterns**: Dawn of War, Hammer and Anvil, Tipping Point (the wider `deployment-pattern` reference set has 6). Stream framing implies ~3 maps per mission, tying deployment to the mission (carried via `mission.deployment_pattern_ids`).
- Three recommended terrain layouts ship at launch.

**Force Disposition matchup matrix (current state, 11/25 cells confirmed).** Rows = the player's own disposition, columns = the opponent's; each cell is the mission that player plays. All ✅ cells are written to `data/core/mission-matchups.json`.

| Player ↓ \ Opponent → | take-and-hold | disruption | purge-the-foe | priority-assets | reconnaissance |
|---|---|---|---|---|---|
| **take-and-hold** | ? | ? | ? | ? | ? |
| **disruption** | ? | ? | ? | ? | ? |
| **purge-the-foe** | ? | ? | ? | `destroyers-wrath` ✅ | ? |
| **priority-assets** | `secure-asset` ✅ | `extract-relic` ✅ | `vital-link` ✅ | `sabotage` ✅ | `vanguard-operation` ✅ |
| **reconnaissance** | `reconnaissance-sweep` ✅ | `surveil-the-foe` ✅ | `triangulation` ✅ | `search-and-scour` ✅ | `gather-intel` ✅ |

- **✅** — confirmed and written in `data/core/mission-matchups.json`. The two photographed disposition cards (`priority-assets`, `reconnaissance` players) are complete: all five opponent icons resolved via the Force Dispositions legend card. The `purge-the-foe × priority-assets` cell was added separately from the **Destroyer's Wrath** mission-card photo (player/opponent icons), giving the first cell of the otherwise-unphotographed Purge the Foe row.
- **?** — the `take-and-hold` / `disruption` player cards were not photographed, and only one `purge-the-foe` cell is known; those 14 missions are unknown.

The unphotographed player cards fill the remaining 14 cells.

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

- [x] `schemas/$defs/common.schema.json` (phase enum) — **Decision**: no change. The five phases are identical in 11e; the Pile In timing reorder happens *within* the Fight phase and adds no top-level phase, so neither an enum extension nor an edition-versioned split is needed. The `phase` description now states it carries forward to 11e; resolution recorded in `VERSIONING.md`. (Section 5's CLAUDE.md "Game phases" line needs no update since the enum is unchanged.)
- [ ] `schemas/core/stratagem.schema.json` `type` enum (`battle-tactic | strategic-ploy | epic-deed | wargear`) — confirm 11e card categories before bumping; allow free-form fallback if GW reshuffles.
- [x] `schemas/core/unit.schema.json` — added `attachment_role: "leader" | "support" | null` for character units that join other units (#5). **Decision**: the must-attach invariant for Support is encoded *implicitly on the enum value* (`"support"` is documented to imply the unit is not a legal standalone list entry; list-builders enforce), not as a separate `attachment_required: boolean`. Simpler schema, splittable later if 11e adds a standalone Support.
- [ ] `schemas/core/weapon.schema.json` — audit free-form ability list against 11e additions; no enum lock to break. Specific 11e keywords TBD on dataslate publish.
- [x] `schemas/core/enhancement.schema.json` — added `upgrade_tag: boolean` and `max_targets: integer` (default 1) (#5).
- [x] `schemas/core/detachment.schema.json` — added `detachment_points: integer | null` (1–3) and `force_dispositions: array of entity-id` referencing force-disposition entities (#5).
- [x] `schemas/core/leader-attachment.schema.json` — removed `max_leaders_per_unit` (#5). The 10e Support workaround is superseded by `attachment_role` on the character unit; the data-side companion transform is Section 6.2.
- [x] `schemas/core/game-version.schema.json` — already accepts `11th` via the existing pattern. Widened `$defs/dataslate-version` (#5) to accept named kebab-case slugs (e.g. `pre-launch-provisional`) alongside quarterly tags; added the dataslate to `data/core/_example/game-versions.example.json`. The real `data/core/game-versions.json` registry entry now exists alongside the port (PR #6).
- [x] New `$defs/battle-size` — added to `common.schema.json` as a string enum `incursion | strike-force`, with the canonical budgets (1000 pts / 2 DP, 2000 pts / 3 DP) captured in the description. Enum-only for now: the per-detachment cost already lives in `detachment.detachment_points`; the army-level points→DP-budget *constraint* lands with the `mission` / army-setup schema that consumes `battle-size`.
- [x] Added `points_provisional: boolean` (default `false`) sibling on the points-bearing schemas `unit` and `enhancement` (#5). **Correction**: `unit-composition` was listed here but carries no `points` field (per-composition costs live in `unit.points`), so it gets no flag. Set `true` during the 10e→11e port (Section 6); flipped to `false` when real 11e points land.

**New schemas:**

- [x] `schemas/core/terrain-layout.schema.json` — added. `pieces[]`, each with a `footprint` (tagged union `rectangle | right-triangle | polygon`), `position`, optional `rotation_degrees`, `height_inches` (gates Plunging Fire), `terrain_area_keywords` enum (`obscuring | hidden | plunging-fire`), `link_group` (linked terrain = single feature/objective), and `is_objective` + `objective` marker metadata. **Decision**: footprints are **open geometry**, not a template enum — the launch catalog and its size are unconfirmed (could be a handful or dozens), so the GW standard templates are expressed as explicit geometry with an optional free-form `template` *label* rather than an enum-locked set. `pieces` is optional so a layout can be registered by name ahead of confirmed geometry. Wiring: `terrain-layouts` prefix in `validate.ts` SCHEMA_MAP, `$id` in `schema-loader.test.ts`, valid/invalid fixtures. No layout data authored yet (footprint permutations need the printed pack/a leak).
- [x] `schemas/core/mission.schema.json` — added. The mission entity (the objective): `id`, `name`, `source?`, community-authored `description?`, `vp_per_game_cap` (default 45), `vp_per_round_cap` (default 15), `deployment_pattern_ids[]` (the mission's maps), `game_version`. **Decision**: the force-disposition matchup matrix does *not* live on the mission. Card photos showed each Force Disposition is itself a 5-row `(player disp × opponent disp) → mission` table, so the matrix is normalized into a separate `mission-matchup` entity (below) that references the mission by id; the mission stays a pure objective record. No scoring prose (IP).
- [x] `schemas/core/mission-matchup.schema.json` — added. One cell of the 5×5 disposition matrix: `id`, `disposition`, `opponent_disposition` (both `$defs/force-disposition-id`), `mission_id` (→ mission), `game_version`. Mirrors a single physical card row. Compound `(disposition, opponent_disposition)` uniqueness is a data convention (not pure-schema enforceable). Added the shared `$defs/force-disposition-id` enum to `common.schema.json` and re-pointed `force-disposition.schema.json`'s `id` at it (one source of truth for the five values). Added both `$id`s to `schema-loader.test.ts`, the `missions` + `mission-matchups` prefixes to `validate.ts` SCHEMA_MAP, and valid/invalid fixtures.
- [x] `schemas/core/deployment-pattern.schema.json` — added. Aligned to the bevy-deploy-helper (`~/bevy-deploy-helper`, GitHub `wn-mitch/shadowboxing`) `DeploymentPattern` encoding, since patterns carry forward **unchanged from 10e**: `zones[]` (per-side, `shape` = `rectangle | polygon` tagged union, `position`, `color`), top-level `objectives[]`, plus the new **`territories[]`** (per-side polygons, which bevy-deploy-helper consumes from us) and `recommended_terrain_layout_ids[]`. Pattern ids are **not** enum-locked — the reference data has 6 patterns (`tipping-point`, `hammer-and-anvil`, `sweeping-engagement`, `dawn-of-war`, `crucible-of-battle`, `search-and-destroy`), not the 3 originally guessed here. Added `$defs/vec2` (2D board-inch point) to `common.schema.json`, the `deployment-patterns` prefix to `validate.ts` SCHEMA_MAP, the `$id` to `schema-loader.test.ts`, a fabricated `_example` file, and valid/invalid fixtures. **Follow-up**: author the real 6-pattern data (polygons are geometric facts; lives in real data dirs, not `_example`).
- [x] `schemas/core/secondary-card.schema.json` — added. Multi-block card structure (the deck-level "draw 2 / keep unscored" rule is separate and **not** modelled here):
  - `id`, `name`, `game_version` (required); `text` (community-authored prose, optional).
  - `card_type`: `secondary | primary` (default `secondary`) — the discriminator that lets primary mission cards reuse this shape (the tracker's "primary cards reuse this shape" note). **Added beyond the original field list** so a mixed deck is queryable.
  - `subtype`: free-form string (not enum-locked until 11e categories are confirmed).
  - `action`: `starts` (phase), `player_turn`, `units` (eligibility predicate → DSL `condition`), `use_limit`, `completes` (DSL `condition`), `effect` (DSL `effect` — e.g. `terrain-area-tag` to mark transient terrain state). Reuses the Ability DSL via cross-`$ref` from `core/` → `enrichment/ability-dsl/`.
  - `awards`: VP-award blocks, each `{ trigger, when?: DSL condition, (vp | vp_per+per), per_max?, cumulative? }`. **Extended for the first real mission cards** (Vital Link / Destroyer's Wrath): the `trigger` gained `timing` (`start/end-of-turn`, `start/end-of-phase`, `end-of-battle`) and a `battle_round` window so a card's section headers round-trip (`ANY BATTLE ROUND` = no window; `SECOND BATTLE ROUND ONWARDS` = `{ min: 2 }`; `END OF THE BATTLE` = `timing: end-of-battle`); `phase` is now optional but required when `timing` is phase-relative (`if/then`). Awards score a flat `vp` **xor** a count-scaled `vp_per` (VP per `per` instance, optional `per_max`); the card's "+ … CUMULATIVE" rows are separate awards flagged `cumulative` (descriptive — awards sum independently). Three scoring predicates added to the DSL `condition` enum: `units-destroyed`, `units-destroyed-comparison`, `objective-majority` (params documented in `condition.schema.json`'s `$comment`).
  - `when_drawn`: **bespoke** deck-operation block `{ operation: reshuffle|replace|redraw|draw-extra|swap, card_ids?, condition? }`. **Decision**: deck operations are *not* modelled via the Ability DSL `effect` language — the DSL's `single-effect` requires a combat `target` (attacker/defender/unit…) that a deck manipulation has none of. Likewise `when_drawn.condition` is a **bespoke army-composition predicate** `{ subject: self|opponent, quantifier: any|none, unit_filter: { model_count_min/max, wounds_min, keywords } }`, **not** the DSL `condition`: redraw validity is a draw-time check over the *list*, not runtime board state (e.g. 10e 'Cull the Horde' redrew when the opponent fielded no 14+-model unit). Clean split: runtime predicates (`action.units`/`completes`, `awards[].when`) use the DSL condition; the draw-time predicate is bespoke.
  - Wiring: `secondary-cards` prefix added to `validate.ts` SCHEMA_MAP, `$id` to `schema-loader.test.ts`, valid/invalid fixtures (the valid fixture exercises the core→enrichment DSL refs). **First card data landed**: `data/core/secondary-cards.json` holds the two primary mission cards `vital-link` and `destroyers-wrath` (full `awards`, mechanics-only, no GW prose). The secondary deck contents still need a leak/the printed pack.
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
- [x] **Extend `tools/src/validate.ts` SCHEMA_MAP** with prefixes for new entities: `force-dispositions`, `deployment-patterns`, `missions`, `mission-matchups`, `secondary-cards`, `terrain-layouts` — all landed.
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
- [x] **Cover → BS modifier rewrites** — `benefit-of-cover` was an undefined reference (the 51 grants only ever cited it by id, never defined it). Authored a single canonical definition in `data/enrichment/_core/abilities.json` as a `core` ability with effect `bs-modifier` / `target: "attacker"` / −1, so every grant path (passive, conditional, psychic) resolves to the 11e meaning. The 51 grants are unchanged.
- [x] **Charge-timing / Fights First redundancy** — all 35 reviewed, none redundant. The premise (charge→Fights First as a *new* 11e default) was mistaken: 10e already granted Fights First on charge (the Charge Bonus), so the mechanic is edition-stable and no ability could have become newly redundant. The flagged `fight-first` abilities are unconditional or gated on `is-attached`/below-strength/fight-phase (FF *without* charging — independent value); the `charged-this-turn` abilities grant other effects (keywords, stat mods, mortal wounds, re-rolls), never FF. Zero prunes.
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
2. **Section 6.6 audit-driven follow-ups**:
   - ~~Cover rewrite~~ ✅ done — canonical `benefit-of-cover` definition authored in `data/enrichment/_core/abilities.json` (`bs-modifier` / attacker / −1); the 51 grants resolve against it unchanged.
   - ~~Charge-timing review~~ ✅ done — all 35 reviewed, zero redundant (charge→Fights First is edition-stable, not new in 11e; flag was a coarse keyword scan).
   - Detachment DP + Force Disposition assignment: 190 detachments — gated on GW publishing the mapping.
   - Stratagem type-enum reconciliation: 1140 stratagems — gated on the 11e card categories being confirmed (Section 2's open stratagem item).
3. **Section 2 — remaining schema work**: ~~phase-enum decision~~ ✅ (no change — phases identical to 10e) and ~~`$defs/battle-size`~~ ✅ both done. Remaining: weapon-abilities audit (gated on 11e weapon keywords publishing), stratagem `type`-enum confirmation, and the new schemas. ✅ done: `deployment-pattern`, `mission` (the objective entity), `mission-matchup` (the 5×5 disposition→mission matrix, normalized out of the mission per the card photos), `secondary-card` (per-card shape; reuses the Ability DSL for action/awards, bespoke `when_drawn` deck-op block; `card_type` lets primary cards reuse it), and `terrain-layout` (open-geometry footprints, no data yet). **All Section 2 new schemas are now landed**; the remaining open Section 2 items (`weapon` abilities audit, `stratagem` `type` enum) are externally gated.
   - **Mission data follow-ups** (gated on more card photos / the printed pack):
     - ~~Identify the 3 unmapped disposition icons~~ ✅ done — Force Dispositions legend card: green shield+skull = `take-and-hold`, blue hexagon+X = `disruption`, red inverted-triangle+sword = `purge-the-foe` (gold diamond = `priority-assets`, teal eye = `reconnaissance`).
     - ~~6 known-mission cells held~~ ✅ done — with the icons resolved, the two photographed cards are fully written: the `priority-assets` and `reconnaissance` player rows are complete. A third cell, `purge-the-foe × priority-assets → destroyers-wrath`, was added from the Destroyer's Wrath mission-card photo: **11/25 matchups** now in `data/core/mission-matchups.json`, and all 11 mission entities are in `data/core/missions.json`.
     - ~~First mission-card scoring encoded~~ ✅ done — `data/core/secondary-cards.json` holds `vital-link` and `destroyers-wrath` as `card_type: primary` cards with full `awards`. Required schema extensions (trigger `timing`/`battle_round`, `vp_per`/`cumulative`, three DSL `condition` predicates) landed in Section 2.
     - **14 cells from the unphotographed cards** (`take-and-hold` / `disruption` players, plus the remaining 4 `purge-the-foe` cells) — missions unknown; need those cards.
     - **Per-mission deployment maps** — populate `mission.deployment_pattern_ids` (~3 each) once the mission↔map pairings are confirmed.
     - **VP cap reconciliation** — confirm 45-game / 15-round-per-primary vs the stream's combined-15/round reading.
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
- Force Disposition card structure + mission matrix: photos of the Priority Assets and Reconnaissance cards from the "Warhammer 40,000 New Edition Live — Championship Rematch" stream (source of the confirmed mission names and the 5×5 matchup model).
- Force Dispositions legend card: photo mapping each of the five dispositions to its icon (green shield+skull = take-and-hold, blue hexagon+X = disruption, red inverted-triangle+sword = purge-the-foe, gold diamond = priority-assets, teal eye = reconnaissance) — resolved the two photographed cards' opponent columns.
