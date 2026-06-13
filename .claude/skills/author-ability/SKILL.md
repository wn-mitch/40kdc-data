---
name: Author Ability
description: One-shot ingest of 40K abilities from a PDF or JSON into 40kdc-data's non-agentic DSL pipeline, capturing raw text into a sibling store keyed by ability_id. Runs end-to-end autonomously (extract → ingest → propose → repair-until-converged → apply → validate) without pausing, and bundles any questions into a single final report. Use for "author/import abilities from this PDF/JSON", "structure these abilities", "fill ability stubs", "build the raw-text lookup". Never hand-writes DSL — the gated classify→assemble→validate→verify pipeline does.
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
express it, do so. If it genuinely cannot:
1. Do NOT emit a feature-dropped version as if complete, and do NOT smuggle it through
   an open `parameters`/`modifier` field with an invented value (e.g.
   `attack-is-type: "strength-exceeds-target-toughness"` — that's not a real enum).
2. Propose a MINIMAL extension aligned with existing patterns — a new `condition` type
   (condition.schema.json enum + its `$comment`), an optional `single-effect` field
   (effect.schema.json, e.g. `scaling`), or a documented modifier-narrowing key — and
   wire it into the engine: add the key to `CANONICAL_MODIFIER_KEYS` and teach
   `REPAIR_SYSTEM` in `tools/src/author-batch.ts` so future runs emit it.
3. Implement it, re-author the affected abilities against it, and `validate`.
4. **ALWAYS run the CONTRIBUTING.md downstream regen after any schema edit** — the
   generated TS/Rust/Python artifacts drift otherwise and CI fails. Run, from the repo
   root:
   ```bash
   cd tools && npm run bundle:schemas && npm run codegen:types && npm run codegen:data && cd ..
   cargo run -p xtask -- codegen && cargo run -p xtask -- bundle-data
   python3 python/codegen/sync_bundle.py && python3 python/codegen/sync_spec.py && python3 python/codegen/gen_typeddicts.py
   cd tools && npm test && npm run validate          # then cross-impl: python3 tooling/parity/differ.py --pair ts,py (and rust,py)
   ```
   `gen_typeddicts.py` needs the Python dev deps (`cd python && uv pip install -e ".[dev]"`); the parity differ needs built runners. If a step's toolchain is absent, report it as a required follow-up rather than skipping silently. Bump `conformance/SPEC_VERSION` only if you changed a conformance golden (a pure additive schema change does not).
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
  `data/_audit/author-input/<faction>.json`, and the `40kdc-abilities` store. **Never**
  into a committed `data/enrichment/**` field, and never write a manifest under `tools/`.
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
- **JSON:** parse the army-assist / `reauthor-input` shape (`name`, `unit_ids`,
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

### 6. Validate & measure

`npm run validate` (must pass) and `npm run audit:coverage`. A `gw-leak` > 0 is a real
problem — locate and strip the prose before finishing.

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
- **Recommended next actions:** commit the `data/enrichment/<faction>` changes and the
  `40kdc-abilities` store repo; hand-author / Opus-retry the listed residue.

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
- `schemas/enrichment/ability-dsl/{ability,effect,scope,condition}.schema.json` — the
  DSL contract the gate enforces (read to explain a gate/skip).
