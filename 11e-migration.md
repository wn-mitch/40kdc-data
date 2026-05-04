# 11th Edition Migration — TODO

The shared schema layer for the [Tabletop Developer Consortium](https://tabletop-developer-consortium.github.io) is migrating to Warhammer 40K 11th edition. This document is the durable, citable tracker for that migration. Cross-repo strategic context lives in the consortium's parent migration doc; this file scopes the work to `40kdc-data` specifically.

## Positioning

**`40kdc-data` is the canonical upstream**, designed to be adopted by community tooling (BattleScribe, NewRecruit, Wahapedia, list builders) — not derived from them. We define the canonical encoding for new mechanics (Detachment Points, Force Dispositions, terrain-area keywords) ourselves and publish it. Downstream parsers in `bevy-deploy-helper`, `army-assist`, etc. translate from third-party list exports *into* our schema, not the reverse.

## Status

- **10e archive**: branch [`10e-archive`](https://github.com/Tabletop-Developer-Consortium/40kdc-data/tree/10e-archive), tag [`10th/2025-q3`](https://github.com/Tabletop-Developer-Consortium/40kdc-data/releases/tag/10th/2025-q3) — frozen snapshot of the 10th edition dataset.
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
- Characters attach as **Leader** or **Support** — a unit can have one of each. Selection at list-build, not at game start.
- **Battleline units have doubled unit limits** in army-list construction.
- **Enhancements** can have an `upgrade_tag` flag that lets the enhancement apply to up to 3 non-character units while counting as one Enhancement choice.

---

## Section 1 — Branch + data hygiene (in progress)

- [x] Cut `10e-archive` branch from `main` and push to origin.
- [x] Tag `10th/2025-q3` at the archive commit and push.
- [x] Add archive pointer banner to `README.md` on `main` so consumers landing during the transition find the archived data immediately.
- [x] Remove all 10e-tagged faction directories under `data/core/` and `data/enrichment/`. Keep the `_example/` directories.
- [x] Run `cd tools && npm run validate` — confirms pipeline stays green with empty data dirs.

## Section 2 — Schema audit + 11e additions

**Modify existing:**

- [ ] `schemas/$defs/common.schema.json` (phase enum, lines 44–48) — decide: extend with 11e additions, or split into edition-versioned `$defs`. Document resolution in `VERSIONING.md`. Previews don't show new top-level phases, but Pile In timing reshuffles within Fight.
- [ ] `schemas/core/stratagem.schema.json` `type` enum (`battle-tactic | strategic-ploy | epic-deed | wargear`) — confirm 11e card categories before bumping; allow free-form fallback if GW reshuffles.
- [ ] `schemas/core/unit.schema.json` — add `attachment_role: "leader" | "support"` for character units that join other units.
- [ ] `schemas/core/weapon.schema.json` — audit free-form ability list against 11e additions; no enum lock to break. Specific 11e keywords TBD on dataslate publish.
- [ ] `schemas/core/enhancement.schema.json` — add `upgrade_tag: boolean` and `max_targets: integer` (default 1).
- [ ] `schemas/core/detachment.schema.json` — add `detachment_points: integer` (1–3) and `force_dispositions: array of $ref` to force-disposition entities.
- [ ] `schemas/core/game-version.schema.json` — already accepts `11th` via the existing pattern. Add a `data/core/game-versions.json` entry for the first 11e dataslate.
- [ ] New `$defs/battle-size` — `incursion` (1000 pts / 2 DP), `strike-force` (2000 pts / 3 DP).

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
- [ ] `schemas/core/force-disposition.schema.json` — `id`: enum of the 5 confirmed values; `name`: display string; `text`: community-authored description.

## Section 3 — Ability DSL primitives

Additive — these extend type enums without breaking existing abilities.

- [ ] `schemas/enrichment/ability-dsl/condition.schema.json` `$defs/simple-condition/type` — add:
  - `terrain-area-control` (per-model count for a terrain footprint).
  - `engagement-state` (`engaged | within-engagement-range | unengaged`; 11e engagement range is 2").
  - `territory-control` (predicate over territory polygons).
  - `fights-first` (boolean predicate).
  - `disposition-matches` (predicate for asymmetric-primary mission resolution).
- [ ] `schemas/enrichment/ability-dsl/effect.schema.json` `$defs/single-effect/type` — add:
  - `charge-roll-modifier`.
  - `terrain-area-tag` (sets transient state on a terrain piece, cleared on turn rollover).
  - `bs-modifier` (cover and the new terrain keywords all work through BS modification).
  - `engagement-passthrough` (units can move through enemy engagement ranges in 11e movement).
- [ ] `schemas/enrichment/ability-dsl/scope.schema.json` — evaluate whether scope range needs a `terrain-within-range` variant once terrain becomes ability-bearing. Hold until a real 11e ability requires it.
- [ ] **Cover audit**: when 10e enrichment is ported forward to 11e, any ability that modeled cover as `save-modifier +1` must be re-targeted to `bs-modifier −1`. The 10e archive remains untouched; the rewrite happens during 11e enrichment authoring.
- [ ] Add valid + invalid test fixtures for each new primitive in `tools/test/fixtures/`.

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

---

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
