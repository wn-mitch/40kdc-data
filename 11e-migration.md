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
- Characters attach as **Leader** or **Support** — a unit can have one of each. Selection at list-build, not at game start. The **Support** role generalizes what were army-specific exceptions in 10e (e.g. Kroot characters allowed to attach alongside a regular Leader, currently encoded as `max_leaders_per_unit > 1` on `leader-attachment.schema.json`). 11e standardizes this as a first-class ability — the Ork **Bannernob** is the canonical preview example. Asymmetry: **Support characters cannot be taken solo** — they are only legal in an army list when attached to a host unit. Leaders remain valid as standalone entries. List-build validation needs an `attachment_required` invariant for Support (or a documented rule that `attachment_role == "support"` implies it). Migration implication: drop the per-attachment `max_leaders_per_unit` escape hatch in favor of `attachment_role` on the character's unit entry, and rewrite the existing 10e Kroot/etc. entries during 11e enrichment authoring.
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
- [ ] `schemas/core/unit.schema.json` — add `attachment_role: "leader" | "support"` for character units that join other units. Support implies an attachment-required invariant (a Support character is not a legal standalone list entry); decide whether to encode this as a separate `attachment_required: boolean` or as an implicit rule on the enum value, and document the choice.
- [ ] `schemas/core/weapon.schema.json` — audit free-form ability list against 11e additions; no enum lock to break. Specific 11e keywords TBD on dataslate publish.
- [ ] `schemas/core/enhancement.schema.json` — add `upgrade_tag: boolean` and `max_targets: integer` (default 1).
- [ ] `schemas/core/detachment.schema.json` — add `detachment_points: integer` (1–3) and `force_dispositions: array of $ref` to force-disposition entities.
- [ ] `schemas/core/game-version.schema.json` — already accepts `11th` via the existing pattern. Add a `data/core/game-versions.json` entry for the first 11e dataslate (`pre-launch-provisional` as the seed dataslate while porting from the 10e archive).
- [ ] New `$defs/battle-size` — `incursion` (1000 pts / 2 DP), `strike-force` (2000 pts / 3 DP).
- [ ] Add `points_provisional: boolean` (default `false`) sibling on every points-bearing schema (`unit`, `enhancement`, `unit-composition`). Set `true` during the 10e→11e port (Section 6); flipped to `false` when real 11e points land.

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

## Section 6 — Port 10e data forward as 11e seed

GW previews indicate datasheet stat profiles (M/T/W/Sv/invuln/Ld/OC) and most ability mechanics carry forward into 11e. The `10e-archive` branch is therefore viable as a *seed* for 11e: port it forward tagged provisional, let real 11e datasheets overwrite as they publish. This front-loads downstream tooling integration, exercises Section 2's schema deltas against realistic data, and surfaces the per-entity audit categories as concrete migration work.

**Prerequisite**: Section 2 schema bumps for `attachment_role`, `upgrade_tag`/`max_targets`, `detachment_points`/`force_dispositions`, and `points_provisional` must land before the bulk sweep (6.5) runs. The Orks canary (6.4) can run against a schema-feature branch.

### 6.0 Strategy

- **Source**: `10e-archive` branch — `data/core/` (281 files across 34 factions) and `data/enrichment/` (23 factions with abilities + phase-mappings; `world-eaters` additionally has `resource-pools.json` and `timing-flags.json`).
- **Target dataslate**: `11th / pre-launch-provisional` (added in Section 2 alongside the `game-versions.json` entry). The dataslate name itself signals provisional status to consumers; real numbered dataslates overwrite as 11e datasheets publish.
- **Provisional points**: every entity carrying `points` gets `points_provisional: true` during the port (schema delta tracked in Section 2). Flipped to `false` per-entity when real 11e values land.
- **IP stance unchanged**: stat lines and points are numerical facts (permitted); ability DSL entries remain community-authored. The port does not introduce any original prose.

### 6.1 Tooling

- [ ] Build `tools/src/port-10e-faction.ts <faction-id>`:
  - Reads `data/{core,enrichment}/<faction-id>/*.json` from the `10e-archive` ref (via `git show` or a fixture helper).
  - Rewrites every `game_version` to `{ edition: "11th", dataslate: "pre-launch-provisional" }`.
  - On every entity carrying `points`, sets `points_provisional: true`.
  - Default-fills new schema fields where unambiguous: `enhancement.upgrade_tag = false`, `enhancement.max_targets = 1`, `detachment.detachment_points = null`, `detachment.force_dispositions = []`.
  - Emits `data/core/<faction>/_port-audit.json` listing every entry needing manual review (see 6.6).
- [ ] Distinct from `tools/src/convert-faction.ts` (army-assist bootstrap). Both stay available; new script is purpose-built for archive→11e.
- [ ] Exit non-zero if the resulting tree fails `npm run validate` against the bumped schemas.

### 6.2 Per-entity transformations — `data/core/`

Items marked **audit** are flagged in `_port-audit.json`, not auto-rewritten.

- **`factions.json`** — bump `game_version`. No other changes.
- **`units.json`** — bump `game_version`; statlines carry verbatim; mark `points` provisional. **Audit**: character units whose 10e attachment used `max_leaders_per_unit > 1` need `attachment_role: "support"` (see leader-attachments). Other character units appearing in a leader-attachment entry default to `attachment_role: "leader"`; non-attaching characters get no role.
- **`weapons.json`** — bump `game_version`; the `abilities` list is free-form and carries forward. **Audit**: flag weapons whose ability strings reference cover or engagement semantics for re-check once 11e weapon keywords publish.
- **`enhancements.json`** — bump `game_version`; mark `points` provisional; default-fill `upgrade_tag: false`, `max_targets: 1`.
- **`detachments.json`** — bump `game_version`; carry forward (10e detachments remain valid in 11e per the confirmed mechanics); default-fill `detachment_points: null` and `force_dispositions: []`. **Audit**: every detachment needs human-assigned DP cost (1–3) and Force Disposition list once GW publishes the mapping.
- **`stratagems.json`** — **hold** until Section 2's `type`-enum decision lands. The 10e enum (`battle-tactic | strategic-ploy | epic-deed | wargear`) may shift in 11e; porting now risks a rewrite.
- **`unit-compositions.json`** — bump `game_version`; mark `points` provisional. Battleline-doubling is army-list construction, not entity state — no schema impact.
- **`leader-attachments.json`** — transform, don't just relabel:
  - If `max_leaders_per_unit > 1`: this is the 10e Support workaround (Kroot exception). Drop the `max_leaders_per_unit` field; the leader unit gets `attachment_role: "support"` (handled in units.json transform).
  - Otherwise: drop `max_leaders_per_unit` if present (now defaults to 1); the leader unit gets `attachment_role: "leader"`.
  - The leader-attachment schema itself loses `max_leaders_per_unit` in Section 2; this transform is the data-side companion.

### 6.3 Per-entity transformations — `data/enrichment/`

- **`abilities.json`** — bump `game_version`. Three audit passes:
  1. **Cover audit**: scan effects for `save-modifier` with cover-scoped conditions → rewrite to `bs-modifier` with sign inverted. Script can detect candidates; rewrite is human-reviewed because not every `save-modifier` is cover-derived. (Section 3 owns the DSL primitive; Section 6 owns the data rewrite.)
  2. **Engagement-range audit**: scan conditions for hard-coded `1"` or implicit "engaged" semantics → flag for 2" review.
  3. **Charge-timing & Fights First audit**: any ability triggering on charge-target selection, or granting Fights First on charge, needs review. 11e charging units gain Fights First by default — some 10e abilities are now redundant.
- **`phase-mappings.json`** — bump `game_version`. **Audit**: Pile In timing reorders within Fight phase (all active-player Pile Ins, then opponent's, before fighting). Any phase-mapping that interleaves Pile In with fighting needs review.
- **`resource-pools.json`** / **`timing-flags.json`** (world-eaters only) — bump `game_version`. Carry forward.

### 6.4 Canary: Orks end-to-end

Orks selected because the Bannernob Support-character preview makes it the determinative correctness test for the `attachment_role` migration path.

- [ ] Port Orks: `npx tsx tools/src/port-10e-faction.ts orks`.
- [ ] Hand-review the resulting tree against `10e-archive:data/core/orks/` and `data/enrichment/orks/` — confirm every transformation in 6.2 and 6.3 applied correctly.
- [ ] Verify Bannernob migration: identify the Ork character unit that 11e encodes as Support per the preview, confirm `attachment_role: "support"` lands on it.
- [ ] `cd tools && npm test && npm run validate` against the schema-feature branch with Section 2 deltas merged.
- [ ] Inspect `data/core/orks/_port-audit.json` — confirm it surfaces cover, charge-timing, engagement-range, and detachment-DP review items.
- [ ] Spot-check 5 random unit statlines round-trip identical to the 10e archive.

**Gate**: 6.5 does not start until the Orks canary is green and any script bugs are fixed.

### 6.5 Bulk sweep — remaining 33 factions

- [ ] Run the port script across the remaining factions (tick as each lands and validates):
  - [ ] `adepta-sororitas`, `adeptus-astartes`, `adeptus-custodes`, `adeptus-mechanicus`, `aeldari`, `agents-of-the-imperium`, `astra-militarum`
  - [ ] `black-templars`, `blood-angels`, `chaos-daemons`, `chaos-knights`, `chaos-space-marines`, `crimson-fists`, `dark-angels`, `death-guard`, `deathwatch`, `drukhari`
  - [ ] `emperors-children`, `genestealer-cults`, `grey-knights`, `imperial-fists`, `imperial-knights`, `iron-hands`, `leagues-of-votann`
  - [ ] `necrons`, `raven-guard`, `salamanders`, `space-wolves`, `tau-empire`, `thousand-sons`, `tyranids`, `ultramarines`, `white-scars`, `world-eaters`
- [ ] After each faction: `npm run validate`.
- [ ] **Parent-faction inheritance**: Space Marine successor chapters (black-templars, blood-angels, crimson-fists, dark-angels, deathwatch, imperial-fists, iron-hands, raven-guard, salamanders, space-wolves, ultramarines, white-scars) lack their own `leader-attachments`/`unit-compositions`/`units`/`weapons` in the archive — they inherit from `adeptus-astartes` via `parent_faction_id`. Port script must preserve the inheritance; successors carry only the faction/detachment/enhancement/stratagem files.

### 6.6 Audit-driven human-review tasks

Each `_port-audit.json` enumerates entries needing manual work. Fill in counts as the sweep completes:

- [ ] **Support character migration** — units flagged from `max_leaders_per_unit > 1` source rows. Known: `tau-empire` Kroot.
- [ ] **Cover → BS modifier rewrites** — ability effects flagged.
- [ ] **Charge-timing / Fights First redundancy** — abilities flagged.
- [ ] **Engagement-range references** — conditions flagged.
- [ ] **Detachment DP + Force Disposition assignment** — every ported detachment needs human-assigned values once GW publishes the mapping.
- [ ] **Stratagem type-enum reconciliation** — held; unblocks when Section 2's stratagem decision lands.

### 6.7 Verification

- [ ] `cd tools && npm test && npm run validate` green with all 34 factions present.
- [ ] CI green on the PR introducing the port.
- [ ] Every entity under `data/core/` and `data/enrichment/` carries `game_version.edition == "11th"` (grep check).
- [ ] Every points-bearing entity carries `points_provisional: true` (grep check; flips to `false` per-entity as real 11e values land).
- [ ] No leader-attachment entry retains `max_leaders_per_unit` (grep check).
- [ ] Audit reports committed (per-faction `_port-audit.json` or a single `data/_port-audit-summary.md`) so the human-review queue is visible.

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
- Support ability preview (Ork Bannernob): https://www.warhammer-community.com/en-gb/articles/uwdimgen/new40k-rules-da-biggest-and-best-orks-in-da-box/
