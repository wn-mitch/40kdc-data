---
name: Author Ability
description: Reviewable ingestion of 40K abilities from a PDF or JSON into 40kdc-data's semantic-authoring pipeline. Extracts source metadata, proposes and reviews leaves, propagates approved surfaces, deterministically compiles complete records, and validates generated artifacts. Never auto-applies model proposals or hand-writes canonical DSL. Use for "author/import abilities from this PDF/JSON", "structure these abilities", "fill ability stubs".
---

# Skill: Author Ability

Turn raw ability text (a rulebook / faction-pack PDF, or a foreign JSON dump) into
authored **Ability DSL** in `data/enrichment/<faction>/abilities.json`. The canonical
rule text of every ability is the private MFM dump (`_private/dump.json`); read it with
`cd tools && npm run prose -- get <faction> <ability_id>`. The pipeline keeps no other
copy of the prose.

## Operating mode — reviewable, deterministic authoring

Run the existing segmentation → review → propagation → compilation pipeline. Do not
auto-apply model proposals or ask a model to emit a whole authored rule in one shot.

- **Proposals are not authority.** Model segmentation, family, parameter, and retrieval
  outputs are hypotheses only. A human reviewer must confirm or correct each semantic leaf.
- **Human-approved leaves are the source of truth.** Scoped surfaces and duplicate-text
  propagation may copy a confirmed meaning mechanically, but derived rows remain traceable
  to the human decision.
- **Compilation is deterministic.** When a record is fully accounted for by trusted leaves,
  connectives, and relations, `compile.ts` lowers it to the canonical DSL. Models do not
  hand-write or directly override `effect`, `scope`, `trigger`, `usage`, or `applies_to`.
- **Do not silently fill gaps.** An unresolved or unmodelable clause stays an honest
  `DSL_GAP`/review item until a human-authorized semantic repair and compiler lowering exist.
- Treat the working tree as shared. Never revert, reset, clean, or overwrite unrelated
  concurrent changes.

## Respect concurrent work — NEVER revert without confirmation

The user may be editing this repo at the same time the pipeline runs (the `propose`/
`repair` passes are long). Treat the working tree as shared and not yours to clean up.

- **This pipeline writes to two authoring places** — `data/enrichment/<faction>/abilities.json`
  and `data/_audit/**` — **plus, in the
  push-ready step (Step 7), a fixed set of regenerated artifacts:** `conformance/**`,
  `crates/wh40kdc/src/data/bundle.generated.json`, `python/src/wh40kdc/_bundle.json`, and
  (only on a real corpus change) `python/src/wh40kdc/_spec.py`. A schema change this run also
  regenerates the schema-derived artifacts listed in its own section. If `git status` shows
  any file changed **outside** that combined generated set (other core data, unrelated schemas,
  `CONTRIBUTING.md`, this SKILL.md, CI workflows, untracked files …), assume it is the
  **user's concurrent work**, not pipeline output — even if it looks unrelated or mid-feature.
- **NEVER `git checkout`/`restore`/`reset`/`clean`, delete, or overwrite a file you did not
  create as part of this run — not without explicit user confirmation first.** The ONE
  sanctioned exception is Step 7 restoring its OWN line-ending-only churn (see Step 7) on the
  generated paths it just wrote — that and nothing else. Do not "tidy up" the rest of the
  change-set. A revert of unstaged work is often unrecoverable. When something looks out of
  scope, **surface it in the final report and ask** — do not act on it.
- If you must report the change-set, scope your `git` reads to the three paths above; describe
  everything else as "your other changes, untouched."

## What the DSL is for — structured, source-faithful mechanics

The Ability DSL is a structured mechanical representation used by the cruncher,
describers, and consumers. It is not a copy of source prose, but it MUST preserve
every source-supported mechanic that the canonical schema and compiler can express.
The private dump is the source-text authority; trusted semantic leaves are the
human-authorized meaning; deterministic compilation is the only path to canonical
DSL.

- Do not assume the strongest conditional outcome or drop a trigger/resource cadence
  merely because a consumer cannot evaluate it yet. Preserve the condition, timing,
  duration, and usage semantics in trusted leaves and lower them through the existing
  compiler.
- Keep concepts distinct: static `applies_to` is only a human-curated roster
  highlighting predicate; runtime recipients use `unit-filter`/typed unit references.
  Model attachment membership uses `member_of` plus `attachment_role`, not
  `CHARACTER`, possession of a Leader ability, `self`, or `bearer`.
- Emit selectors with `filter`, inclusive `count` bounds, optional `limit`,
  `bind_as`, and event-dependent `eligibility`. Keep objective selectors typed
  separately. Use `range`/`range-ref` and structured `weapon-scope`; never emit
  `scope.range_inches` or flattened weapon fields.
- Every stance option has a stable `id` and display `name`; cross-record links use
  `{ability_id, option_id}`. Labels are not identifiers. Preserve parent usage
  allowances independently from local part triggers.
- Unknown board state remains unknown/permissive according to the consumer contract;
  do not invent distances or collapse a correlated historical predicate into
  unrelated `matches`/`within` atoms.
- A source-family parameter such as reviewed `bodyguard_only` may remain in trusted
  family semantics, but it is not a lowered DSL field. The compiler emits the
  canonical typed target filter.

If the schema genuinely cannot express a source clause, retain an honest `DSL_GAP`
and route a minimal schema/compiler/describer proposal through human review. Never
smuggle it through an open modifier or free-text note.

Corollary for updates: re-author when the structured mechanic, magnitude, timing,
or applicability changes. A source-text update alone does not authorize rewriting
the DSL or bypassing review.

### Mark every approximation — the `[APPROX]` convention

When a DSL entry does not fully/faithfully represent its source, it MUST be
flagged so a later human-authorized repair can find and extend it. A dropped
condition, clause, or placeholder is never silently accepted. The standardized
marker is a **leading `[APPROX]` token in `community_notes`** (chosen over a
schema field so it needs no downstream regen; promote it only through the normal
Schema Change process):

```
[APPROX] <exactly what is simplified or dropped vs the full rule>. <any prior notes>
```

Rules:
- Prepend the token; **preserve** any existing `community_notes` after it. Don't double-mark
  (check for `[APPROX]` first).
- Be specific about the gap ("+1 Hit/Wound applied unconditionally; rule gates it on the
  target having destroyed a friendly unit"), so the later pass knows what to extend.
- **Any omitted or simplified source mechanic is an approximation — mark it.** Only an
  entry that completely and faithfully captures the source meaning is left
  unmarked. Do not choose a strongest-case rewrite as a substitute for a reviewed
  condition or usage rule.
- **A wrong/stale value is a BUG, not an approximation — fix it, don't mark it.** An
  incorrect scalar or enum (a distance, threshold, stat, CP cost, phase, or a stale id
  reference — e.g. the rule says 8" but the DSL holds 9") is simply wrong: **correct the
  value in place** and do NOT add `[APPROX]`. Litmus test: if a faithful future pass would
  merely **replace** the value, it was a bug (fix now); if it would **add complexity the
  current model can't yet express**, it's an approximation (mark). Don't let a shared
  convention (e.g. a family of abilities all defaulting to `aura-9`) mask a value that's
  actually wrong for this specific rule.
- Find all pending faithful-authoring work with: `grep -rl '\[APPROX\]' data/enrichment`.
- Surface the `[APPROX]` count in the final report.

## Core principle — you do NOT author the DSL

The project's correctness guarantee is structural (`CONTRIBUTING.md`, `CLAUDE.md` "IP
Safety"): the model only *classifies and judges fidelity*; pure TypeScript *assembles,
AJV-validates, verifies, and gates* the DSL, so it can't invent enums or leak rules
text. So this skill **never** hand-writes an `effect`/`scope` tree or edits
`abilities.json` mechanics directly. Your only generative job is **extraction** —
pulling each ability's name, unit/faction linkage, and raw text out of the source.
Everything downstream is the existing deterministic pipeline.

## Fidelity — never silently drop or simplify a mechanic

A mechanic the rule states must be **represented, not flattened**. If the schema can
express it, do so.

**Structured data, never prose — and know which repo you're in.** Committed `data/**`
(core schemas *and* enrichment DSL) carries only *structured* facts: enums, ids,
keyword lists, `target_restrictions`, condition/effect trees. The original rule *text*
lives ONLY in the private MFM dump (`_private/`). So when a mechanic resists a
field, the fix is to author the real structure (or extend the schema — below), **never**
to retreat into a free-text `notes` / `description` / `community_notes` field and
restate the rule in prose there. A `notes` string that paraphrases what a structured
field should hold is the **same class of violation as a dropped mechanic** — it reads as
authored, but the data is unusable by any engine. Concrete tell: writing
`target_restrictions.notes: "That MONSTER or VEHICLE unit"` instead of
`required_keywords_any: ["Monster","Vehicle"]` (the `*_any` OR-key, mirroring
allied-rule's `army_keywords_any`). If the field that *should* hold it can't yet (e.g.
`required_keywords` is AND-only), extend the schema per the steps below — do not narrate
the gap in `notes`. `notes` is only for genuine out-of-band caveats a reader needs, never
for mechanics the schema can (or should be taught to) carry.

If the schema genuinely cannot express it:
1. Do NOT emit a feature-dropped version as if complete, and do NOT smuggle it through
   an open `parameters`/`modifier` field with an invented value (e.g.
   `attack-is-type: "strength-exceeds-target-toughness"` — that's not a real enum), nor
   into a free-text `notes`/`description` field as prose (see the rule just above).
2. Propose a MINIMAL extension aligned with existing patterns — a new `condition` type
   (condition.schema.json enum + its `$comment`), an optional `single-effect` field
   (effect.schema.json, e.g. `scaling`), or a documented modifier-narrowing key — and
   wire it into the engine: add the key to `CANONICAL_MODIFIER_KEYS` and teach
   `REPAIR_SYSTEM` in `tools/src/author-batch.ts` so future runs emit it.
2b. **Teach the human-readable describer in ALL THREE ports — byte-identical.** A new
   `condition`/`effect` type that the schema accepts but a describer doesn't recognize
   falls through to a generic `dekebab(type)` fallback (e.g. `attack-stat-compare` →
   "attack stat compare") in whichever port forgot it — a silent **cross-impl parity
   bug** the conformance *suites* do NOT catch (only `tooling/parity/differ.py` does, via
   the `effect-translation` / `scoring-translation` areas). For every new type you MUST
   add a matching arm, producing **character-for-character identical** output, in all of:
   - `tools/src/translate/condition.ts` and/or `tools/src/translate/effect.ts` (TS — the corpus reference)
   - `crates/wh40kdc/src/translate/mod.rs` and/or `effect.rs` (Rust)
   - `python/src/wh40kdc/translate/condition.py` and/or `effect.py` (Python)
   Match parameter handling exactly too (e.g. Rust's `unwrap_or("")` for a missing field
   renders as `""`, not TS `str()`'s `"?"`). The phrasing is pinned by the corpus, so this
   is a `SPEC_VERSION`-bumping change (Step 7 handles the bump + regen).
3. Implement it, re-author the affected abilities against it, and `validate`.
4. **ALWAYS run the CONTRIBUTING.md downstream regen after any schema edit** — the
   generated TS/Rust/Python/Go artifacts drift otherwise and CI fails. Run, from the repo
   root:
   ```bash
   cd tools && npm run bundle:schemas && npm run codegen:types && npm run codegen:data && cd ..
   cargo run -p xtask -- codegen && cargo run -p xtask -- bundle-data
   python3 python/codegen/sync_bundle.py && python3 python/codegen/sync_spec.py && python3 python/codegen/gen_typeddicts.py
   bash go/codegen/sync.sh                            # Go schema/types/bundle/spec
   cd tools && npm test && npm run validate           # TS-only locally; CI runs the cross-impl parity differ
   ```
   `gen_typeddicts.py` needs the Python dev deps (`cd python && uv pip install -e ".[dev]"`). **Run only the TS checks locally** — the cross-impl parity differ (`tooling/parity/differ.py`) and the Rust/Python/Go suites are run by CI on every push (`parity.yml` + the `conformance`/`rust`/`python`/`go` jobs), so don't run them here. The *regen* above is still mandatory (CI fails on `git diff --exit-code` drift); if a regen toolchain is absent, report it as a **blocking** follow-up rather than skipping silently. This regen covers the *schema-derived* artifacts; the *data-derived* artifacts (conformance corpus + embedded bundles) are handled by **Step 7**, which runs every authoring run regardless of whether a schema changed. A pure additive schema change does not by itself touch a conformance golden — but authoring abilities usually does (Step 7 decides the `SPEC_VERSION` bump).
5. **Surface every schema change in the final report for explicit approval** — the
   project requires a Schema Change issue before merge.

The only acceptable omissions are genuinely out-of-scope concerns — army-construction
/ detachment-build restrictions, pre-game deployment, faction-bespoke sub-abilities
with no mechanical model (represent via `ability-grant {grant_type}`). Those must be
**flagged** in `community_notes` and the final report, never dropped silently.

## When to Use

When the user asks to author/import abilities from a PDF or JSON, structure raw
abilities, fill ability stubs, or build the raw-text lookup. One ability, a unit's
worth, or a whole faction pack.

## Where source files live

All IP-sensitive material stays under the git-ignored **`_private/`** dir:
- `_private/sources/` — input PDFs / source JSON.
- `_private/extracted/` — `pdftotext` output + the faction reference (step 2).
- `_private/manifests/` — generated ingest manifests (they carry `raw_text`).

If the user points at a file elsewhere, copy it under `_private/sources/` first.

## IP safety (non-negotiable)

- Raw GW rule text goes ONLY to git-ignored places: `_private/**` and the ignored
  `data/_audit/author-input/<faction>.json` workspace. Never write it into a tracked
  repository file.
- Never commit source PDFs. Don't paste prose into `name` / `community_notes` / any DSL
  field (the audit flags it `gw-leak`). Names are factual labels and are fine.

## Workflow (run the applicable steps, with human review)

Run extraction, segmentation, proposal, review, propagation, compilation, and
validation as applicable. Do not bypass human authorization for semantic leaves or
apply model-written whole-rule DSL. A validation pass is not a substitute for
review authority.

### 1. Read & identify the source

Infer the faction from the filename/contents (e.g. `..._adeptus_custodes-...pdf` →
`adeptus-custodes`, an enrichment dir). A source spanning multiple factions → one
manifest per faction.
- **PDF:** `pdftotext -layout _private/sources/<f>.pdf _private/extracted/<f>.txt`, then
  read it. NOTE: two-column packs flatten with left/right columns interleaved —
  reconstruct each rule's full text carefully.
- **JSON:** parse a private source JSON shape (`name`, `unit_ids`,
  `src.description`, `phases`) or a simple `{name, text, unit, faction}` list.

### 2. Gather faction reference (for accurate unit_ids + dedup)

Dump the faction's existing ids so extraction maps to *real* ids (units attach to live
units; repeat abilities reuse, not duplicate):

```bash
cd tools
node -e "const f='<faction>';const r={units:require('../data/core/'+f+'/units.json').map(u=>({id:u.id,name:u.name})),detachments:require('../data/core/'+f+'/detachments.json').map(d=>({id:d.id,name:d.name})),existing_abilities:require('../data/enrichment/'+f+'/abilities.json').map(a=>({ability_id:a.ability_id,name:a.name}))};require('fs').writeFileSync('../_private/extracted/_'+f+'-reference.json',JSON.stringify(r,null,2));console.log('units',r.units.length,'detachments',r.detachments.length,'abilities',r.existing_abilities.length)"
```

If the fork lacks core data (`data/core/<faction>/` absent), stop and report the
missing mapping prerequisite; do not invent or best-effort slug `unit_ids`.

### 3. Extract → ingest manifest

For a large source, delegate the bulk extract to a **Sonnet subagent** (give it the
extracted text + the step-2 reference). Write a JSON array to
`_private/manifests/<faction>.manifest.json`, one record per ability:

```json
{
  "faction": "adeptus-custodes",       // kebab faction id == enrichment dir (required)
  "name": "March of the Honoured Dead", // factual label (required)
  "raw_text": "Friendly ... WALKER ...", // raw rule prose; for stratagems include WHEN/TARGET/EFFECT
  "unit_ids": [],                        // core unit ids; [] for detachment/faction-wide
  "ability_type": "detachment",          // core|faction|detachment|unit|enhancement|stratagem
  "behavior": "passive",                 // passive|activated|reactive|aura
  "faction_id": null,                    // "adeptus-custodes" only for faction-wide rules
  "detachment_id": "might-of-the-moritoi", // kebab detachment id for detachment/stratagem/enhancement
  "phases": [],                          // any of Command|Movement|Shooting|Charge|Fight; [] if always
  "source_ref": "<pack>.pdf",            // provenance
  "source_kind": "pdf"                   // "pdf" | "json"
}
```

Extract ALL ability-bearing rules: detachment rules (`detachment`, set `detachment_id`),
stratagems (`stratagem`; `behavior` reactive if its WHEN is the opponent's phase/a
reaction, else activated), enhancements (`enhancement`), datasheet unit abilities
(`unit`, map `unit_ids` via the reference), faction-wide rules (`faction`). SKIP points,
lore, table-of-contents, and FAQ Q&A that only clarifies an existing rule.

- **Reuse ids:** if a rule matches an `existing_abilities` entry, keep `name` identical
  so the tool derives the same id (merge, not duplicate).
- **Same name across detachments → parenthetical tag**, e.g. `Flawless Construction
  (Moritoi)` vs `(Solar Spearhead)`. A genuinely shared ability across units keeps one name.
- Empty `raw_text` → still seeded as a stub, skipped by propose.
- **Don't ask on ambiguity** — infer, and record the assumption for the final report.

### 4. Ingest (non-agentic)

```bash
cd tools
npm run author:ingest -- ../_private/manifests/<faction>.manifest.json   # or ../_private/manifests for every file
```

Seeds empty stubs into live `abilities.json` and writes the canonical author-input
(the manifest's `raw_text` goes only there). Note its summary (esp. the "merged into authored" count) for
the final report.

### 5. Author: leaves → review → compile → approve → publish

All commands run from `tools/` as `npm run semantic-authoring -- <cmd>`; `--abilities` takes
workbench `ability_version_id`s (`query "SELECT id FROM abilities WHERE ability_id='…' AND current=1"`).

1. Propose: `segment <batch> --abilities <ids>` then `classify <batch>`. These are machine rows only.
2. Review: present the proposals to the user in chat and write their answers as a decisions
   file (`confirm`/`correct`/`add`/`surface`/`gap`/…, see `review-apply.ts`), signed with the
   user's reviewer name. Apply it with `review-apply <file>`, then
   `propagate --duplicate-texts --abilities <ids>`.
3. Compile and gate: `gates --abilities <ids>` (read-only). The gates are schema, core checks,
   integrity (the schema and referential-integrity checks `prepare-publication` runs, on the
   dataset with that record alone published), describer round-trip and cruncher shape.
4. Publication review: `review-sheet <faction> --out ../_private/round5c/review` writes
   `<faction>.md` (published vs compiled renders, lever diffs, failing gates) and an unsigned
   `<faction>.decisions.json` of `approve-shape` decisions for the members that pass every gate.
   The user reads the sheet and signs (sets `reviewer`) or edits the decisions; only then run
   `review-apply` on it. An unsigned draft is refused.
5. Publish: `publishable --faction <faction>` lists the approved entries that change the tracked
   record; `prepare-publication <faction> <entry-ids>` then `publish <batch-id> <preview-hash>`.
   Publication validates the whole projected dataset before writing.

The older `author:propose`/`author:repair`/`author:apply` scripts apply model output without
leaf review. Do not use them for new authoring.

### 6. Validate, measure & emit the fidelity-review report

`npm run validate` (must pass) and `npm run audit:coverage`. A `gw-leak` > 0 is a real
problem — locate and strip the prose before finishing.

Then emit the **fidelity-review report** — the human-readable side-by-side of source rule
vs authored DSL:

```bash
cd tools && npm run author:report -- <faction> && cd ..   # omit <faction> for all factions
```

This is `audit:phrasing --review`: it runs the real `describeAbility` (DSL→English) over every
authored ability and joins, per ability, **the units that carry it** (names from
`data/core/<faction>/units.json`), its **`ability_id`**, the **verbatim GW source text** (from
the private MFM dump, `_private/dump.json`), and the **DSL→English** readout. Output goes to
`_private/reports/ability-review-<faction>.md` — **git-ignored, because it embeds GW text;
never commit it.** Skim it to confirm each authored entry is faithful to the source meaning
and that every omitted clause is explicitly reviewed as `DSL_GAP` or `[APPROX]`; do not
accept a strongest-case rewrite as faithful.
surface any genuine mismatch in the final report. Abilities whose own owner prints no dump text
render `_(no dump text)_` — check them with `npm run prose -- grep`; they are usually
misfiled or renamed, and the final report should list them.

### 7. Make it push-ready — regenerate the data-derived artifacts

Authoring abilities is a **data change**, and four CI jobs (`conformance`, `rust`, `python`,
`go` in `.github/workflows/validate.yml`) gate on `git diff --exit-code` against artifacts
derived from `data/**`. They drift the moment new abilities land, so a run is NOT push-ready
until they are regenerated — even with no schema change. **Regeneration is mandatory; only the
cross-impl *verification* is deferred to CI (see the verify step below).** The committed,
data-derived artifacts are:

- `conformance/effect-translation/cases.json` (+ any other corpus golden) — the
  effect-translation cases are **generated from the ability data**, so new abilities = new cases.
- `crates/wh40kdc/src/data/bundle.generated.json` — the Rust embedded dataset.
- `python/src/wh40kdc/_bundle.json` — the Python embedded dataset.
- `go/bundle.json` (+ `go/spec.go`) — the Go embedded dataset; `go/codegen/sync.sh` rebuilds it
  from the Rust bundle (the shared bundler), same as Python.

(The TS embedded bundle, `tools/src/data/bundle.generated.ts`, is gitignored / rebuilt on
demand — nothing to commit there.)

Run, from the repo root (order matters — Python's `sync_bundle.py` and Go's `sync.sh` both read
the Rust bundle, so regenerate it first):

```bash
cd tools && npm run build && npm run gen:conformance && cd ..   # corpus from current data
cargo run -p xtask -- bundle-data                               # Rust embedded dataset (shared bundler)
python3 python/codegen/sync_bundle.py                           # Python embedded dataset (reads the Rust bundle)
bash go/codegen/sync.sh                                         # Go embedded dataset (reads the Rust bundle)
```

Then decide the **`SPEC_VERSION`** bump. Per `CONFORMANCE.md`, any semantic corpus change
(a new/changed case) bumps `conformance/SPEC_VERSION`; regenerating the effect-translation
golden from new abilities is exactly that. So:

```bash
# Real change in the corpus (ignoring Windows CRLF churn) other than SPEC_VERSION itself?
git diff --ignore-cr-at-eol --name-only conformance | grep -v '^conformance/SPEC_VERSION$'
```

If that prints anything, bump it (single integer, +1) and mirror it into Python:

```bash
echo $(( $(cat conformance/SPEC_VERSION) + 1 )) > conformance/SPEC_VERSION
python3 python/codegen/sync_spec.py        # rewrites python/src/wh40kdc/_spec.py to match
bash go/codegen/sync.sh                     # re-syncs go/spec.go to the bumped SPEC_VERSION
```

**Windows CRLF caveat (cross-platform safe).** With `core.autocrlf=true` and no `.gitattributes`,
the generators rewrite many corpus files with LF, so `git status` flags ~70 roster/scoring
files as modified with **no real content change**. Restore that churn — keep ONLY files with a
genuine diff. This is the sanctioned Step-7 exception to the "never revert" rule (it touches
only paths this step just generated); on Linux it's a harmless no-op:

```bash
for f in $(git diff --name-only conformance crates/wh40kdc/src/data/bundle.generated.json python/src/wh40kdc/_bundle.json go/bundle.json go/spec.go); do
  git diff --ignore-cr-at-eol --quiet -- "$f" && git checkout -- "$f"   # restore line-ending-only churn
done
```

**Verify locally with TS only — defer the cross-impl tie-out to CI.** Run just the TS
conformance suite, which checks the freshly regenerated corpus against the TS reference:

```bash
cd tools && npx vitest run test/conformance.test.ts && cd ..   # TS reference vs goldens
```

**Do NOT run the Rust/Python/Go conformance suites or the parity differ locally** — the
existing CI runs all of them on every push, and they are the slow, toolchain-heavy steps
this skill deliberately offloads:
- `validate.yml`'s `conformance`, `rust`, `python`, and `go` jobs each **regenerate that port's
  artifacts and fail on `git diff --exit-code`**, then run its conformance/test suite — so any
  stale bundle or non-reproducing golden turns CI red.
- `parity.yml` runs `tooling/parity/differ.py` for **every** language pair (ts/rust/py/go),
  which is the only check of the `effect-translation` / `scoring-translation` describer output
  — exactly the cross-impl reproduction the `CLAUDE.md` load-bearing rule requires. CI performing
  that reproduction before merge satisfies the rule; doing it locally is redundant.

This is the intended tradeoff: **regeneration is still mandatory** (CI's drift checks gate on the
committed bundles/corpus being fresh — that is why the regen above is not skippable), but the
cross-impl *test execution* is CI's job. If a regen toolchain (Rust for the shared bundler,
Python, Go) is missing locally, the corresponding committed bundle can't be refreshed and CI
will fail on drift — regenerate what you can and list the rest as a **blocking** follow-up in the
final report. After this step, `git diff --ignore-cr-at-eol` should show only: the authored
`data/enrichment/**`, `data/_audit/**`, the regenerated bundles/corpus (Rust/Python/Go + TS
corpus), and (if bumped) `SPEC_VERSION` + `_spec.py` + `go/spec.go`.

## Model selection (cost)

Two layers; use the cheapest that's safe for each.

- **Extraction (step 3, this skill's work):** delegate to a subagent — `haiku` for
  already-structured JSON, `sonnet` for prose PDFs. Opus rarely worth it.
- **DSL authoring (step 5, the pipeline):** model passes propose and verify candidate
  leaf mappings, but only human-authorized leaves are trusted. Deterministic
  compilation lowers complete records; a model's confidence never promotes a
  candidate or justifies a strongest-case rewrite.

## Final report (bundle ALL of this — the only place you raise anything)

End with one consolidated summary:
- **Authored:** count applied to live data; coverage (off/def); `validate` result;
  `gw-leak` count.
- **Fidelity-review report (Step 6):** the path written
  (`_private/reports/ability-review-<faction>.md`) and any source-vs-DSL mismatches the
  side-by-side surfaced, including any source clause that remains a reviewed
  `DSL_GAP` or `[APPROX]` note. Do not describe strongest-case rewrites as expected
  behavior; report every omitted or simplified mechanic.
- **Stubs remaining,** bucketed by why: not-faithful (verifier rejected), complex,
  unencodable (flagged — need hand-authoring), schema-invalid.
- **Schema changes (NEED APPROVAL):** any condition type / effect field / modifier key
  you added to represent an otherwise-unmodelable mechanic — with a one-line rationale,
  the affected abilities, and the required downstream regen before merge.
- **Unmodeled by design:** out-of-scope omissions (build restrictions, pre-game,
  bespoke sub-abilities) — flagged here, never silent.
- **Review items:** "merged into authored" unit-link additions; any same-name collisions.
- **Mapping decisions:** source-backed faction/edition/unit mappings and any
  unresolved prerequisites; never report heuristic `unit_id` slugs as an accepted
  assumption.
- **Questions** for the user — bundled here, nowhere else.
- **Push-ready state (Step 7):** confirm all data-derived artifacts (Rust/Python/Go bundles +
  TS corpus) were regenerated and the **TS conformance suite** is green locally; state that the
  Rust/Python/Go suites and the cross-impl parity differ are deferred to CI (`conformance`/`rust`/
  `python`/`go` jobs + `parity.yml`); state the `SPEC_VERSION` (and whether it was bumped); flag
  any regen step whose toolchain was missing as a **blocking** follow-up (a stale committed bundle
  turns CI red).
- **Recommended next actions:** commit the `data/enrichment/<faction>` changes
  **together with** the Step-7 regen outputs (`conformance/**`, the Rust/Python/Go bundles,
  `SPEC_VERSION`/`_spec.py`/`go/spec.go`) as one push-ready commit; hand-author / Opus-retry the listed residue.

## Rule prose

Rule text comes only from the private MFM dump, read through `tools/src/mfm/record-prose.ts`:
`npm run prose -- get <faction> <ability_id>` prints one ability's text and its `dump.json#<row>`
ref; `npm run prose -- grep <regex>` searches it. Each ability resolves only through its own
owner (datasheet, detachment, army rule, or core rules), so a same-named rule in another faction
is never returned. The manifest's `raw_text` is a transient copy for the classify pass and lives
only in the git-ignored author-input.

## Idempotency

Re-running the same input is safe: ids are reused (no duplicate stubs, additive unit
merges), author-input entries are replaced by id, and
`apply` only touches remaining stubs. Authored abilities are never overwritten.

## Key files

- `tools/src/author-ingest.ts` — the ingestion adapter (this skill's entry point).
- `tools/src/author-seed.ts` (`kebab`, stub shape), `author-input.ts`
  (`AuthorInputEntry`/`SourceRule`), `author-batch.ts` (propose/repair/apply engine +
  classify/repair prompts), `audit-coverage.ts` (`hasEmptyModifier`) — reused, not edited.
- `tools/src/audit-phrasing.ts` — the DSL→English cataloguer; its `--review` mode
  (`npm run author:report`) emits the Step-6 fidelity-review report (unit name · `ability_id` ·
  GW text · DSL→English) to the git-ignored `_private/reports/`.
- `schemas/enrichment/ability-dsl/{ability,effect,scope,condition}.schema.json` — the
  DSL contract the gate enforces (read to explain a gate/skip).
