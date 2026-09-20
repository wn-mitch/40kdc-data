# Round 5C Workbench Review — Round 5D Plan

Reviewed against the original plan (`paste-1.md`, Round 5C "Corpus-Wide Semantic
Workbench and Horizon Reduction"). Scope: the `tools/src/round5c/` backend, the
`tools/round5-review/` UI, and the live SQLite corpus at
`_private/round5c/workbench.sqlite`. All numbers below were measured by running
the dev server against a read-only copy of the database, not inferred.

## Verdict up front

Your read is correct, and it is sharper than the plan ever was. The plan
described two coupled stages: **paint leaves**, then **compose leaves upward**.
What got built is a first-rate leaf-painting surface with an unused
compose-upward engine bolted on, and a default queue that sorts faction-then-
alphabetical — which is the *worst possible* order for "knock out the lowest
hanging fruit over and over."

The provenance, deterministic propagation, and composition machinery exist.
What is missing is the **greedy driver**: a queue that ranks each next decision
by its current marginal corpus impact instead of paging through the alphabet.
See the independent second review in
`_reports/round5c-workbench-review-astra.md` for corrections and an alternate
priority order.

---

## 1. What we built

### 1.1 Provenance spine (the load-bearing part — do not regress)

Every write is byte-identity-guarded and reversible:

- `source_spans` = exact UTF-8 byte offsets into a source-versioned fragment,
  stored against `abilities(source_hash)`. No span can exist that does not match
  the persisted source bytes (`insertSpan` re-slots and re-checks).
- `annotations` carry `origin` (human / luna / retrieval), `authority_kind`
  (human vs stamp), `confirmed_by`, `batch_id`, `supersedes_id`. One-action undo
  via `annotation_batches` + `reversed_batch_id`; nothing is ever deleted.
- `fingerprints` are derived from `family + normalized parameters` with a
  canonical hash (§6), separate from `semantic_families` (versioned) and from
  any DSL (§20 held: coverage/families/annotations contain zero DSL).
- `model_runs` record model/version/prompt/input_hash/cost/latency (§8), so
  model replacement never invalidates Goldens.

This is the part most workbenches skip, and it is done correctly. It must
survive any rework.

### 1.2 Semantic-family registry (§5)

`contracts.ts` registers 10 versioned families with JSON-schema parameter
contracts: `reroll`, `roll-modifier`, `critical-hit-threshold`,
`resource-action`, `duration`, `event`, `leading-unit`,
`below-starting-strength`, `characteristic-set`, `weapon-ability-grant`.
Fingerprints are validated/normalized (`normalizeFingerprintParameters`),
source-qualified parameters are grounded against exact text, and the registry
is seeded idempotently with drift rejection.

### 1.3 Two review modes (§10)

- **Ability Mode**: 12 complete abilities per page, exact-text selection,
  confirm / correct / reject / novel / ambiguous, whole-context census.
- **Family Mode**: normalized-surface × fingerprint grouping, select-all,
  split-selection, bulk confirm/reject/correct with per-occurrence provenance,
  and a "reviewed N of M" progress bar.

### 1.4 Retrieval propagation (§9)

FTS5 lexical propagation: a confirmed span fans out to corpus neighbors as
pending `origin='retrieval'` proposals, grouped by
`(normalized_text, fingerprint)`. This is the multiplier, and it is live.

### 1.5 The compose-upward engine (§16, §20, §28 — built, not driven)

Beyond the plan's minimal schema, the "later tables" were actually built:

- **Stamps** (`stamps.ts`): leaf stamps (literal + typed slots + guards +
  containment) and composition stamps (fragment patterns → source graph →
  mechanics template). Proposal → challenge → approval → supersede/suspend/
  reject, with a corpus-wide preview hash and optional deterministic audits.
- **Assembly** (`assembly.ts`): matches approved composition stamps over
  confirmed leaves, assembles a source graph, instantiates mechanics, validates
  against the real ability DSL schema, and emits an English render — or blocks
  with a typed escalation.
- **Escalation taxonomy** (`NEW_FORM`, `PARAMETER_BOUNDARY`, `CONFLICT`,
  `RELATION_GAP`, `COMPOSITION_GAP`, `DSL_GAP`, `SOURCE_AMBIGUITY`,
  `MODEL_ERROR`, `OVERSIZED`, `ENTITY_RESOLUTION`).
- **Publication** (`publish.ts`): schema-valid DSL written to faction
  `abilities.json`, receipt-manifested, source-digested, re-authorable.

### 1.6 Dashboard (§30) and coverage (§J, §12)

`getDashboard` emits: leaf histogram (`<50 / 50–75 / 75–95 / ≥95`), gap counts
per type, per-origin contribution, family/parameter-schema/source-shape
discovery curves, human-actions-per-confirmed-occurrence, stamps, escalations,
drafts, audits. Coverage computes byte-level leaf fractions with
human/stamp/proposal split and connective subtraction.

### 1.7 Frontier view (§22)

`getFrontier` returns three separate lists: no-fingerprint unresolved clusters
(descending count), conflicts, and lowest-coverage abilities. Large groups
with a known fingerprint are available in Family Mode, not this frontier.

---

## 2. Where the corpus actually is (measured)

| Metric | Value |
|---|---|
| Total source records | **6,212** |
| Abilities with any confirmed coverage | **242** (3.9%) |
| Confirmed human occurrences | **302** |
| Derived (stamp) occurrences | **0** |
| Pending proposals | 581 |
| Novel / unresolved | 12 novel, 11 unresolved-model |
| Leaf histogram | <50%: 6,195 · 50–75: 8 · 75–95: 4 · ≥95: 5 |
| Average leaf fraction | **0.97%** |
| Whole-context reviewed | **1** |
| Families exercised | **5 of 10** |
| Approved stamps | **0** (6 proposed, all literal reroll) |
| Assembly drafts | **0** |
| Escalations | 1 open (1 occurrence) |
| Gap counts | LEAF_GAP 79 · RELATION 0 · COMPOSITION 0 · DSL 0 |

Retrieval is doing the real work: **274 of 302** active confirmed occurrences
have `origin='retrieval'`, 24 are imported Hit-train seed annotations (§24),
and 4 are surviving Luna annotations. Six Luna proposals have an `accepted`
status, but two no longer have active annotations. The dashboard reports 43
human-decision batches / 302 occurrences; these include three import batches,
so its 7.0 confirmations per batch is not a pure manual-review rate.

`reroll` Family Mode alone shows **350 candidates, 156 reviewed, 194 still
pending**, grouped as:

- "re-roll a Hit roll of 1" — 50 occurrences / 41 contexts
- "you can re-roll the Hit roll" — 52 / 49
- "you can re-roll the Wound roll" — 92 / 49

The six proposed reroll leaf stamps each preview ~19 eligible and ~30–38
already-satisfied matches. These are snapshot counts, not additive yields:
bulk confirmations and overlapping stamps can reduce the eligible count before
approval. None is a composition stamp.

---

## 3. The diagnosis — your instinct, with the receipts

### 3.1 Default ordering is faction-then-alphabetical

`getAbilities` pages by `ORDER BY id`; `proposal.ts` loads
`ORDER BY faction_id, ability_id, id`. The pending landing screen therefore
opens on **adepta-sororitas "Acts of Faith" at 0% coverage**: the earlier
`abbess-sanctorum` record is already whole-reviewed and excluded. The first
12 pending cards are all sororitas; easy high-frequency groups are elsewhere
in Family Mode. This queue routes *past completed work*, but not *toward*
high-yield work.

### 3.2 Compose-upward is built ahead of the leaf-first plan

`active_stamps: 0`, `derived_occurrences: 0`, `drafts: 0`. All six proposed
stamps are `kind='leaf'`; `applyCompositionStamps` only matches approved
`kind='composition'` stamps. Approving leaf stamps propagates leaves but cannot
produce drafts or RELATION/COMPOSITION/DSL escalations on its own. The original
plan explicitly deferred relation automation and DSL assembly (§28, §33,
§34.10). The composition engine is premature infrastructure, not a failed
leaf-stage acceptance criterion.

### 3.3 No "next highest-value" routing

The frontier's no-fingerprint clusters have 2–6 occurrences; the large
fingerprint-bearing retrieval groups are excluded by its query and live in
Family Mode instead. Its low-coverage leg ties at roughly zero for most
abilities and falls back to ID order. Neither view ranks by marginal
propagation yield. §12 asks how much future human work each decision removes;
that must become a queue sort key, not just a dashboard measure.

### 3.4 Discovery curves measure the seed, not saturation

§13 wants a saturation curve ("first 100 → many families, next 500 → few").
The dashboard has the curve, but 302 confirmations cover only **5 of 10
families / 5 parameter schemas**. This is a seed-biased sample, not evidence
that the corpus vocabulary has converged. Retrieval already works on reroll,
leading-unit, and event; the five unexercised families still need evidence.

### 3.5 Luna is idling

In practice: 113 model proposals, 6 accepted (4 surviving active annotations),
96 pending, 11 unresolved, 0 corrected, and the flow is manual (download JSON
→ run externally → re-import). Retrieval supplies 274 active annotations,
but Luna has not been redirected to the novel and unresolved residue.

## 4. Gaps vs the plan

1. **No greedy work order.** The single largest miss. Everything is built to
   support §22's frontier queue, but the default view and the frontier view do
   not implement "lowest hanging fruit over and over" as a sort.
2. **Premature composition infrastructure, not a leaf-loop blocker.** No
   composition stamps exist. Its drafts and relation/DSL escalations cannot
   populate until a distinct composition-stamp authoring step; §28 deferred
   that step until leaf painting proves horizon reduction.
3. **No per-action propagation yield.** Horizon-reduction (§12) is a dashboard
   number, not a queue column. The user cannot see "this one click unlocks 50
   occurrences."
4. **Luna not re-routed to residue** (§23 handoff unimplemented).
5. **Surface-shape census empty** (§14): `shape_points: 0`; only 1 whole-review
   recorded, so no shape-saturation data exists.
6. **Gap taxonomy asymmetry**: LEAF_GAP has a table + UI; RELATION/COMPOSITION/
   DSL only exist as composition-emitted escalation codes, so they read as
   "zero" regardless of true demand.

---

## 5. What to keep, hard

- The provenance/undo/batch machinery (§24, §25, adversarial Q6/Q7/Q8/Q9 are
  answered in code, not prose).
- Source-native ↔ DSL separation (§20).
- Stamp safety: challenge-before-approve, human-seed for literal grants,
  corpus-wide preview hash, suspend/supersede with audit (§31 Q13/Q14).
- Determinism: versioned matcher/assembler, snapshot pagination, preview hashes.

---

## 6. Next steps for Round 5D

1. **Make the landing queue decision-ranked.** Start with pending retrieval
   groups ordered by current reviewable occurrences (402 pending across
   families), then proposed leaf stamps with their *recomputed* eligible
   matches, then repeated novel residue. Put low-coverage abilities last.
   Keep faction and alphabetical order as filters. Show an "unlocks N"
   count for the actual bounded action, not the group's corpus-wide total.

2. **Work the existing Family Mode backlog, reviewing contexts.** Its 20-item
   pages and explicit cross-context confirmation are safety constraints; a
   92-occurrence group is not one click. Recompute the queue after each batch,
   because a decision can change downstream eligibility. Resolve conflicts
   rather than accepting every matched surface automatically.

3. **Preview and approve useful leaf stamps.** The six proposed reroll stamps
   are candidates for deterministic propagation, not composition triggers.
   Recheck each preview after bulk review; overlapping confirmations can
   shrink its marginal yield. A leaf stamp only derives source-native leaves.

4. **Broaden deliberately.** Inspect why the seven confirmed `roll-modifier`
   seeds have no retrieval candidates: `proposeLexical` already runs at server
   startup and matches exact normalized surfaces, so another blind run is not
   a strategy. Seed other unexercised families from complete source and
   measure their propagation before claiming saturation.

5. **Point Luna at residue.** Prepare bounded requests for unresolved and
   novel regions once the existing pending proposals are cleared; keep
   human confirmation authoritative. Track accepted *active* annotations,
   not merely accepted proposal statuses.

6. **Gate upward composition on measured leaf progress.** Surface each
   ability's known leaves, reviewed connectives, and unresolved regions now.
   Author composition stamps only after repeated complete source shapes and
   enough leaf coverage justify them; then separately verify drafts and
   publish. Do not expect leaf-stamp approval to generate DSL.

## Verification performed

- Ran `round5-review:dev` against a read-only copy of `workbench.sqlite`
  (`ROUND5C_DB=/tmp/round5d-review.sqlite`) on port 4337; confirmed the default
  view is 12 alphabetical sororitas abilities at 0% coverage.
- Called `getDashboard` and `getFrontier` directly; numbers above are from that
  run.
- Called `previewStamp` for all 6 proposed stamps; each shows ~19 eligible +
  ~30–38 already-satisfied matches.
- Opened `reroll` Family Mode; measured 350 candidates / 156 reviewed, with
  50/52/92-occurrence groups.
- No source, data, or workbench state was modified.

## 7. Performance audit: stamp examples and approval

**The five-second wait is matcher CPU, not SQLite I/O.** Two disposable
database snapshots show why the delay grows as stamps are approved:

| Snapshot | First preview | Next 20 examples | Approval after preview |
|---|---:|---:|---:|
| Six proposed, none approved | 4.75 s | 4.89 s | 9.52 s |
| Four proposed, two approved | 15.20 s | 15.33 s | 31.60 s |

The earlier snapshot's repeated second page took 4.88 s, with the same
`preview_hash` as page one; opening and initializing SQLite took 6.5 ms
in that run. DeepSeek's later audit independently measured a 0.7–0.8 ms
connection open, stable page hashes across all six stamps, and 57 matches
for the sampled proposed stamp (19 eligible, 38 already satisfied).
These are individual diagnostic runs on copies, not a p95 measurement;
the two snapshots have different approved-stamp sets. The original
database was not modified by this audit.

**Attribution.** In the later snapshot, instrumented `previewStamp`
spent 15,114 ms of 15,196 ms (99.5%) in
`evaluateVariant` → `matchFragmentPattern`. Fetching 6,212 abilities
cost 53.5 ms; classifying candidates cost 4.4 ms; hashing the preview
cost 0.5 ms. SQLite uses `abilities_current_lookup` for the source
scan, with a temporary B-tree for `ORDER BY id`; that sort is not the
multi-second bottleneck. A separate sampled CPU profile of the earlier
snapshot put 3.71 s of 5.05 s (73% of samples) in
`normalizedProjection` and `normalizedPatternLiteral`.

`matchFragmentPattern` projects each source fragment and visits every
candidate character position (`matching.ts:411-455`).
`segmentMatches` re-normalizes the *same literal* on each attempted
position (`matching.ts:383-387`), and guard/enum matching can do the
same (`matching.ts:371-380,399-407`).
`normalizedPatternLiteral` itself calls the grapheme/byte-offset
projector (`matching.ts:30-73`). DeepSeek counted 926,858 literal
re-normalizations per stamp row on this corpus. A disposable
matcher-only prototype returned identical matches while reducing a
three-stamp scan from 13.83 s to 645 ms by memoizing literals alone;
memoizing source projections as well reduced it to 170 ms. That
prototype used about 22.5 MiB more retained heap. These are
matcher-scan timings, **not** measured end-to-end UI latencies after a
code change; no production matcher was changed.

`Next examples` sends one new preview request
(`WorkbenchApp.tsx:847-856,1699-1703`). `previewCandidates` scans all
current abilities against every approved leaf stamp and the selected
stamp (`stamps.ts:383-441,570-575`). `previewStamp` classifies every
match and hashes **all** occurrences before applying the 20-example
cursor slice (`stamps.ts:645-713`). The cursor does not constrain
matching. With two stamps approved, even a proposed stamp's next
page traverses three stamp rows. The synchronous work also occupies
the local Vite request thread (`vite.config.ts:185-207,292-305`).

Approval deliberately costs approximately two such scans:
`approveStamp` recomputes the corpus-wide preview **inside its
transaction** to reject a stale hash, then changes the approved and
superseded revisions and applies the resulting approved set
(`stamps.ts:1053-1102,1115-1150`). DeepSeek measured 15.72 s for
the hash gate, 15.70 s for the apply pass (15.67 s of that in the
matcher), and 177 ms for composition application on the later copy.
The UI starts one more preview after approval to display the new
state (`WorkbenchApp.tsx:686-697,961-978`); that is an additional
asynchronous wait for refreshed examples. Composition application
queries active leaves once for each of 6,212 abilities and builds a
validator even when zero composition stamps are approved
(`assembly.ts:520-539`); this is secondary but avoidable.

**Fix in this order:**

1. Hoist normalized literals, guards, and enum spellings out of the
   per-position matcher loop. This pure computation has no invalidation
   problem. Preserve NFKC, whitespace, boundaries, grapheme mapping,
   and exact byte spans. Share source projections across variants only
   through a bounded, matcher-private cache or scan-local context; a
   global cache of the exported mutable projection would add aliasing
   and unbounded heap risks. Verify the full `preview_hash`, totals,
   examples, and match counts remain byte-identical before treating
   the prototype's speedup as real.
2. If page turns remain slow after matcher repair, hold a versioned
   complete preview snapshot for page navigation. The snapshot must
   still contain all occurrences, totals, conflicts, and the
   corpus-wide hash. Invalidate it for changes in source versions,
   stamps, evidence, human annotations, audit decisions, challenges,
   and dependent drafts; audit every writer before relying solely on
   `workbench_state.revision`. Approval still recomputes authoritative
   state within its transaction. A page-local scan or hash would break
   that safety contract.
3. Query approved composition stamps *before* the per-ability
   active-leaf prewarm and schema/validator construction. When none
   exist, skip that work but retain the cleanup of any surviving
   active/blocked composition applications and drafts
   (`assembly.ts:615-630`). The `abilities(current, id)` index could
   remove the temporary sort, but saves milliseconds, not seconds.

Do **not** reuse the pre-write preview's candidate array for approval
application. The preview filters to the selected revision; application
must reconsider *all* approved rows after supersession, including
overlap and human-authority conflicts. Benchmark page one, next page,
repeat page, and approval with zero, two, and more approved stamps
on fresh disposable copies; compare each page's rows and the complete
hash against the unoptimized implementation. Change source or a
decision between preview and approval and confirm a stale-hash
rejection. Run the same transaction and conflict cases after any
optimization. No source, data, or original workbench DB was changed
for this audit.
