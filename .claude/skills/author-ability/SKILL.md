---
name: Author Ability
description: One-shot ingest of 40K abilities from a PDF or JSON into 40kdc-data's non-agentic DSL pipeline, capturing raw text into a sibling store keyed by ability_id. Runs end-to-end autonomously (extract → ingest → propose → repair-until-converged → apply → validate → regenerate data-derived artifacts so the branch is push-ready/CI-green) without pausing, and bundles any questions into a single final report. Use for "author/import abilities from this PDF/JSON", "structure these abilities", "fill ability stubs", "build the raw-text lookup". Never hand-writes DSL — the gated classify→assemble→validate→verify pipeline does.
---

# Skill: Author Ability

Turn raw ability text (a rulebook / faction-pack PDF, or a foreign JSON dump) into
authored **Ability DSL** in `data/enrichment/<faction>/abilities.json`, and capture
the original raw text into a durable lookup store — the sibling `40kdc-abilities` git
repo — keyed by `ability_id`.

## Operating mode — one-shot, autonomous, no mid-run pauses

Run the WHOLE pipeline end-to-end in a single invocation without asking the user or
stopping for approval. Author as much as the gate will admit.

- **Apply unattended — it is safe.** The gate admits only schema-valid +
  verifier-faithful + confidence≥medium + canonical proposals, splices ONLY into
  empty stubs (never overwrites authored work), and is fully git-reversible. The gate
  is the safety mechanism, not a human checkpoint.
- **Never ask mid-run.** If faction / edition / unit-mapping is ambiguous, make the
  best-effort inference, record the assumption, and keep going.
- **Bundle everything for the end.** Collect all questions, assumptions, review items,
  and unauthored residue into ONE final report (see **Final report**) — the only place
  you raise anything with the user.

## Respect concurrent work — NEVER revert without confirmation

The user may be editing this repo at the same time the pipeline runs (the `propose`/
`repair` passes are long). Treat the working tree as shared and not yours to clean up.

- **This pipeline writes to three authoring places** — `data/enrichment/<faction>/abilities.json`,
  `data/_audit/**`, and the out-of-repo `40kdc-abilities` raw-text store — **plus, in the
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

## What the DSL is FOR — mathhammer estimation, not exact text

The Ability DSL exists for **mathhammer / estimation** (expected damage, scoring, matchup
math), NOT to reproduce rules text. Two consequences shape every authoring + verifier
judgement:

1. **Assume the most powerful applicable version.** When a rule has a conditional or
   escalating effect ("+1, or +2 if the unit is X"; "re-roll 1s, and full re-rolls if Y"),
   author the **strongest outcome** — model it as if the condition is met. Do NOT gate an
   estimation-relevant buff behind a hard-to-evaluate trigger and thereby under-count it. A
   blanket-looking effect that is really the upper bound of a conditional rule is correct,
   not a fidelity bug.
2. **Resources are SPENT, not generated.** For faction-resource abilities (Miracle dice,
   Blessings of Khorne, Pain tokens), author the **effect of using** the resource at its
   best (e.g. a Miracle dice as a guaranteed critical / auto-6), NOT the act of gaining it.
   So an army rule like `acts-of-faith` models the auto-6 spend, and a per-round/​on-destruction
   *generation* clause is intentionally NOT re-authored — but because that omits part of the
   rule, the entry is still an approximation and MUST carry the `[APPROX]` mark (below).

This is the opposite contract from the **raw-text store**, which MUST reproduce the
ability's exact wording. Same ability → two representations: DSL = strongest-case
mechanical estimate; store = verbatim text. When the verifier weighs faithfulness, it
judges the *strongest-case mechanic*, not text-completeness.

Corollary for the final report: a "rules update" that only changes a trigger distance,
a condition, or a resource-gain cadence usually needs **no DSL re-author** (the store holds
the new text, and the DSL models the strongest case). Re-author only for genuine
effect-magnitude or wrong-effect changes — but if the DSL no longer fully matches the
current rule, still add the `[APPROX]` mark (below) so the divergence is tracked.

### Mark every approximation — the `[APPROX]` convention

When a DSL entry does NOT fully/faithfully represent its rule — a strongest-version
simplification, a dropped condition/clause, or a placeholder — it MUST be flagged so a
later faithful-authoring pass can find and extend it. The standardized marker is a
**leading `[APPROX]` token in `community_notes`** (chosen over a schema field so it needs
no downstream regen/approval; promote it to a structured field later only via the normal
Schema Change process):

```
[APPROX] <exactly what is simplified or dropped vs the full rule>. Full rule in raw-text store. <any prior notes>
```

Rules:
- Prepend the token; **preserve** any existing `community_notes` after it. Don't double-mark
  (check for `[APPROX]` first).
- Be specific about the gap ("+1 Hit/Wound applied unconditionally; rule gates it on the
  target having destroyed a friendly unit"), so the later pass knows what to extend.
- **Strongest-case and resource-as-spent modeling ARE approximations — mark them.** Any
  time the DSL omits or simplifies part of the rule (a dropped condition/clause, an
  upper-bound assumption, modeling only the resource's spend and not its generation), the
  entry gets `[APPROX]`. Only an entry that **completely and faithfully** captures the rule
  is left unmarked.
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
lives ONLY in the out-of-repo `40kdc-abilities` store. So when a mechanic resists a
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

- Raw GW rule text goes ONLY to git-ignored / out-of-repo places: `_private/**`,
  the ignored `data/_audit/author-input/<faction>.json` workspace, and the private
  `40kdc-abilities` store. Never write it into a tracked repository file.
- Never commit source PDFs. Don't paste prose into `name` / `community_notes` / any DSL
  field (the audit flags it `gw-leak`). Names are factual labels and are fine.

## Workflow (run every step, no stopping)

You run all commands. `propose` / `repair` shell out to `claude -p` (must be installed
+ authenticated; spends the user's tokens). Those passes are long — run them in the
**background** and read their output when done. Surface CLI/auth failures; don't retry blindly.

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

If the fork lacks core data (`data/core/<faction>/` absent), pass just the existing
abilities; extraction then best-effort slugs `unit_ids` from datasheet names.

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

Seeds empty stubs into live `abilities.json`, writes the canonical author-input, and
writes the raw-text store. Note its summary (esp. the "merged into authored" count) for
the final report.

### 5. Author: propose → repair-until-converged → apply (the autonomous core)

1. `npm run author:propose -- <faction>` (Haiku). Note the `gateable` count.
2. **Repair loop** — `author:repair` re-touches ONLY still-ungated residue and recovers
   failed batches, so loop it:
   - `npm run author:repair -- <faction> --batch 3` (Sonnet). Re-run while `gateable`
     keeps rising (cap ~3 passes). Use a **small `--batch`**: the default 8 overflows a
     single `claude -p` call on conditional stratagems and fails whole batches.
   - One final escalation on the stubborn residue: `npm run author:repair -- <faction>
     --batch 2 --model claude-opus-4-8`.
3. `npm run author:apply -- <faction>` (autonomous). Splices the gated set into stubs;
   already-authored entries are skipped as "not-a-stub".

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
the out-of-repo `40kdc-abilities` store), and the **DSL→English** readout. Output goes to
`_private/reports/ability-review-<faction>.md` — **git-ignored, because it embeds GW text; never
commit it.** Skim it to confirm each authored entry is a faithful strongest-case estimate of its
rule (strongest-case and `[APPROX]` simplifications are expected, per the IP/fidelity sections);
surface any genuine mismatch in the final report. Abilities with no store text (e.g. universal
USRs) render `_(not in raw-text store)_` — expected, not a defect.

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
- **DSL authoring (step 5, the pipeline):** gate makes a weaker model **lower yield,
  not lower correctness** (rejects stay stubs, never reach live data). Default ladder:
  Haiku `propose` → Sonnet `repair --batch 3` (looped) → Opus `repair --batch 2` for the
  tail. A pass uses ONE model for *both* classify and the fidelity verifier, so never
  drop `propose` below Haiku (it weakens the judge, not just the author).

## Final report (bundle ALL of this — the only place you raise anything)

End with one consolidated summary:
- **Authored:** count applied to live data; coverage (off/def); `validate` result;
  `gw-leak` count.
- **Fidelity-review report (Step 6):** the path written
  (`_private/reports/ability-review-<faction>.md`) and any source-vs-DSL mismatches the
  side-by-side surfaced (genuine errors only — strongest-case / `[APPROX]` modeling is expected).
- **Stubs remaining,** bucketed by why: not-faithful (verifier rejected), complex,
  unencodable (flagged — need hand-authoring), schema-invalid.
- **Schema changes (NEED APPROVAL):** any condition type / effect field / modifier key
  you added to represent an otherwise-unmodelable mechanic — with a one-line rationale,
  the affected abilities, and the required downstream regen before merge.
- **Unmodeled by design:** out-of-scope omissions (build restrictions, pre-game,
  bespoke sub-abilities) — flagged here, never silent.
- **Review items:** "merged into authored" unit-link additions; any same-name collisions.
- **Assumptions** you made (faction/edition inference, best-effort `unit_id` slugs, …).
- **Questions** for the user — bundled here, nowhere else.
- **Push-ready state (Step 7):** confirm all data-derived artifacts (Rust/Python/Go bundles +
  TS corpus) were regenerated and the **TS conformance suite** is green locally; state that the
  Rust/Python/Go suites and the cross-impl parity differ are deferred to CI (`conformance`/`rust`/
  `python`/`go` jobs + `parity.yml`); state the `SPEC_VERSION` (and whether it was bumped); flag
  any regen step whose toolchain was missing as a **blocking** follow-up (a stale committed bundle
  turns CI red).
- **Recommended next actions:** commit in two repos — the `data/enrichment/<faction>` changes
  **together with** the Step-7 regen outputs (`conformance/**`, the Rust/Python/Go bundles,
  `SPEC_VERSION`/`_spec.py`/`go/spec.go`) as one push-ready commit, and the `40kdc-abilities` store
  repo separately; hand-author / Opus-retry the listed residue.

## The raw-text lookup store

`author:ingest` writes to `RAW_TEXT_STORE` (default `../40kdc-abilities`, a sibling of
the repo; resolved relative to the tool so it's found regardless of cwd):
- `index.json` — flat `ability_id → { faction, raw_text }` for O(1) lookup.
- `<faction>.json` — full records (id + hierarchy + provenance + `raw_text`).

It's its own git repo (auto-`git init`ed on first run; writes are additive — existing
entries are never deleted, same-id entries update in place). Recover any ability's
original text by reading `<store>/index.json` and indexing by `ability_id`.

## Idempotency

Re-running the same input is safe: ids are reused (no duplicate stubs, additive unit
merges), author-input entries are replaced by id, the store merges additively, and
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
