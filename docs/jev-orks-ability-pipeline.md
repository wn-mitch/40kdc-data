# JEV → Ork ability pipeline (master)

Source text in, DSL out, with a fidelity check that attributes any gap to either the
authored record or the describer. This is the working reference for the Ork pass.

Source prose lives in `_private/jev-orks/` (gitignored), so this document cites ability
ids, counts, hashes, and field names only — never rule text.

## Where it stands

The Ork corpus is fully examined. Of the 245 abilities with source text, 12 form the
supervised cohort, 15 are a legacy cohort examined before slicing existed, and the
remaining 218 are the slice pool — 15 slices of 15, the last of 8. The **build** half
works end to end: every ability yields confident, source-bound claims. The gap is
**construction**, and it is structural rather than a matter of tuning.

| Measure | Value |
| --- | --- |
| Ork abilities with source text | 245 (12 supervised + 15 legacy + 218 sliced) |
| Slices recorded | 15 / 15 (14 × 15, then 8) |
| Question banks / cached responses | 245 banks / 973 response files (967 distinct requests) |
| Claims proposed | 11,085 (min 11, max 98, mean 45.2 per ability) |
| Candidates **constructed** | 4 |
| Candidates **incomplete** | 241 |
| Round-trip buckets (245) | divergence 146, delegated 97, declared-approximation 2 |
| Two-leg localiser (33 hand-labelled) | clean 0, authoring 6, describer 0, both-wrong 27 |
| Repeatability | 1 ability × 3 runs: selection and construction stable, distribution not |
| Observed cost | $0.073 — 1,734,093 in / 499,233 out; budget $2 |

The four constructed abilities are the hand-written pilots: `bomb-squig`,
`try-dat-button-dread-mob`, `waaagh-banner`, `where-dya-fink-youre-going-da-big-hunt`.

## Pipeline

### Stage 0 — source state

`_private/jev-orks/source-corpus.json` holds per-faction ability source text. For each
ability a **state** is assembled at `_private/jev-orks/source-state/<ability>.json` with
the keys `ability`, `hierarchy`, `entity_context`, `literal_candidates`, `source_text`.

State is the TypeSafe sense of the word: the fixed context a typed question is evaluated
*against*. Nothing interpretive is pre-computed into it.

### Stage 1 — extraction

`extractionQuestions` asks eleven classification slots in one packet:

```
composition  primary_effect  has_condition  has_deliberate_choice
has_keyword_eligibility  has_multiple_effects  has_random_resolution
has_target_selection  has_trigger  has_usage_limit  likely_ontology_gap
```

Every answer carries a probability, and the probabilities are the point — they are what
the closure and acceptance gates read. `composition` and `primary_effect` together are
the **family** the constructor dispatches on.

### Stage 2 — decomposition and refinement

`decompositionQuestions` / `genericDecompositionQuestions` / `genericRefinementQuestions`
open recursive question packets, one per unsettled slot, bounded at roughly three stages
and steered by `decompositionEvidence`, `slotEvidence`, `slotOf`, and `leafSettled`.

Closure is evaluated **per slot, not per question** — see Design law 1, which is the
single most expensive thing the experiment learned.

### Stage 3 — claims

`claimsFromResponse` turns settled answers into claims, written to
`_private/jev-orks/claims/<ability>.json`:

```json
{
  "id": "eb4b5ea6…0e730",
  "ability_id": "adrenaline-junkies-kult-of-speed",
  "question_id": "composition",
  "predicate": "jev.composition",
  "value": "conditional",
  "probability": 0.56,
  "selected": true,
  "source_digest": "063bbe2c…b1572",
  "state": "proposed"
}
```

`source_digest` binds every claim to the exact source revision it was read from, so a
claim cannot silently outlive the text that justified it.

### Stage 4 — construction

`constructCandidate(abilityId, current, claims)` produces
`_private/jev-orks/candidates/<ability>.json` with either

- `constructed` — a candidate effect tree plus `consumed_claim_ids` and
  `unconsumed_claim_ids`, or
- `incomplete` — `consumed_claim_ids` empty plus `findings`.

Dispatch is a lookup table:

```ts
const CONSTRUCTORS: Partial<Record<CohortAbilityId, CandidateConstructor>> = {
  "bomb-squig": constructBombSquig,
  "try-dat-button-dread-mob": constructTryDatButton,
  "waaagh-banner": constructWaaaghBanner,
  "where-dya-fink-youre-going-da-big-hunt": constructFallbackHazard,
};
```

Keyed by **ability id**, with four entries. Everything else falls through to

```
unsupported family: composition=<c>; primary_effect=<p>; ontology_gap=<g>
```

That single line accounts for all 241 incomplete candidates. This is the gap.

### Stage 5 — verification and acceptance

A verification pass asks atomic questions against the constructed candidate; a confident
defect rejects it. Acceptance is gated at `ACCEPTANCE_CONFIDENCE = 0.8`.

### Stage 6 — round-trip fidelity

Two independent instruments, deliberately different in kind.

**Fact report** (`round-trip-report.ts`) — `facts` / `factDiff` over rendered text versus
source text, scored with `jaccard` and `cosine`, classified by `defectClasses` into
buckets `divergence` / `declared-approximation` / `delegated`.

**Two-leg localiser** (`jev-round-trip.ts`) — asks JEV literal propositions about each
end of the pipeline and attributes the fault:

- **Leg one** — authored record versus source text: is every effect, condition, and
  quantity represented; is randomness preserved as table structure rather than flattened;
  is the recipient preserved; does it add nothing?
- **Leg two** — rendered prose versus authored record: does the prose state every effect
  and quantity, match recipient, respect scope kind, avoid placeholder prose, add nothing?

`evaluateLeg` requires **every** proposition to clear the threshold, then
`localise(leg1, leg2)` yields one of:

| leg one | leg two | verdict |
| --- | --- | --- |
| clean | clean | `clean` |
| faulted | clean | `authoring` |
| clean | faulted | `describer` |
| faulted | faulted | `both-wrong` |

A leg is faulted when a proposition fails **or** a named defect is reported that is not
`no-material-difference`. The defect vocabularies are the useful output: authoring
(`omitted-effect`, `omitted-condition`, `omitted-quantity`, `flattened-randomness`,
`wrong-recipient`, `invented-effect`) and describer (adds `placeholder`,
`weapon-context-misuse`).

### Reproducibility and cost

Requests are content-addressed — `hash({version, request})` — and responses are cached at
`_private/jev-orks/responses/<hash>.repeat-<n>.json`. A cache miss throws unless `--live`
is passed, so an ordinary run is offline and cannot silently spend money.

**Stability is barely measured.** 967 distinct requests are cached, and exactly one
ability was run three times (`try-dat-button-dread-mob`). On that one, selection and
construction were identical across all three runs while the probability distribution was
not — so a gate that reads probabilities rather than selection can flip on a re-run.
Every other ability has a single recorded run, and its "identical" flags are trivially
true rather than evidence of determinism. Nothing here yet licenses trusting
`ACCEPTANCE_CONFIDENCE` as a stable boundary.

Pricing is modelled at `INPUT_PRICE_PER_MILLION_USD = 0.042` with a scheduling reserve,
under a `--budget` ceiling.

## Design laws

Earned from the experiment, with the evidence that forced each one.

1. **Closure is per slot, not per question.** Conjunctive closure over a flat question
   list scored 1/15. Re-scoring the same answers per slot scored 12/15. Raising per-leaf
   reliability 76% → 85% while growing leaves 13 → 32 moved closure 1/15 → 0/15 — better
   answers, worse score, the signature of a gate measuring the wrong quantity.
2. **A forced choice cannot describe a multi-valued or unstated slot.** 5 of 6
   single-choice slots produced mid-band answers by construction; `condition_relation`
   failed 11 of 15 abilities because its predicates co-occur in one source clause.
3. **Derive absence; never ask for it.** `semantic_duration=none` was ambiguous in 8 of 15
   abilities, and the last remaining blocker after 12/15 was a negation-flavoured boolean
   (`controller_choice_present`) sitting at 0.53–0.59. Omitting the question and deriving
   the field from clause structure closed all 15.
4. **Gate generation on confident answers only.** `has_trigger` at 0.51 spawned a
   `trigger_event` slot whose emptiness then counted against closure.
5. **Slots are per clause.** `semantic_subject` held both `this-unit` and `selected-unit`
   in the ambiguous band for 6 of 15 abilities. Selection sentences and effect sentences
   have different subjects, so one per-rule slot cannot hold the value. *Observed but not
   yet repaired.*

## Next steps

Ordered by how much of the corpus each unblocks.

### N1 — Replace per-ability constructors with a family registry

**P0.** Keyed by `(composition, primary_effect)`, the pair the classifier already emits,
instead of ability id. The distribution across the 241 incomplete candidates is 35
distinct families, heavily front-loaded:

| Abilities | Family |
| --- | --- |
| 54 | `conditional/ability-grant` |
| 31 | `conditional/roll-modifier` |
| 27 | `conditional/stat-modifier` |
| 15 | `conditional/other` |
| 11 | `conditional/restriction` |
| 9 | `conditional/mortal-wounds` |
| 8 | `conditional/keyword-grant` |
| 7 | `sequence/ability-grant` |
| 7 | `selection/other` |
| 7 | `selection/roll-modifier` |
| 6 | `leaf/stat-modifier` |
| 6 | `leaf/ability-grant` |
| 6 | `leaf/roll-modifier` |

Three constructors cover **112 abilities (46%)**; the seven `conditional/*` families shown
above cover **155 (64%)**, and all eight `conditional/*` families together cover **156
(65%)**. The remaining families are a long tail — 15 of the 35 have two abilities or
fewer, and should be an explicit keep-or-drop decision rather than default neglect.

Contract for each family constructor: consume the claims it understands, return the ids
it did **not** consume as findings. The current `incomplete` path reports one aggregate
family string and discards per-claim reasons, which makes the 241 candidates harder to
work than they need to be.

### N2 — Calibrate the localiser; it cannot currently say `clean`

**P0.** Leg one passed **0 of 33**. Against the hand labels in
`_private/jev-orks/round-trip-labels.json`:

| Hand label | n | Localiser verdicts |
| --- | --- | --- |
| `expect_clean` | 15 | authoring 3, both-wrong 12 |
| `expect_authoring_fault` | 16 | both-wrong 13, authoring 3 |
| `expect_describer_fault` | 4 | both-wrong 4 |

**15 of 15 records a human called clean got a fault verdict**, so the instrument is not
usable as a gate yet. The likely cause is in `evaluateLeg`: a proposition fails when
`!(probability >= 0.8)`, which cannot distinguish *false* from *unconfident*. A `noul` at
0.75 is "don't know", and design law 1 is exactly the lesson that treating an unsettled
slot as a defect destroys the score.

Candidate fixes, in cost order: fault a leg only on a **named** defect; or route
unconfident propositions to a refinement question instead of failing them; or calibrate
per-proposition thresholds against the labels. Acceptance: `expect_clean` reaches `clean`
and `expect_authoring_fault` reaches `authoring`.

### N2b — Widen the repeat cohort before trusting any threshold

**P0.** Both gates read probabilities, and stability is measured on a single ability. Run
a representative cohort (say one per family, plus everything accepted) at three repeats
and re-derive the flags. If distributions move materially on re-run, the fix is to make
the gate read **selection** where it currently reads a probability, or to require
agreement across repeats — not to move the threshold until the flakiness hides. Cheap:
each ability's cached run costs fractions of a cent, and repeated requests are cached
under their own `repeat-<n>` files.

### N3 — Work the authoring defect queue

Across the 33 localised abilities: `omitted-condition` 11, `invented-effect` 7,
`wrong-recipient` 4, `flattened-randomness` 3, `omitted-effect` 2.

`omitted-condition` leading is consistent with the closure work: conditions are where the
slot granularity is thinnest. `flattened-randomness` is the highest-severity class — a
table or variable roll collapsed into one unconditional effect changes play, not wording.

### N4 — Work the describer defect queue

`wrong-recipient` 2, `omitted-effect` 2, `weapon-context-misuse` 2, `invented-effect` 1.
Small, but these are the ones that would otherwise be misread as authoring faults.

### N5 — Repair design law 5 (slots are per clause)

Split `semantic_subject` (and its siblings) per clause, so selection sentences and effect
sentences can carry different subjects. The law was observed and never repaired, and it
is the named cause of an ambiguous band in 6 of 15 abilities.

### N6 — Shrink the opaque-grant tail

The grant-type vocabulary is 379 entries, frozen from usage. An `ability-grant` carrying
only a `grant_type` string and no other parameter asserts a label rather than a rule: 374
of the 3,920 enrichment records corpus-wide (9.5%), and **46 of the 294 Ork records
(15.6%)**. Each removal is an authoring job, and the vocabulary is the worklist. The
Ork share being higher than the corpus average is expected — the Ork pass is the one
that surfaced them.

### N7 — Decide the family tail

15 families have ≤2 abilities. Folding several into a generic shape may be cheaper than
15 constructors; leaving them unencoded is also defensible if the shapes are genuinely
irreducible. Either way, record the decision rather than letting the tail sit in
`incomplete` forever.

## Running it

```sh
npm run experiment:jev-orks                            # replay cache, offline
npm run experiment:jev-orks -- --live --budget 2        # real calls under a ceiling
npm run experiment:jev-orks -- --slice 15               # one slice of the corpus
npm run experiment:jev-orks -- --corpus <path> --dump <path> --private-root <path>
```

Artifacts land in `_private/jev-orks/`: `source-state/`, `question-bank/`, `responses/`,
`claims/`, `candidates/`, `comparisons/`, plus the rollups `run-summary.json`,
`slice-runs.json`, `slices.json`, `design-laws.json`, `question-refinement-ledger.json`,
`round-trip.json`, `jev-round-trip.json`, `round-trip-labels.json`,
`source-provenance.json`.

`_private/` is gitignored and absent from a fresh clone. Tests that need it skip rather
than fail, so the suite is green everywhere.

## Verification entrypoints

| Concern | Test |
| --- | --- |
| Construction, slices, closure, cost | `tools/test/jev-orks-experiment.test.ts` |
| Two-leg localiser and verdict attribution | `tools/test/jev-round-trip.test.ts` |
| Fact report, buckets, defect classes | `tools/test/round-trip-report.test.ts` |
| Grant-type vocabulary freeze | `tools/test/grant-type-vocabulary.test.ts` |
| Core ability catalog encoding | `tools/test/core-abilities.test.ts` |
| Rule text resolves to the right faction | `tools/test/source-provenance.test.ts` |

Reproducibility gate for any schema or data change: `just verify-regen-stable`.
