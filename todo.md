# Open todos

Carried forward from session handoffs so future sessions read this file instead of a paste.

- [ ] **#12 Add Python and R packages** — this is free to do and we might as well. _(Added by a parallel session, 2026-05-28.)_
- [ ] **#13 Migrate Salvo to Tailwind** — sibling app `~/bevy-deploy-helper` ("shadowboxing") uses SvelteKit + Tailwind v4 with `@theme`; Salvo currently consumes the same token values via vanilla CSS in `examples/salvo/src/app.css`. Migration would unify the toolchain across the two apps and let Salvo pick up Tailwind's utility-class density / pruning. Token values are already aligned, so the migration is mechanical — port the `:root` block into a `@theme { ... }` directive and rewrite component selectors as utility classes.
- [ ] **#16 Rust bindings for the damage engine** — the `abilities-resolver` + `cruncher`/buff layer is TypeScript-only (`crates/wh40kdc/src` has just `data`, `import`, `export`, `generated`). Port it to `wh40kdc` for full parity: the eligible-abilities resolver (incl. the combined-unit attachment pooling from #17 — `attachedUnitIds`, `source.kind: "attached"`), the DSL→Buff translator, and `stackableBuffsFor`/`buffsFor`/`defensiveBuffsFor`. The data-layer attachment queries (`leaders_attachable_to`, `bodyguards_attachable_from`, `attached_leader_for`, `attachment_partners_for`) already have Rust parity. Pin with conformance goldens like the importers do.
- [ ] **#18 Salvo e2e regression test (Playwright)** — wire up a committed Playwright test harness for the SPA (none exists today; `@playwright/test` is installed and only `scripts/inspect.mjs` uses it for screenshots). First test must guard the #17 attachment crash: selecting a leader unit (e.g. Khârn) must not trip Svelte's `effect_update_depth_exceeded` (the infinite reactivity loop fixed in `attacker-pane.svelte` — the hydrate `$effect` was writing a fresh `[]` array ref each run; now content-guarded). Add `playwright.config.ts` (webServer via `vite dev`/`preview`), `e2e/*.spec.ts` asserting no `pageerror`/update-depth console errors while driving the attachment dropdown both directions, a `test:e2e` script, and `test-results`/`playwright-report` to `.gitignore`. Manually verified during #17 via a throwaway probe; this makes it permanent. Consider wiring into CI (today CI runs only `tools/`).

## Salvo ability-data gap (offensive-led remediation)

Plan: `~/.claude/plans/i-think-you-mentioned-glistening-cocoa.md`. All 24 factions
have `abilities.json` (2,397 entries), but most don't translate into cruncher
buffs — Salvo silently falls back to raw-statline math. Three gaps: GW-text IP
leak (273 entries), offensive stubs (~273 + long tail), defensive coverage (177
"skipped" entries + an engine hole). `world-eaters` is the clean reference.

- [x] ~~**#19 Ability coverage audit tool**~~ — `tools/src/audit-coverage.ts` +
  `audit-coverage` CLI + `npm run audit:coverage` (8 tests). Runs the real
  `effectToBuffs` (attacker + target, all phases) per ability; tallies
  offensive/defensive/inert, structural stubs (empty-modifier placeholders, with
  parameterless flags like deep-strike exempted), `community_notes` flags, and an
  `unsupported.reason` histogram. Emits `data/_audit/{coverage.json,summary.md}`
  plus a per-ability **worklist.json** (faction/id/name/shape/stub/off/def/gap) —
  the named-gap artifact #21/#23 consume. Baseline: 25% offensive / 4% defensive,
  **273 structural stubs (all `stat-modifier {}`)**, `world-eaters` provably clean.
- [x] ~~**#20 Scrub committed GW "Original:" text**~~ — `tools/src/scrub-ip.ts`
  (+ `--check` verifier, 6 tests) rewrote 273 leaking `community_notes` across 22
  factions to a non-infringing citation. `grep -rl "Original:"|"■" data/enrichment`
  → empty; audit `gw-leak` → 0.
- [ ] **#21 DSL authoring — re-type & author the 273 named stubs** — scope is
  **correct DSL for every ability, not just Salvo's damage subset** (the dataset
  feeds the npm pkg, Rust crate, editor, downstream tools — a movement rule
  mis-stamped `stat-modifier {}` is wrong data for all of them). The 273 are all
  empty-modifier placeholders; investigation shows ~19 are genuine damage buffs,
  ~113 clearly out-of-scope (movement/deploy/resurrection/wargear), ~140 a gray
  zone (leadership / Miracle-dice / resurrection — mostly out-of-scope). Two-stage
  `Workflow` fan-out: classify (Haiku, Sonnet for `choice`/dice-pool/low-conf) →
  **full-taxonomy** flat-form (every effect type, not just damage); assemble DSL
  in code (owns sign conventions, canonical encodings, correct type); verify via
  back-translation (`translate.ts`) vs the 10e-archive source rule
  (`~/army-assist/.../Datasheets_abilities.json`). Gate each batch on `validate` +
  `audit:coverage` (structural-stub count must fall). Damage subset is also gated
  by the cruncher; non-damage types rely on back-translation + spot-check (named
  tension — no engine ground truth there).
  - **Source join (done):** `tools/src/author-input.ts` chains `unit_ids →
    core unit.name → archive datasheet (name + faction code) → datasheet_id →
    Datasheets_abilities` so stubs author against the *right* rule. Name-only
    joins are unsafe — ability names collide across factions (e.g. "Simulacrum
    Imperialis" on a Sororitas vs Agents "Sanctifiers" datasheet). 92% of the 273
    auto-resolve; 22 left (17 ability-name mismatch → fuzzy/wargear fallback, 5
    unit-less faction abilities → Detachment/faction-rule source). Faction-code
    alias map handles T'au / Emperor's Children / Votann. 4 tests.
  - **Resource-pool pattern (locked w/ owner):** faction resources (Sororitas
    Miracle Dice / Acts of Faith) are modeled like World Eaters' Blessings — a
    `resource-pools.json` pool + `resource-gain {pool_id, amount}` referencing
    it. Named-model conditions use `unit-has-keyword` (e.g. "Agathae Dolan").
    `D3` is a valid variable amount.
  - **Authoring engine (done):** `tools/src/author-batch.ts` — two-phase, batched
    `claude -p --json-schema` on the **subscription** (no API key; the agent
    fan-out's per-call overhead is gone). `propose` mode: classify (batched) →
    assemble effect+scope in TS → **AJV-validate** (rejects invented enums) →
    verify (batched, scope-aware) → `data/_audit/proposed/<faction>.json`.
    `apply` mode: splices gated proposals (schema-valid + faithful + confidence≠low
    + not complex) into live `abilities.json`, **only over surviving empty-modifier
    stubs** (idempotent, never clobbers authored work). npm: `author:input`,
    `author:propose`, `author:apply`. 10 tests on the pure assembly/gate logic.
    Phantom-condition suppression + leadership-vs-combat + resource-pool + scope
    fixes all baked into the prompts.
  - **Competence boundary (measured):** the flat-form nails simple single-effect
    abilities and correctly refuses genuinely-complex ones (dice-gated, choice,
    event-trigger trees) rather than faking them — the verifier flags those.
  - **Status — 157 of 273 structural stubs APPLIED** (40 flat-form + 117 full-tree
    repair + grouped Sonnet hand-author pass). Structural stub count **273 → 116**;
    total stub 336 → 217; offensive coverage 594 → 598; validate + **460 tests**
    green; no IP leaks.
  - **Full-tree repair engine (done):** `author-batch.ts` gained a `repair` mode
    (`npm run author:repair`) — the flat-form classifier could only emit a single
    condition + flat leaf, which is *why* 211 abilities were residue. Repair emits
    the **full nested effect tree** (compound `and/or/not`, event-trigger
    conditions, `sequence`/`choice`/`dice-gated`), seeded with each entry's draft
    `proposed_effect` + the verifier's exact `verdict.issue`. Reuses `callClaude`,
    the AJV gate, and the VERIFY pass. Ran on **Haiku** because the new gate makes
    model tier non-load-bearing.
  - **`lintCanonical` (the load-bearing gate):** the open `modifier`
    (additionalProperties:true) + open `condition` (no additionalProperties) let
    the model smuggle invented keys past AJV — `weapon_keyword`/`model_filter` on a
    cruncher-read leaf → **silent over-apply**; condition params placed top-level
    instead of under `parameters` → cruncher can't read them → buff **silently
    never fires**. The LLM verifier can't catch either (it reads JSON-vs-rule, not
    JSON-vs-engine). `lintCanonical` deterministically rejects both, calibrated to
    the **empirical shipped vocabulary** (keywords-array dominant, damage-reduction
    `reduction`, stat spans full statline). Only runs on new repair proposals, so
    strictness can't regress shipped data — a reject just stays residue.
    `passesGate` requires `canonical!==false` for repaired entries.
  - **Fixed 2 pre-existing `translate.ts` crashes** (review tool the plan leans
    on): `formatGrantType` crashed on ability-grant lacking `grant_type` (uses
    `ability_id`); keyword-grant rendered the dominant `keywords` array as
    "undefined". Both in Phase B's hot families (ability-grant=71, keyword-grant).
  - **Capture pass (the "unencodable" dig-in):** investigation showed the schema
    expresses essentially every *in-battle* effect; "unencodable" was inflated by
    an over-conservative prompt + the model bailing on exact enums. See
    `data/_audit/proposed/UNENCODABLE.md` for the full taxonomy. Three changes:
    (a) **`from-dsl.ts` filter-awareness** — `weapon_type` now phase-gates a
    stat-modifier; `weapon_name`/`model_filter`/etc. on any damage-path leaf
    fail-safe to `unsupported` instead of silently over-applying (TS-only; doesn't
    touch the conformance corpus, which pins engine math via explicit buff arrays,
    nor Rust — no `from_dsl.rs` exists). (b) `lintCanonical` now permits
    `weapon_name`/`weapon_type` on stat/roll/re-roll (engine backs them).
    (c) `REPAIR_SYSTEM` loosened + enum-pinned: `operation:"set"` allowed,
    dice-gated `comparison` enum spelled out, explicit recipes for dice-gated /
    choice / leadership-re-roll / deployment→deep-strike+ability-grant /
    terrain→`move_type`; `unencodable` reserved strictly for non-effect rules.
    Re-run dropped unencodable **130 → 31** and lifted gateable **60 → 111**.
  - **Grouped hand-author pass (the 31 unencodable):** drove ONE Sonnet pass
    (`claude -p`, chunked 5/call to fit a 540s timeout) over all 31 with a
    hand-author prompt — genuine non-effects (army-construction, "cannot be
    Warlord", roll-offs) encode as honest `ability-grant {grant_type:"label"}`
    documentation markers, NOT fabricated stats. 19 came back faithful+canonical;
    then **6 hand-fixed** (3 had `scope.range:"all-friendly"` — a target value, not
    a range → `any-on-battlefield`; `aetherstride` was a one-option `choice` →
    `sequence`; 2 army-list rules re-typed as `ability-grant` labels). **25 of 31
    applied.** Exported the prompt constants (`REPAIR_SYSTEM`/`REPAIR_SCHEMA`/
    `VERIFY_*`) from author-batch.ts so the grouped pass could reuse them.
  - **6 genuine leftovers — need NEW condition primitives** (the real schema gap):
    `inspiring-commander` (model-subset filter "non-CHARACTER models"),
    `empyric-ambush` (named-ability-used trigger "used its Flickerjump"),
    `torture-device` (per-event resource trigger "each time … gain 1 token"),
    `triarchal-menhirs` (model-destruction cascade trigger),
    `astra vengeance-for-the-omnissiah` (model dropped two conditions),
    `precognisant` (deep-strike vs redeploy distinction). Candidate primitives:
    `model-subset` condition/target, `ability-used` trigger condition, per-event
    (vs per-phase) resource semantics. These + modifier-immunity + model-replace
    are the only genuine effect-domain gaps left.
  - **Possible new leaf types (only genuine effect-domain gaps):**
    modifier-immunity ("cannot be targeted by Stratagems" / "ignores modifiers")
    and rule-replacement/transformation ("replace this model with…"). Rare.
  - **Housekeeping pending:** decide whether to commit `data/_audit/` (living
    worklist) or `.gitignore` it; nothing committed yet (jj change `lkpokstw`).
- [ ] **#25 Fixed timing-window vocabulary** — replace free-form `timing-is`
  strings with a controlled enum. **Deferred until 11th edition defines the
  windows** (owner's call) — no point inventing a vocabulary GW will overwrite.
- [ ] **#22 Engine: defensive effect interpretation** — teach the cruncher
  `damage-reduction`, ability-granted `invulnerable-save`, FNP-vs-mortal
  (`engine.ts:225` TODO). New `BuffContribution` + resolver + math in **both**
  `engine.ts` and `engine.rs`, new `from-dsl.ts` target-perspective emitters, new
  byte-identical `conformance/cruncher/*.json` goldens.
- [ ] **#23 Defensive DSL authoring** — convert the 177 `"defensive ability
  (skipped for damage calc)"` entries to real defensive DSL once #22 lands. Same
  fan-out + gate loop as #21, target perspective.
- [ ] **#24 (flag) Rust `from_dsl.rs`** — ability-DSL→buff translation is TS-only;
  the Rust cruncher has no `from_dsl.rs` (conformance pins engine *math*, not DSL
  translation). Add for full parity — don't block #22 on it.

## Recently closed

- [x] ~~**#17 Bidirectional leader↔bodyguard attachment (combined-unit buffs)**~~ — generalized #14's body-first "Leader" picker into a role-agnostic "Attached to" dropdown that works from either end: select a bodyguard → pick its leader (Leaders optgroup); select a leader → pick the unit it joins (Bodyguards optgroup). Modeled the attachment as a combined unit sharing all collective buffs: `EligibilityInput.attachedLeaderId` → `attachedUnitIds: string[]` (list-shaped for 11th's multi-member attachments), resolver step 5 pools *every* member's abilities tagged `source.kind: "attached"` with a `sourceUnitId`, and the buff `abilityKind` `"leader"` → `"attached"` (rank unchanged — `abilityKind` only drives tie-breaks). New data queries `Dataset.bodyguardsAttachableFrom` + `resolveAttachmentPartners`, both mirrored in Rust (`bodyguards_attachable_from`, `Roster::attachment_partners_for`). Abilities pane chips attached buffs by member role and names the member. Engine is TS-only — full Rust engine parity tracked as #16. Verified: TS 307 tests, Rust suite, `svelte-check` clean, conformance byte-identical, headless Playwright probe confirming both directions (Khorne Berzerkers↔Khârn).

- [x] ~~**#14 Leader attachments UI in Salvo**~~ — added a "Leader" dropdown to `attacker-pane.svelte` (after Detachment, before Phase), populated from a new `Dataset.leadersAttachableTo(bodyguardUnitId)` query that scans `leaderAttachments` for the selected body unit and returns sorted `UnitView`s. Reuses the #4 shared-chassis disambiguation (` · <faction>` only on duplicate names). A guarded `$effect` (mirroring the weapon-reset effect) keeps a still-eligible pick, else pre-fills from the imported roster's inferred attachment via the new `resolveAttachedLeader(roster, bodyguardUnitId)` helper, else clears — so manual picks are never clobbered and `import-pane` needed no change. Both query helpers were mirrored in Rust (`Dataset::leaders_attachable_to`, `Roster::attached_leader_for`) with parity tests; query helpers don't touch import/export bytes so the conformance corpus stayed byte-identical. Buff threading (`abilities-pane`/`output-pane` → `stackableBuffsFor`) was already wired. Verified: TS 297 tests, Rust suite, `svelte-check` clean, and a headless Playwright probe confirming the dropdown populates for Battle Sisters Squad and hides for leader-units.

- [x] ~~**#15 Salvo layout still lopsided**~~ — collapsed the 3-col (setup | canvas | tools) shell into a 2-col `input | output` shell. All four input panes (Attacker, Target, Abilities & buffs, Import) became collapsible via a new `Pane.svelte` `<details>`-backed primitive with per-pane `localStorage` persistence. Input column widened from 300 → 440–540px (560px at ≥1600). Projection moved out of the central canvas into the right column. Header wordmark dropped the two-tone split and is now single-color teal; new compact footer carries the repo link + npm package attribution. Target default switched from `manual` to `dataset`, with `onTargetRosterImported()` auto-flipping to `roster` unless the user has explicitly picked a mode since the last import. `@playwright/test` + `scripts/inspect.mjs` added for macbook-1920 / ipad / iphone-14-pro-max viewport screenshots.

- [x] ~~**#4 Disambiguate shared-unit dropdown labels**~~ — `attacker-pane.svelte` and `target-pane.svelte` now derive a Set of duplicate names per dropdown and append `· <faction>` only when the unit name is ambiguous. Captains stay as "Captain", Hellbrute becomes "Hellbrute · Chaos Space Marines" / "Hellbrute · World Eaters".
- [x] ~~**#5 Layout cleanup**~~ — superseded by the layout restructure under #8. Old 3-column named-area grid replaced with header + setup-sidebar + canvas + tools-sidebar pattern, and ad-hoc spacing across `app.css` rolled into a `--space-1..6` scale.
- [x] ~~**#6 Empty-state polish**~~ — new `EmptyState.svelte` component centralizes the muted-recessed-card pattern; all five panes migrated; missing states added for attacker-pane (no weapons in phase) and import-pane (helper caption).
- [x] ~~**#8 Holistic `/impeccable` craft pass**~~ — Salvo's visual language now mirrors `~/bevy-deploy-helper` (shadowboxing): industrial near-black palette with teal accent, Barlow Condensed headings + Barlow body + JetBrains Mono numerics, signature inset rim-lit shadows on every elevated surface, segmented-control tab strip, projection table treated as hero (sticky head, hovered rows, mono numerics), unified focus rings, thin custom scrollbars. Four-commit sequence on main: `refactor: salvo design tokens` → `fix: salvo dropdown labels` → `feat: salvo unified EmptyState` → `feat: salvo shadowboxing layout`.
- [x] ~~**#3 Expand DSL→Buff translator** — compound AND/OR, `timing-is`, AP stat-mod.~~ Shipped to `main@origin` as `7a148c8b feat: salvo DSL translator — compound conditions, timing-is, AP stat-mod`.
- [x] ~~**#7 Roster import error states** — make failure modes legible.~~ Closed by **#9** below. `tryImportRoster` returns a discriminated `ImportResult` with per-adapter `trials[]`; Salvo renders a headline + expandable per-format trial list in `import-pane.svelte`.
- [x] ~~**#9 Auto-detect import format** across the 5 importers.~~ In flight on `wnmitch/try-import-roster` (rev `rpotklql`, uncommitted). New `tryImportRoster(input, opts) → ImportResult` decodes ListForge URL/base64/gzip + JSON + raw text and greedily dispatches to the first matching adapter. Mirrored in Rust (`try_import_roster`). Required tightening `listForgeAdapter.matches` to exclude NewRecruit-signed payloads — the "greedy + perfect match" contract is now guarded by a matcher-disjointness invariant test on both sides. Per-fixture format-detect assertion added to the TS + Rust conformance runners.
- [x] ~~**#10 Data: "The Betrayer" `condition.type === undefined`**~~ — auto-resolved when #3 shipped. The condition was a valid `and`-compound, not malformed data.
- [x] ~~**#11 Triage local divergence on `wnmitch/salvo-m4-pages`**~~ — verified parallel-session work, 163 files / 8267 insertions, all coherent. Touches zero translator/cruncher/buff/engine files. Footnotes for whoever picks it up:
  - The bookmark name `salvo-m4-pages` is misleading — the commit is parented on `salvo-m5-link-abilities`, so rename to e.g. `wnmitch/salvo-m6-stratagems` before push to avoid clobbering `salvo-m4-pages@origin`.
  - The parallel session's `examples/salvo/src/lib/abilities-pane.svelte` predates the EngineContext threading (still imports only `EligibleAbility`, still calls `getBuffs`). Rebasing onto current state must preserve the `describeBuffs`/EngineContext version from `salvo-abilities-context` (commit 9947ccce).
