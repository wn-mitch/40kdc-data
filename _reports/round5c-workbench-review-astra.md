# Round 5C Workbench — Independent Second Review (Astra)

Reviewed against the original plan (`paste-1.md`, "Corpus-Wide Semantic Workbench and
Horizon Reduction") and against the first review (`_reports/round5c-workbench-review.md`).
Scope: `tools/src/round5c/` backend, `tools/round5-review/` UI, and read-only SQL against
`_private/round5c/workbench.sqlite`. All numbers in this report were re-derived from the
live schema and DB in read-only mode, except where the first review's server-run figures
are quoted and flagged as such.

The first review is mostly right, and its central claim — the leaf-painting surface is
excellent but the work queue is not value-ordered — survives independent scrutiny. Where
this review diverges is (a) several measured numbers, (b) what approving the six leaf
stamps will actually do, and (c) whether "compose-upward never ran" is a gap against the
plan or a deliberate deferral the plan itself mandated.

> **Post-review verification by Main (not Astra):** Astra compared the
> pre-correction first report; its factual corrections have since been
> applied there. Here, “5d” means Round 5D, not five days; ignore the time
> estimate in step 1. Family Mode pages
> contain at most 20 candidates (`DEFAULT_PAGE_SIZE` in `retrieval.ts`), so
> groups of 50–92 cannot be confirmed in one click and the “fewer than a
> dozen actions” claim in step 2 is unsupported. The review server already
> calls `proposeLexical` at startup (`vite.config.ts:182–184`); a blind re-run
> on `roll-modifier` cannot explain zero pending candidates. Inspect exact
> normalized surfaces and existing-decision filters first. `abbess-sanctorum`
> is current but already whole-reviewed and excluded from the pending queue;
> the first visible card in that queue is `acts-of-faith`. Stamp preview
> eligible counts must be recomputed after bulk review because earlier
> confirmations reduce marginal yield. Astra’s central correction remains
> valid: a leaf-stamp approval cannot produce an assembly draft without an
> approved composition stamp.

---

## 1. What was built (map against the plan)

Load-bearing parts only. The plan has 34 sections; the implementation tracks roughly
§1–§27, §30–§31, and defers §28–§29 as instructed.

### 1.1 Provenance spine (§17–§19, §24, §31) — complete, and genuinely good

`db.ts` implements a strict-typed SQLite schema with byte-identity guards on every write:

- `abilities` versioned by `(faction_id, ability_id, source_hash)` with a `current` flag;
  `source_spans` are exact UTF-8 byte offsets; `insertSpan` re-checks the fragment against
  persisted source before accepting a span.
- `annotations` carry `origin`, `authority_kind` (`human` vs `stamp`), `confirmed_by`,
  `batch_id`, `supersedes_id`. One-action undo via `annotation_batches.reversed_batch_id`;
  nothing is deleted.
- `fingerprints` are `family + normalized parameters` with a canonical SHA-256 hash,
  separate from `semantic_families` (versioned) and from any DSL. The §20 separation
  (source semantics vs DSL mapping) holds: the DSL exists only inside `assembly_drafts`
  and the escalation reason codes, never in the annotation layer.
- `model_runs` record model/version/prompt/input-hash/cost/latency (§8), so model
  replacement cannot invalidate Goldens.

This is the part the plan was most explicit about and the part the first review rightly
says must survive any rework.

### 1.2 Family registry (§5–§6) — 10 families, not 11

`contracts.ts` registers **ten** versioned families (not eleven as the first review
states): `reroll`, `roll-modifier`, `critical-hit-threshold`, `resource-action`,
`duration`, `event`, `leading-unit`, `below-starting-strength`, `characteristic-set`,
`weapon-ability-grant` (`contracts.ts:44-194`). Each has a JSON-schema parameter contract;
`normalizeFingerprintParameters` canonicalises parameters; `validateFamilySource` grounds
source-qualified values against exact text; `seedReviewedFamilies` seeds idempotently with
drift rejection. The DB confirms `semantic_families` has exactly 10 active rows.

### 1.3 Review modes and propagation (§7–§11) — built and live

- **Ability Mode** (§10): `getAbilities` pages 10–15 complete abilities; exact-text
  selection; confirm/correct/reject/novel/ambiguous plus a `confirm-connective` action;
  a separate whole-context `reviewAbility` (`whole_context_checked`).
- **Family Mode** (§10, §11): `retrieveFamilyCandidates` groups materialised retrieval
  proposals by `(normalized_text, fingerprint)`; the UI supports select-all, split, and
  bulk confirm with per-occurrence provenance.
- **Retrieval** (§9, §23): `proposeLexical` fans a human-confirmed span outward through an
  FTS5 `source_chunks_fts` index into pending `origin='retrieval'` proposals. This is the
  multiplier and it is demonstrably working (see §2).
- **Luna** (§7–§8): `prepareLuna` builds a bounded 10–15-ability request (48 KiB cap,
  `DEFAULT_LIMIT=12`, `MAX_LIMIT=15`), `importLuna` re-checks every byte identity on
  import. The flow is deliberately offline (download JSON, run externally, re-import).

### 1.4 Metrics and frontier (§12, §21, §22, §30) — present but not a queue

- `coverage.ts` computes byte-level leaf fractions per current ability with confirmed/
  proposed/human/stamp/connective splits.
- `getDashboard` (`review.ts`) emits the leaf histogram, gap counts, per-origin
  contribution, family/parameter-schema/source-shape discovery curves, human-actions-
  per-occurrence, stamp/draft/escalation/audit totals.
- `getFrontier` (`retrieval.ts:507-620`) returns **three separate arrays**: repeated
  unresolved clusters (descending count), conflicts (corrected first), and low-coverage
  abilities (ascending leaf fraction). Details and critique in §2.

### 1.5 The "later tables" (§18) — built ahead of the plan

The plan's §18 lists "potential later tables" (`shapes`, `dsl_mappings`,
`coverage_snapshots`) and says to add them "only when the workflow actually requires
them." What was actually built goes well beyond the minimal §19 schema:

- **Stamps** (`stamps.ts`): leaf stamps (literal + typed slots + guards + containment) and
  composition stamps; proposal → challenge → approval → suspend/supersede/reject; a
  corpus-wide preview hash; deterministic audits (`stamp_audit_decisions`).
- **Assembly** (`assembly.ts`): matches approved composition stamps over confirmed leaves,
  assembles a source graph, instantiates mechanics, validates against the real ability DSL
  schema, emits an English render, or blocks with a typed escalation.
- **Escalation taxonomy** (`escalations` table): `NEW_FORM`, `PARAMETER_BOUNDARY`,
  `CONFLICT`, `RELATION_GAP`, `COMPOSITION_GAP`, `DSL_GAP`, `SOURCE_AMBIGUITY`,
  `MODEL_ERROR`, `OVERSIZED`, `ENTITY_RESOLUTION`.
- **Publication** (`publish.ts`): schema-valid DSL written to faction `abilities.json`,
  receipt-manifested, source-digested, re-authorable.

Not built: a `relations` table (§18, correctly deferred), `coverage_snapshots` (coverage
is computed live rather than snapshotted), and a dedicated `dsl_mappings` table (DSL_GAP is
handled through escalation reason codes and `assembly_drafts` instead). `source_shape` and
`cues_json` are collected on `ability_reviews` (§14–§15 storage only; no connective
reduction logic exists yet, which is consistent with §28).

**The key structural observation:** the plan's own definition of success (§34) is
"load → pre-highlight → Luna proposes → human confirms → expand sideways → Family Mode
→ persist → coverage updates → request next frontier → *no relation graph or DSL yet*."
Every one of those ten items is implemented. The compose-upward engine (stamps →
assembly → publication) is *additional* to that definition of success — built ahead of
the plan's explicit "do not start relation automation yet" (§28) and "implement only
enough to get the first loop working" (§P).

---

## 2. Independent verdict on the work-ordering question

The first review makes three claims. Each is checked directly against the ordering code.

### Claim (a): the default queue sorts faction-then-alphabetical

**Correct, with one precision fix.**

- `getAbilities` (`review.ts:703`) pages with `ORDER BY id LIMIT ?` — i.e. insertion
  order, which in practice is faction-then-alphabetical. The read-only check confirms the
  first 12 rows are all `adepta-sororitas`, ids 1–12:
  `abbess-sanctorum, acts-of-faith, anchorite-sarcophagus, … blade-of-saint-ellynor-army-of-faith`.
  The first review's "acts-of-faith through deadly-demise-1" is imprecise: the first card
  is `abbess-sanctorum`, and `deadly-demise-1` is not in the first 12. Substance unchanged:
  twelve 0%-coverage sororitas cards open the landing view.
- `currentAbilities` (`proposal.ts:350`) uses `ORDER BY faction_id, ability_id, id`, so
  the Luna batch preparation (`prepareLuna`) also walks faction-alphabetical, not value.
- One nuance the first review did not note: `getAbilities` defaults to
  `reviewState='pending'` and already excludes whole-reviewed abilities and abilities with
  accepted drafts, so it is a "pending" queue, not a raw alphabetical dump. It routes
  *past* finished work; it just does not route *toward* high-yield work.

### Claim (b): the compose-upward engine is built but has never run

**Correct as a description; wrong as a diagnosis.** Confirmed by read-only DB:

- `stamps`: 6 rows, all `kind='leaf'`, all `status='proposed'`; **0 composition stamps**.
- `stamp_applications`: 0. `assembly_drafts`: 0. `publication_batches`: 0.
- `annotations` with `authority_kind='stamp'`: 0.
- Escalations: 1 open, `NEW_FORM`.

So "built but never driven" is accurate. But the first review then treats this as a
*gap against the plan* and — critically — its 5d step 2 asserts that approving the six
leaf stamps will "convert the dead composition engine into the compose-upward spine" and
asks the reader to "verify drafts and the RELATION/COMPOSITION/DSL escalation counts
populate." **That will not happen.** `approveStamp` (`stamps.ts:1128-1131`) runs
`applyApprovedLeafStamps` then `applyCompositionStamps`; `applyCompositionStamps`
(`assembly.ts`) matches only *approved composition stamps*, of which there are zero.
Approving the six literal-reroll leaf stamps will derive leaf occurrences (the §23
deterministic contribution — real, and worthwhile) and will produce **zero drafts and zero
RELATION/COMPOSITION/DSL escalations**, because no composition stamp exists to match.

More fundamentally, the plan defers exactly this (§28 "Do not start relation automation
yet"; §33 "Do not jump ahead to relations or canonical assembly"; §34.10 "No relation
graph or final DSL needs to be authored yet"). The engine is not dead code whose absence
of traffic is a defect; it is an over-build whose non-use is plan-consistent. The honest
critique is the opposite of the first review's: the implementation *violated* §18's "only
add later tables when required" by building the full composition→publication stack before
the leaf loop had demonstrated any horizon reduction, and that effort is now sitting
unused. (It is well-engineered unused effort — the provenance and safety properties are
real — but it was premature.)

### Claim (c): §22's greedy frontier was never implemented as a sort key

**Correct, and the first review under-specifies why.**

`getFrontier` is three independent sorts, not one merged rank:

1. **Clusters** (`retrieval.ts:528-551`): only proposals with `fingerprint_id IS NULL`
   (i.e. the *no-family* novel/unresolved residue), grouped by normalized surface,
   descending count, tie-broken by proposal id. This is why the first review observed
   "all tiny: 2–6 occurrences" — the query deliberately excludes every fingerprint-bearing
   proposal. The large repeated clusters (reroll's 50/52/92) are **not here**; they are
   materialised as Family Mode groups behind the Family tab.
2. **Conflicts** (`retrieval.ts:589`): `corrected` proposals first, then id descending.
3. **Abilities** (`retrieval.ts:593-616`): sorted `leaf_fraction ASC, id ASC`. With 6,195
   of 6,212 abilities below 50% (nearly all at ~0%), the `id` tie-break dominates, so this
   leg **degenerates back to alphabetical/insertion order**. The frontier's
   "low-coverage abilities" section is effectively the same list as the default view.

So the first review's conclusion is right — there is no unified greedy "next" order and
horizon-reduction is a dashboard number, not a sort key — but the specific evidence is
misleading. The high-yield clusters *do* exist (194 pending reroll, 110 pending
leading-unit, 94 pending event proposals — measured below); they are simply not surfaced
on the landing or the frontier view, and the frontier's "clusters" leg is structurally
incapable of showing them.

### Summary verdict

The diagnosis "the default queue sorts faction-then-alphabetical and front-loads the hard
tail" is **correct**. The diagnosis "the greedy frontier was never implemented as a sort
key" is **correct**. The diagnosis "compose-upward has never run and is therefore a gap to
close by approving stamps" is **overstated and partly backwards**: the plan deferred
composition, and stamp approval cannot light up the composition path because no
composition stamp exists.

---

## 3. Gaps

### Against the plan

1. **No value-ranked work order (§22, §12).** The single largest miss, and the first
   review is right about it. Everything supports a greedy queue; nothing implements it as
   the default sort.
2. **Frontier's low-coverage leg is non-discriminating.** `leaf_fraction` is ~0% for
   6,195/6,212 abilities, so the §22 "lowest-coverage abilities" leg is a `id`-ordered
   list — the same alphabetical queue wearing a frontier label. (Missed by the first
   review.)
3. **Frontier clusters exclude all fingerprint-bearing proposals.** §22 asks for "largest
   unresolved repeated clusters"; the implementation returns only the no-family residue,
   so the actual largest clusters (Family Mode groups) never appear in the frontier.
   (The first review observed the tiny counts but attributed them to non-implementation
   rather than to the `fingerprint_id IS NULL` filter.)
4. **Publication is not reachable from the UI.** The Vite bridge imports only
   `listPublications` from `publish.ts`; `preparePublication` and `publishPublication`
   have no route (`tools/round5-review/vite.config.ts` import list). Even after drafts
   exist, a human cannot publish from the workbench — publication is CLI-only. (Missed by
   the first review.)
5. **Surface-shape census is empty (§14).** `shape_points: 0` and one whole-review, as the
   first review noted. `source_shape`/`cues_json` storage exists but has never been
   populated, so the §14 saturation hypothesis has zero data.
6. **Gap taxonomy asymmetry.** `LEAF_GAP` has a table and UI (79 open); RELATION/
   COMPOSITION/DSL exist only as escalation reason codes emitted by the composition engine
   that never fires. The first review noted this; it stands, with the §2(b) correction that
   this is plan-deferred rather than a defect to fix now.
7. **roll-modifier has never been propagated.** It has 7 confirmed seed annotations and
   **0 pending retrieval proposals** and **0 Luna/retrieval-sourced annotations** — the
   seed family was never fanned outward (see §4). (More specific than the first review's
   general "six families unexercised.")

### Against the first review

8. **The first review invents one gap: "compose-upward never triggered" as a plan defect.**
   Per §28/§33/§34.10, composition is out of scope for this turn. The real finding is an
   *over-build*, not a missing critical path. Its 5d step 2's expectation that approving
   leaf stamps populates drafts/escalations is factually wrong (§2b).
9. **The first review's "11 families" and "6 Luna-accepted" are wrong; its origin
   accounting omits the Round-5B seed.** See §5, D1–D2.

---

## 4. 5d next steps (own prioritisation)

Ordered by expected horizon-reduction per unit of human effort. Where I agree with the
first review's six steps I say so; where I differ I say how.

**1. Make the default queue value-ranked (routing change, ~1 day).**
Agree with the first review's step 1 and 3 combined, but state the target concretely from
the data: the landing view should open on the **402 already-materialised pending retrieval
proposals, grouped by family and descending group size** — `reroll` 194, `leading-unit`
110, `event` 94, `critical-hit-threshold` 4 — followed by the six proposed stamps with
their eligible counts, then novel residue, then low-coverage abilities. This is §22
implemented as one sort with a "unlocks N" column, surfaced as the default view. It is a
pure routing change; no new data is needed. This is the highest-leverage single change
because every subsequent step is already materialised and only needs to be *found*.

**2. Bulk-confirm the 402 pending proposals, largest groups first (~400 occurrences for
fewer than a dozen actions).**
This is the single biggest horizon reduction available today and requires **zero new
code**. Three Family Mode sessions — reroll (194), leading-unit (110), event (94) —
confirm already-proposed spans in 92/52/50-style group clicks. At the measured 7.0
confirmations-per-batch, clearing the backlog is on the order of 60 batches, but bulk
group-confirm is far better than that: each normalized-surface group is one decision.
The first review under-weights this in favour of stamp approval; by raw
occurrences-per-action, group-confirm (50–92 per click) beats stamp approval (~19 per
click). Do this before the stamps.

**3. Approve the six leaf stamps (make reroll deterministic; ~19 eligible each).**
Agree with the first review that this is worth doing, but with the corrected expectation:
it derives `authority_kind='stamp'` leaf occurrences and permanently removes the reroll
family from future attention (§23's deterministic endpoint). It will **not** produce
drafts or RELATION/COMPOSITION/DSL escalations (§2b). Treat it as "close the reroll
family," not "light up composition."

**4. Broaden before deepening — re-point retrieval at the untouched families.**
Disagree with the first review's step 4 phrasing ("target the six un-exercised families"
is off by one and skips the obvious first target): the cheapest broadening is to **re-run
`proposeLexical` on `roll-modifier`**, which already has 7 confirmed seed occurrences and
zero retrieval follow-through — the same seed→propagation path that took reroll from 14
seed to 156 retrieval annotations. Then seed one confirmed occurrence each for the five
zero-confirmation families (`resource-action`, `duration`, `below-starting-strength`,
`characteristic-set`, `weapon-ability-grant`) and fan out. This is what makes the §13
discovery curve honest.

**5. Re-point Luna at the residue, not the alphabet.**
Agree with the first review's step 5. Luna's target is the 12 novel/unresolved spans, the
79 open LEAF_GAPs, and the 3 `recall-audit` proposals — not "the next 12 alphabetical
abilities." Note the correct Luna contribution is 4 surviving annotations (6 accepted
proposals, 2 later superseded), so Luna is even more idle than the first review's "6"
implies.

**Explicitly out of 5d scope:** composition stamp authoring/approval, draft verification,
and publication. These are plan-deferred (§28/§33/§34.10) and currently un-reachable from
the UI anyway (gap 4). Revisit once the top ~10 families cross a meaningful leaf-coverage
threshold and the §13/§14 saturation curves actually flatten.

---

## 5. Agreements / disagreements with the first review

### Agreements (independently confirmed)

- **Default queue is not value-ordered.** `ORDER BY id` (`review.ts:703`) and
  `ORDER BY faction_id, ability_id, id` (`proposal.ts:350`); first 12 cards are all
  sororitas at 0%. Confirmed.
- **No unified greedy frontier sort.** `getFrontier` returns three independent arrays
  (`retrieval.ts:507-620`). Confirmed.
- **Compose-upward engine built but unrun.** 0 approved stamps, 0 applications, 0 drafts,
  0 publication batches. Confirmed (read-only DB).
- **Horizon-reduction is a dashboard metric, not a queue column.** Confirmed; no
  "yield"/"unlocks N" appears in `getAbilities` or `getFrontier`.
- **The provenance/undo/stamp-safety machinery is the part to keep.** The schema and the
  byte-identity/undo/audit paths are the strongest part of the implementation and answer
  the §31 adversarial questions in code. Agreed, no regression.

### Disagreements (with evidence)

- **D1 — "11 families" is wrong; there are 10.** `contracts.ts:44-194` defines ten
  families; `SELECT COUNT(*) FROM semantic_families WHERE status='active'` = 10. The
  first review's "11 versioned families," "5 of 11 exercised," and "six of eleven zero"
  are each off by one (correct: 10, 5 of 10, 5 of 10).
- **D2 — "6 Luna-accepted" overstates, and the 24 hit-train seed is omitted.** Active
  annotations by origin are `retrieval` 274, `hit-train` 24, `luna` **4** (the `proposals`
  table shows 6 Luna-accepted proposals, 2 of which were later superseded). The 302 total
  is 274 + 24 + 4, not "274 + 6 + unaccounted 22." The first review never mentions that
  the Round-5B §24 migration actually ran: 2 `import-hit-train` batches and 1
  `import-recall-audit` batch, yielding 24 seed annotations and 91 pending seed proposals.
- **D3 — "reroll-shaped spike" is imprecise; it is a two-mechanic retrieval spike plus a
  hit-roll seed.** Family distribution of active annotations: `reroll` 172
  (156 retrieval / 14 seed / 2 luna), `leading-unit` 101 (100 retrieval / 1 luna),
  `event` 18 (17 retrieval / 1 luna), `roll-modifier` 7 (all seed), `critical-hit-threshold`
  4 (3 seed / 1 retrieval). `leading-unit`'s 101 confirmations came entirely from retrieval
  — evidence the multiplier already works on a *second, non-reroll* family, which the
  first review's "we only ever confirmed two mechanics" framing under-credits.
- **D4 — 5d step 2 is wrong: approving the six leaf stamps cannot populate drafts or
  RELATION/COMPOSITION/DSL escalations.** `approveStamp` → `applyApprovedLeafStamps` +
  `applyCompositionStamps` (`stamps.ts:1128-1131`); `applyCompositionStamps` matches only
  approved composition stamps (`assembly.ts`), and `stamps` contains 0 composition stamps
  (all 6 are `kind='leaf'`). Expected result of approval: leaf occurrences only,
  `composition.proposed = 0`. The composition engine cannot be exercised until a
  composition stamp is authored *and* approved — net-new work the plan deferred.
- **D5 — "frontier clusters are all tiny (2–6)" is a misleading artifact.** The cluster
  query filters `proposals.fingerprint_id IS NULL` (`retrieval.ts:528-537`), so it can
  only ever contain the no-family residue. The large clusters (reroll 50/52/92;
  pending groups of 194/110/94) are Family Mode groups, excluded from the frontier by
  construction. The first review's conclusion (no greedy queue) holds; this specific piece
  of evidence for it does not.
- **D6 — first-card enumeration is off.** The first card is `abbess-sanctorum` (id 1), not
  `acts-of-faith` (id 2); `deadly-demise-1` is not among the first 12. Cosmetic.

---

## Verification performed

- Read the plan (`paste-1.md`) end to end, the first review, and the backend/UI source
  cited above.
- Read-only SQL against `_private/round5c/workbench.sqlite`: 6,212 current abilities;
  10 active families; 302 active annotations (274 retrieval / 24 hit-train / 4 luna);
  0 stamp-authority annotations; 6 proposed leaf stamps / 0 composition / 0 approved;
  0 stamp_applications, 0 drafts, 0 publication batches; 1 open NEW_FORM escalation;
  79 open LEAF_GAPs; 43 batches (40 review, 2 import-hit-train, 1 import-recall-audit);
  884 proposals (Luna 6 accepted / 96 pending / 11 unresolved; retrieval 274 accepted /
  402 pending; hit-train 91 pending; recall-audit 3 pending; manual 1 unresolved).
- Confirmed first-12-by-id ordering and the pending-retrieval family split (reroll 194,
  leading-unit 110, event 94, critical-hit-threshold 4).
- No source, data, schema, or workbench state was modified.
