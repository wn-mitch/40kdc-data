# Mechanic-family authoring driven by expert review

## Recommendation

Use mechanic families as the unit of comparison and correction, but component occurrences as the unit of membership and evidence.

The smallest useful experiment is a source-grounded comparison table with subset selection and inspectable batch patches. It does not need a new authoring framework, a corpus-wide formalization pass, or a general-purpose editor.

The repositories already contain substantially more reusable infrastructure than the initial proposal assumes. The main missing capability is:

> An expert identifies a distinction, selects its intended members, and gets a source-bound proposal showing exactly what changes, what stays unchanged, and what remains unresolved.

The read-only probes support this direction. They do not yet demonstrate human throughput or safe correction propagation. No implementation or corpus edits were performed.

## Assessment of the abstraction

Family-level review is the right scaling move when it amortizes a semantic judgment without amortizing away member-specific evidence.

It helps with:

- Repeated beneficiary mistakes: bearer versus unit versus selected model.
- Repeated weapon restrictions.
- Parameter differences within a known effect.
- Recurring timing, duration, and usage patterns.
- Equivalent mechanics encoded inconsistently.
- A shared renderer defect affecting otherwise correct representations.

It breaks down when “same effect” becomes “same complete rule.” The difficult distinctions often live outside the effect leaf: selection binding, optional activation, historical eligibility, mutually exclusive choices, or consequences conditional on an action actually happening.

### Current corpus evidence

The current source and DSL loaders report:

| Loader result | Records |
|---|---:|
| Raw-source records | 6,123 |
| DSL records | 3,920 |
| Paired faction/ability keys | 3,307 |
| Raw-only keys | 2,816 |
| DSL-only keys | 613 |

These are loader-level identities, not a count of missing active-game abilities. Raw-only records require edition, provenance, active-roster, and identity reconciliation before authoring.

A lexical Sustained Hits sweep found:

- 250 source records across 36 factions.
- 111 paired with DSL; 139 raw-only.
- Paired entries distributed across direct grants, conditionals, choices, sequences, designations, stances, dice gates, and other structures.

That is strong evidence against a flat, one-family-per-ability model.

The cached embedding probe exposed the retrieval boundary:

| Seed | Sustained Hits mentions among nearest 25 other records |
|---|---:|
| `adepta-sororitas/ministorum-sermon` | 24 |
| `grey-knights/channelled-force` | 1 |

Their mutual cosine was 0.4233. Both contain Sustained Hits, but Channelled Force’s test, selection, faction, and weapon context dominate whole-prose similarity.

**Conclusion:** whole-prose similarity finds useful neighborhoods. It cannot be the sole discovery channel for component families.

### Keep five judgments separate

| Judgment | What acceptance establishes |
|---|---|
| Component membership | This source contains this mechanic under the recorded context. |
| Template validity | This fixed pattern preserves the shared mechanic within stated boundaries. |
| Parameter correctness | This member’s extracted values and bindings match its source. |
| Whole-ability fidelity | All required clauses and their composition are represented. |
| Runtime support | A named runtime/version can execute the relevant representation correctly. |

A family can make useful progress at the first three levels without completing the last two. The interface should show those states separately, not compress them into “verified.”

## Existing versus missing pieces

### Reusable implementation

| Area | Actual implementation | Reuse and limitation |
|---|---|---|
| Source loading and coverage | `../40kdc-embeddings/src/wh40kdc_embeddings/store.py`: `load_store_entries`, `build_text`; `corpus.py`: `build_corpus_index` | Already joins the union of raw and DSL keys, retaining raw-only and DSL-only records. Use this universe, not scored pairs. |
| Embedding cache | `embed.py`: `_key`, `embed_texts` | Content-and-model-name cache; 6,122 of 6,123 current source texts were cached. No new embedding service needed. |
| Exact similarity | `cluster.py`: `similarity_matrix` | Existing NumPy implementation. A full float32 matrix for the observed raw corpus is about 143 MiB; seed-to-corpus queries need less. |
| Overlapping retrieval | `audit.py`: `_candidate_evidence` | Already combines normalized-exact prose, same IDs, target/timing/topology buckets, reciprocal top-25 whole-prose neighbors, and structured-field neighbors. Connected components are explicitly not labels here. |
| Seed expansion | `broadcast.py`: `build_broadcast_report` | Already unions exemplar evidence with an independent lexical sweep and paginates candidates. Closest starting point, although its interface assumes a completed shape. |
| Structural fingerprints | `dsl.py`: `condition_fingerprint`, `effect_fingerprint`, `ability_fingerprint` | Useful weak supervision, not semantic equivalence. |
| Roundtrip and divergence | `roundtrip.py`, `divergence.py`, `candidates.py` | Useful prioritization. Candidate-family and divergence calculations still operate on paired source/render records. |
| Evaluation machinery | `evaluation.py` | Has frozen manifests, family-aware holdouts, human verdicts, prediction comparison, and family-level resampling. Its initial expected signatures come from existing DSL and need source review for this experiment. |
| Source provenance | `tools/src/source-digest.ts`; `ability.schema.json.source_digest` | Reuse for semantic source drift. It is normalized content identity, not release history or an exact source-span identity. |
| Claims and bindings | `.omp/skills/dsl-campaign/graph/claims.js` | Origins, UTF-8 source spans, structured paths, decisions, completeness, extraction identity, and invalidation already exist. |
| DSL decomposition | `graph/mechanic-claim-import.js`: `mapAbilityDslToCandidates` | Produces structural evidence with composition relationships and unresolved gaps. Importantly, the returned completeness is explicitly `incomplete`. |
| Certified reuse | `graph/retrieval.js`: `retrieveEvidence`, `chooseConstructionPlan` | Separates discovery from current certified evidence and tracks covered/unmatched occurrences. It is not a ready-made lightweight review interface. |
| Candidate construction and gates | `tools/src/author-batch.ts`: `assembleEffect`, `buildRepairedEntry`, `lintCanonical`, `passesGate` | Deterministic construction and validation primitives exist. The flat constructor is too narrow for arbitrary composite families. |
| Explorer comparison | `examples/data-explorer/src/lib/roundtrip.svelte` | Already displays source, actual DSL, and description together, with expand/collapse and review exports. |
| Explorer divergence | `divergence.svelte`, `divergence-store.ts` | Pair and cluster inspection exists. It does not provide scoped family correction transactions. |

### The Rig registry

The current checkout has retained Rig build artifacts but no tracked Rig source under `tooling/dsl-campaign-rig`.

The actual implementation is available through the `wnmitch/mechanic-registry` revision `9b3881228235`, including:

- `crates/campaign-domain/src/registry.rs`
- `crates/campaign-engine/src/registry.rs`
- `crates/campaign-engine/src/promotion.rs`

It already defines:

- `MechanicCluster`, `MechanicTemplate`, and `StructuralSignature`.
- Verified, provisional, suspect, and unpaired member sets.
- Exclusions and rejected equivalences.
- Registry revisions and verification provenance.
- Fast, review, and novelty routing.
- Template parameterization and instantiation.

It is not yet the proposed source-first component workflow:

1. Registry seeding starts from the authored corpus.
2. `SeedMember` carries one `cluster_id`.
3. `instantiate_retrieved_template` obtains variable values from the member’s existing normalized DSL, not newly validated source extraction.
4. `TrustedProvisional` can be established partly through similarity scores and can contribute to fast-lane eligibility.
5. Parameterization largely exposes scalar JSON types, not reviewed semantic constraints on every slot.

Those are useful implementation precedents, not authority for a corrected value or family boundary.

The private Rig trial report records zero successfully applied-and-mechanically-verified ability changes in that trial. Its later registry proposal is therefore not evidence of demonstrated throughput. The branch implementation is newer evidence that registry machinery exists, but not proof that this human correction loop works.

### Concrete deficiencies in existing signals

- Fingerprints erase important distinctions. A bearer-only Sustained Hits grant and a unit-wide Lethal Hits grant both produced `keyword-grant{keywords}` in the probe.
- Threshold clustering chains through bridges. A synthetic three-vector probe at threshold 0.85 produced one component whose least-similar pair was 0.5.
- Clause scores are not clause proof. `roundtrip.py` averages best clause cosine matches after punctuation-based splitting. This does not establish pronoun bindings, ordering, or complete representation.
- Explorer review state is too weak for application. `notes.svelte.ts` keys notes by bare ability ID and fingerprints the description, not exact source and AST.
- The legacy apply path is not a stale-safe batch transaction. `author-batch.ts::applyFaction` checks proposal eligibility and replacement mode, then overwrites mechanics. It does not compare the current source/base representation against the exact inputs reviewed.

### Conflicting and stale contracts

These need explicit reconciliation before implementing the experiment’s authoring path:

1. **Fidelity versus strongest-case approximation.** The installed Author Ability skill permits strongest-case effects and omitted conditions. Current `VERIFY_SYSTEM` requires every stated mechanic, restriction, timing, and scope detail; the campaign also rejects flattening.
2. **Deterministic-only authoring versus full-tree generation.** The skill says models never author trees; the implemented repair path explicitly asks for a complete nested tree.
3. **Automatic application versus human subset acceptance.** Existing unattended proposal gates are not the authorization requested here.
4. **Verification policy.** The older skill defers cross-language checks to CI and contains three-port language; repository policy requires the four-language preflight and independent golden reproduction.
5. **Source handling.** The older skill recommends linear PDF extraction and permits private in-repository prose; current repository guidance requires coordinate extraction, while the campaign has a stricter no-prose-in-repository contract.
6. **Reuse eligibility.** Rig’s score-supported provisional fast lane is weaker than the proposed source-grounded correction authorization.

For this design, the recommended contract is clause-faithful representation, explicit partial progress, and human acceptance of exact proposed patches. That is a deliberate policy choice, not an assertion that all current entrypoints already agree.

### Recent Sisters and Grey Knights work

Grey Knights provides useful boundary cases:

- `channelled-force`: actual Leadership test, then a choice, restricted to Psychic melee weapons.
- `attuned-onslaught-psychic`: eligible member models, not attached-unit keyword union.
- `personal-teleporters`: the charge prohibition follows only an actually performed move.
- `prescient-redeployment`: historical capacity and candidate eligibility in the same prior window.
- `warrior-strategist`: cost reduction before payment, not a refund.

See `docs/grey-knights-dsl-fidelity-2026-09-04.md` and `tools/test/grey-knights-fidelity.test.ts`. The documentation also explicitly distinguishes representation from a complete battlefield simulator.

The Sisters private review contains 52 rendered entries and disposition ledgers, but saved review results differ from this checkout’s data:

- Saved `ministorum-sermon` describes the Priest-presence and melee restrictions; current DSL is an unrestricted unit keyword grant.
- Saved `divine-deliverance` describes bearer-only melee effects and activation/usage; current DSL retains materially broader and incomplete mechanics.

Do not diagnose that automatically as a regression or failed review. It establishes that candidate/review artifacts and current applied state must be shown separately.

## Recommended family model and retrieval method

### Model: overlapping component families with explicit context

Start with three levels, without building a hierarchy editor:

1. **Effect family:** “grant Sustained Hits.”
2. **Parameterized subtree:** a specific supported grant structure with typed slots.
3. **Wrapper/template variant:** activation, conditions, duration, and composition around that subtree.

Whole-ability templates are a special case when the complete structure genuinely matches.

Each occurrence retains:

- Faction-qualified ability identity and source revision.
- Source span or spans.
- Candidate AST path, if a representation exists.
- Enclosing selectors, conditions, triggers, usage, and duration.
- Branch position and binding dependencies.
- Additional clauses outside the component.

For Channelled Force, the Sustained Hits occurrence remains inside the successful-test branch and one option of a choice. Membership must never imply that it grants both options or that its activation matches Ministorum Sermon.

Unknown context stays unknown. Do not infer `none` because a condition or usage limit is absent from existing DSL.

### Normalize for comparison, not automatic rewriting

Maintain two different representations:

- **Discovery fingerprint:** deliberately coarse, used to retrieve and group disagreements.
- **Patch precondition:** exact base AST identity plus the relevant enclosing context.

Normalize object-key order and reviewed lexical aliases. Preserve sequence order, branch identity, binding references, and dependencies. Do not reuse a generic “sort every array” normalizer as a semantic equivalence test; `graph/retrieval.js::normalizeValue` currently does that.

Typed slots should have domain constraints, not merely `string` or `number`. For example, keyword magnitude must distinguish a fixed integer from a dice expression where supported.

A family with arbitrary condition trees and arbitrary effect remainders is not a useful template. Keep those as context or explicit exceptions until a recurring wrapper earns its own constrained pattern.

### Retrieval baseline

Use a seeded union of existing retrieval channels:

- Exact normalized source matches.
- Top-25 whole-source cosine neighbors.
- Independent lexical mechanic sweep.
- Existing structured-field neighbors.
- DSL component fingerprints and encoding disagreements.

Keep the channel labels visible. Same-ID matches and DSL similarity are hints, not preferred truth.

Do not require reciprocal membership for inclusion. Reciprocal kNN is useful supporting evidence but can omit asymmetric or composite members.

For the experiment, compare:

| Method | Purpose |
|---|---|
| Seeded union | Recommended baseline and likely MVP. |
| Existing mutual-kNN | Compare precision and lost boundary members. |
| Existing threshold components | Measure chaining and irrelevant growth. |
| Complete-linkage hierarchical grouping on the bounded candidate pool | Test whether tighter groups reduce human comparison work without hiding variants. |

Defer Leiden and HDBSCAN. Neither is needed to answer whether the correction interaction works.

A composite member may occur in multiple review sets. Its presence must not merge those sets transitively.

### Avoid reinforcing historical mistakes

- Run discovery over raw-source rows regardless of DSL availability or score.
- Extract parameters from source before presenting current DSL as an answer.
- Include raw-only, opaque, and inconsistent encodings in the review sample.
- Audit some apparently uniform, high-scoring members.
- Retain counterexamples and rejected neighbors.
- Never treat low fingerprint entropy as correctness.
- Resolve source conflicts before declaring an encoding wrong.

## Human correction loop

The primary screen should be a difference table with persistent selection, not a list of ability editors.

Show shared structure once. Rows emphasize differing dimensions:

`beneficiary | weapons | condition | activation | duration | usage | composition | remainder`

Every value is labelled as source-extracted, currently encoded, agreed, or uncertain. A field value such as “bearer” is selectable across rows.

Source, description, and AST remain accessible inline. Opening them, changing selection, excluding a member, and comparing existing differences use local state and cached evidence, not model calls.

### Turn “that’s wrong” into a transaction

1. **Freeze the selection.** Record explicit occurrence IDs, source revisions, and base AST hashes. A filter explains the selection but does not remain a live propagation rule.
2. **Classify the feedback.** Known correction or model-interpreted proposal.
3. **Construct a scoped transformation.** Identify the exact component and enclosing context it can safely modify.
4. **Evaluate every selected member.** Produce changed, already-correct, incompatible, stale, and uncertain sets.
5. **Show consequences.** Per-member semantic diff, actual AST diff, changed source bindings, and unresolved clauses.
6. **Accept an explicit subset.** Acceptance binds the exact candidate hashes. Later neighbors are not included.
7. **Apply through ordinary gates.** Recheck source/base identities, validate, persist the decision, and retain remaining work.

The preview must also identify selected members it could not change and neighbors deliberately left untouched.

### Feedback routing

| Feedback | Result |
|---|---|
| “Bearer only.” | Correct the selected component’s beneficiary within its binding context. Do not globally replace every `unit` target or change unrelated effects. |
| “After shooting, not phase end.” | Propose a trigger correction for supported variants; show subject, window, and dependent hit-selection consequences. |
| “Choose one; not both.” | Propose a composition change only where the source establishes the same choice boundary. Nested or dependent cases become exceptions. |
| “Same effect, different activation.” | Keep component membership; split activation/template variants. No AST change implied. |
| “This does not belong.” | Reject that occurrence’s membership for this family revision. |
| “Description is wrong.” | Route to renderer review; leave DSL unchanged unless separately shown wrong. |
| “That is the old rule.” | Block against the conflicting source snapshot; resolve source authority first. |
| “The schema cannot say this.” | Preserve the resistant clause and escalate a concrete schema gap. |

Free text or dictation should produce the same structured preview as a known correction. The interpretation is a proposal, never an instruction to silently apply.

On a phone, retain the same unit of work: compact variant rows, inline source expansion, and a persistent selection/action area. Do not turn the desktop table into dozens of separate editing screens.

## AI and Rig responsibilities

| Work | Recommended path |
|---|---|
| Retrieve and compare existing evidence | Deterministic/local. |
| Known exact source pattern | Deterministic extraction only where its matching boundary is genuinely established. |
| Known-family member | Constrained source-first extraction, typed validation, deterministic constructor. |
| Ambiguous parameter or dependency | Focused review of that member and disputed binding. |
| Family/template boundary | Stronger review of distinct variants, exclusions, and counterexamples. |
| Genuine schema resistance | Existing Rig/shape-scout workflow. |
| Shared template, schema, or renderer change | Affected-member regression analysis and normal release gates. |

The extraction contract should return:

- Membership: `MATCH`, `NOT_FAMILY`, or `UNCERTAIN`.
- Typed parameters with source anchors.
- Enclosing control and binding context.
- `extra_clauses` and unresolved dependencies.
- An explicit completeness assessment.

`EXTRA_CLAUSES` should not exclude a legitimate component occurrence. It prevents the component’s acceptance from becoming whole-ability acceptance.

Every accepted member still needs evidence for its own values, target, weapon restrictions, conditions, timing, duration, usage, and placement. Representative review establishes the constructor’s boundaries; it does not prove that every extraction is correct.

Start with small batches grouped by structural complexity. Increase batch size only if measured qualifier omissions, cross-member contamination, and rework remain acceptable.

Cache:

- Source extraction against exact source/context and extractor contract.
- Construction against extracted parameters, template revision, and constructor version.
- Description against candidate and renderer version.
- Review against source, base, candidate, and review-policy identities.

Do not replay WHO/WHEN/WHAT and full assembly merely because another member shares a known pattern.

## Minimal durable structures and invalidation

Reuse existing graph identities and evidence vocabulary. Do not introduce a second graph or require full source formalization before discovery.

The experiment needs three artifact kinds:

| Artifact | Minimum contents |
|---|---|
| Family review manifest | Stable family ID, revision, component level, fixed pattern, typed slots, requirements, prohibited variation, examples and counterexamples. |
| Occurrence review record | Faction/ability/source identity, source bindings, AST path/context, proposed or accepted membership, extracted parameters, unresolved remainder. |
| Correction transaction | Explicit selected set, feedback category, source/base/template dependencies, proposed per-member patches, accepted subset, checks, and outcomes. |

Use existing claim origins, source spans, structured paths, decision references, and completeness where they fit. A thin review record can reference those objects without acquiring whole-representation authority.

Retain both:

- The existing normalized `source_digest`, useful for semantic drift.
- An exact source snapshot hash and locator, necessary for byte-bound source anchors and stale application checks.

### Invalidation rules

| Changed input | Required consequence |
|---|---|
| Source snapshot | Invalidate affected bindings, extraction, and correction acceptance; re-review those members. |
| Base DSL | Refuse the old patch. Regenerate a preview; never silently rebase an accepted change. |
| Family boundary | Recheck membership and dependent proposals for that revision. |
| Template constructor | Reconstruct dependent members from still-current parameters and rerun checks. Source extraction can remain reusable. |
| Describer | Refresh descriptions and renderer-dependent assessments. Do not automatically discard source membership. |
| Embedding model | Refresh discovery ordering. Accepted source-grounded decisions remain valid. |
| Runtime adapter | Recheck runtime-support claims for that adapter, not family membership. |

Start conservatively by rechecking all members referencing the changed template revision. Dependency-aware slot-level optimization can wait.

Raw prose stays in the sibling store and existing private or ephemeral source paths. Publishable data contains structured mechanics and approved provenance fields. Family review exports containing source text must never enter package bundles or public report assets.

The MVP should not publish an incomplete new ability as complete. Partial component work can be retained privately; a scoped correction to an existing entry must preserve and expose unresolved remainder rather than overwrite it.

## First experiment

### Corpus selection

Use 72 distinct, source-reviewed records, selected after retrieval. These are proposed sample sizes, not measured family sizes:

| Stratum | Records | Required variation |
|---|---:|---|
| Sustained Hits component family | 36 | Direct and conditional grants, weapon filters, bearer/unit differences, choices, raw-only entries, and negative neighbors. |
| Characteristic-modifier family | 24 | Bearer/unit scope, melee restrictions, values, multiple effects, activation and usage. |
| Post-shooting effects | 12 | Movement versus designation, bound attack sequence, optional action consequences, phase-end counterexamples. |

Grounding seeds include:

- `ministorum-sermon`
- `channelled-force`
- `might-of-titan-psychic`
- `divine-deliverance`
- `personal-teleporters`
- `righteous-persecution`
- `guidance-of-the-ancients-psychic`

Their source revisions must be reviewed first. An older source can support an explicitly historical evaluation case; it must not silently become current-game authority.

Include a consistently wrong subgroup, not just isolated anomalies. Keep some additional clauses correct and unchanged so the experiment can detect destructive repairs.

### Experimental outputs

Generate only:

1. Frozen source/corpus manifest.
2. Retrieval comparison table.
3. Family difference table with source/AST/description access.
4. Correction decisions and per-member patch previews.
5. Independent audit and efficiency report.

A simple local HTML report with selection controls is sufficient. No persistent server, polished application shell, or new graph schema is required to test the interaction.

### Procedure

#### A. Establish expected outcomes

Review source-grounded outcomes before evaluating candidate corrections. Record membership, parameter values, composition, must-change fields, must-not-change fields, and legitimate unresolved work.

Do not adopt existing DSL or the high-cosine holdout as gold without review. Reuse the evaluation manifest machinery, but not its existing DSL-derived expectations uncritically.

#### B. Run a batch-leverage exercise

Use 24 grant records and 12 modifier records. Ensure the grant subset contains enough eligible occurrences to test one correction across at least 20 members, with explicit exceptions.

Introduce deliberate mutations only into isolated shadow candidates:

- Wrong beneficiary.
- Missing weapon restriction.
- Choice changed to simultaneous effects.
- Wrong activation window.
- Dropped usage.
- Unconditional follow-up after an optional action.

Keep the mutation ledger hidden from the reviewer.

#### C. Run a matched workflow comparison

Split the remaining 36 records into matched 18-record arms, with six records from each stratum per arm:

- Current per-ability author/review workflow.
- Family comparison and scoped correction.

Match complexity and source quality. Keep exact duplicates together and counterbalance order to limit learning effects.

Use the workflow actually employed for recent productive Astra passes as the practical baseline, with recorded calls and prompts. Do not manufacture a slow baseline by requiring the full Rig for every ordinary ability.

#### D. Independently audit every changed member and designated negative control

The audit must inspect complete source and candidate AST, not just descriptions or template examples.

### Measurements

Record separately:

- Time to understand the proposed family.
- Time to find a known mismatch.
- Time to express the correction.
- Time to inspect consequences.
- Correctly changed occurrences per decision.
- Unnecessary or incorrect propagation.
- Missed qualifiers and residual errors.
- Explicit unresolved work.
- Model calls and input/output tokens.
- Audit-driven rework.
- Template setup cost versus marginal correction cost.

Report both component corrections and fully faithful abilities. Do not count several corrected components in one ability as several completed abilities.

### Stop/go criteria

Stop and repair the design if:

- A stale proposal can apply.
- A negative control changes outside the accepted scope.
- A correction drops an unrelated clause.
- Family acceptance silently upgrades fidelity/runtime status.
- Apparent efficiency comes from suppressing unresolved work.

Proceed to MVP only if:

- At least one scoped decision correctly affects 20 or more members.
- Final accepted output has no false propagation or newly introduced semantic errors under the independent audit.
- Residual errors are no worse than the matched baseline.
- Audited correction throughput reaches approximately 2× per human minute and model tokens per correct correction are at most half the baseline.
- Setup and audit costs are reported rather than hidden in the marginal result.

These are adoption targets, not claimed results. A single expert, selected families, prior familiarity with Sisters/Grey Knights, and a bounded audit cannot establish corpus-wide error rates.

## Staged implementation and hard MVP cutoff

### Stage 1: prove the interaction

Build the bounded report-and-patch experiment above. Reuse embeddings, corpus joins, source loaders, descriptions, and validation. Apply only to shadow candidates.

Do not first import or certify the entire corpus.

### Stage 2: minimal production review surface

Only after the experiment passes:

- One family-comparison route in Data Explorer.
- Overlapping component membership and visible template variants.
- Local selection by differing field.
- Inline complete source, description, and AST.
- A small catalogue of supported corrections.
- Free-text feedback producing the same inspectable proposal format.
- Durable, private resume state.
- Source/base-bound candidate patches.
- Explicit subset acceptance.
- A CLI application path with stale refusal and ordinary publication gates.

Adapt existing claim/decision infrastructure narrowly. Treat the Rig registry branch as reusable code and design evidence, not a prerequisite merge of the entire framework.

**The MVP ends here.**

### Explicitly defer

- Universal AST or JSON Schema forms.
- Arbitrary transformation languages.
- Corpus-wide clause extraction.
- Learned ontologies and automatic family merging.
- ANN services or vector databases.
- Graph visualization as the authoring surface.
- Automatic propagation to future neighbors.
- A second evidence graph or generic agent framework.
- Automatic schema generation or publication.
- A full runtime simulator.
- Sophisticated clustering unless the experiment shows it materially improves review throughput.

The intended product is not a faster way to edit each ability. It is a way to make one precise judgment, inspect its complete consequences, and safely reuse it across an explicit set.

## Next decision

Do not authorize implementation or the 72-record experiment. Run the [read-only component-evidence experiment](#read-only-experiment-independently-reviewed-component-evidence) first. It compares reviewed occurrences against both fresh narrow analysis and reuse of Rig's existing intermediates. Proceed only if independent semantic review, contextual safety, held-out decision value, and measured savings all pass.

## Read-only experiment: independently reviewed component evidence

### Verdict

**Narrower than the original proposal, and not yet a demonstrated capability gain.** Rig already retains source evidence, architecture, decomposition, rejected proposals, and honest `NeedsSchema` results. The current claim graph already supports accepted occurrences inside incomplete claim sets. Neither persistence nor decomposition is new.

The unproven difference is whether independently reviewed occurrences become useful precedents **before whole-ability convergence**, and whether using them costs less than reopening Rig's retained intermediates. No implementation is justified until that comparison succeeds.

### Exact comparison with Rig and the current graph

Historical implementation references below are under `tooling/dsl-campaign-rig/` at `wnmitch/mechanic-registry` (`9b3881228235`). The live authoring trial precedes that registry implementation; its failures do not test the later registry.

| Boundary | Existing behavior | Experimental distinction |
|---|---|---|
| Durability | `campaign-engine/src/node_executor.rs` retains CAS evidence and role artifacts. Read-only evidence reuse checks source, DSL, validator, prompt, and role-schema identities. Honest `NeedsSchema` output is retained. | None. Compare against reuse of those artifacts, not an empty cache. |
| Decomposition | Architecture, WHO, WHEN, WHAT, local actions, clause coverage, and resisted-schema output exist. Internal-family local actions require a closed shared parent. | Independently review a context-bound occurrence without requiring the parent to have an accepted DSL representation. |
| Acceptance | `campaign-roles/src/semantic.rs` requires exact coverage of every mechanical clause for an accepted Arch-Magos result. `NeedsSchema` permits unresolved coverage. | Accept only the bounded semantic assertion; keep whole-ability completeness and representation obligations unresolved. |
| Registry promotion | `campaign-engine/src/promotion.rs::promote_campaign_learning` requires `CloseVerified` and promotes only `Converged` members. | Test evidence reuse before that boundary, without changing it. |
| Template parameters | `registry.rs::instantiate_retrieved_template` uses the member's existing normalized DSL. | Source review must establish every new occurrence's values and contextual bindings. A precedent does not certify them. |
| Current graph | `claims.js::projectClaimSet` permits accepted assertions alongside open residuals. `retrieval.js::queryClaims` exposes occurrences without requiring complete claim-set authorization. | Use these primitives, not another fragment model. |
| Certified authoring | `retrieval.js::authorizeClaimSet` requires completeness; `persistRetrieval` requires both retrieval and representation authorization. Discovery matches cannot cover source occurrences. | Leave these gates unchanged. Experimental evidence is not certified construction evidence. |

Two qualifications matter:

- `formalization.js::persistClaimExtraction` can create an accepting validator review from eligible source bindings. This validates evidence eligibility, not independent semantic interpretation. The experiment requires a separate source reviewer.
- `mechanic-claim-import.js` extracts authored-DSL leaves and parent assertions, but a leaf does not automatically inherit all parent context. Those imports are candidates, not primary-source truth. Do not turn an option-local leaf into an unconditional claim.

### Actual hard-case walkthroughs

The retained state is in `~/.local/state/40kdc-dsl-campaign/authoring-lap-v*/`. Laps v1–v4 use a different worklist; v5–v24 contain the five rules below. v24 was planned, not executed. The following observations use v23 events and their CAS artifacts, not inferred case classes from the postmortem. All five source texts match their current sibling-store entries.

| Case | Recorded attempt and blocker | Potential independent result; remaining obligation |
|---|---|---|
| `adeptus-mechanicus/noospheric-transference` | Architecture identifies a capped selected cohort, temporary keyword, and shared override choice. Evidence has only `C1`; local actions have empty clause lists. WHO and WHAT return no useful target/effect tree. Event 65 rejects the proposed shape for permitting zero selections, unbound internal-child reviews, and family evidence problems. | Review a model Toughness increase of 1 or Move increase of 2 **within its selected override and keyword cohort**. Retain selection minimum, battle-size cap, embarked eligibility, shared choice, and expiry as separate obligations. Re-segmentation is new work, not recovered acceptance. Its timing output also incorrectly narrows a Command-phase window to phase start; do not reuse that assertion. |
| `chaos-space-marines/experimental-augmentations` | Architecture retains six options, eligibility exclusions, deliberate/random selection, duplicate handling, and conditional rerolls. Its options also lack subclause bindings. Event 63 reports missing candidate evidence; event 70's refuters reject an undefined combined selection-mode token. | A selected melee-Attacks increase of 1 can be reviewed with the eligible-model filter and battle duration. The choice-versus-roll procedure, duplicate handling, and reroll condition remain separate. This is a strong comparison against reusable architecture: much of the interpretation already survives there. |
| `drukhari/combat-drugs` | Architecture identifies manual-use history and random reactivation; WHO/WHAT remain `NeedsSchema`, with no leaf tree. Events 53–54 reject the proposed shape as a singleton and mark the ability `NeedsSchema`. | Preserve selected, WYCH-CULT-scoped model/weapon modifiers. Do not erase the manual-use ledger or equate its random selection semantics with Experimental Augmentations. Singleton rejection is not evidence that each modifier is semantically doubtful. |
| `chaos-daemons/daemonic-allegiance` | Architecture separates army-inclusion choice, duration, and four keyword-to-named-wargear branches. Events 66–67 reject the shape as a singleton and mark `NeedsSchema`. | Review an option's keyword plus exact additional-weapon identity. “Grants a ranged weapon” is insufficient. Parent choice and branch pairing must remain attached. This may supply a useful negative boundary rather than a reusable transformation. |
| `chaos-space-marines/daemonic-allegiance` | Architecture retains the distinct model/weapon modifiers and persistent choice. The `branch-choice-state` review artifacts are instead labeled `chaos-daemons` and lack distinct child bindings; events 64 and 71 do not establish review of the intended branches. | Source-review each selected modifier with the correct faction, model, and named weapon. Never inherit the other faction's passing refutations. This exposes a provenance defect that partial evidence must prevent, not bypass. |

These are observed blockers and proposed useful outputs, not proof that useful reuse occurred. The trial report's zero applied-and-mechanically-verified outcomes remain whole-authoring results; producing read-only evidence must not be scored as resolving them.

### Frozen experiment

Use eight first-set abilities:

1. The five v23 rules above.
2. `aeldari/battle-focus`: genuine shared-resource/action-menu case.
3. `grey-knights/channelled-force`: test-gated, option-local Psychic-melee keyword grant.
4. `adepta-sororitas/ministorum-sermon`: Priest-presence-conditioned melee keyword grant.

Freeze these six second-set abilities before first-set review:

- `world-eaters/blessings-of-khorne`
- `adeptus-mechanicus/battle-protocols`
- `adeptus-mechanicus/doctrina-imperatives`
- `adeptus-custodes/martial-mastery`
- `grey-knights/attuned-onslaught-psychic`
- `grey-knights/warrior-strategist`

These provide shared modifiers and grants, changed scopes and durations, a persistent protocol, an attack-level versus weapon-level boundary, and a deliberately dissimilar cost-reduction control. Keep their actual source provenance: Battle Protocols and the two Grey Knights controls are marked 10e in the store. This tests interpretation of frozen evidence, not current matched-play validity.

The manifest pins faction-qualified IDs, canonical source byte hashes and provenance, DSL snapshots, schema/adapter hashes, Rig revision and available artifact IDs, reviewer contract, and decision rubric. Store private evidence outside the repository. No source refresh, family expansion, ontology changes, or replacement of difficult examples after review starts.

The captured Battle Focus text refers to a token-count table without including its values; the captured Blessings text omits the individual activation dice requirements. Treat these as `incomplete_source` for this evidence set. Existing DSL numbers cannot fill the source gap.

For each first-set ability:

1. Read the whole frozen source once to identify context and unexamined regions. Attempt source-bound occurrences, not a complete AST.
2. Bind each assertion to its leaf span **and every relevant contextual span**. Separate fixed pattern, occurrence parameters, and enclosing obligations.
3. An independent reviewer reads the source, assertion, and context. Accept, reject, or leave proposed; record a concrete boundary example and rationale. Disagreement remains explicit.
4. Retain all unexamined, ambiguous, unsupported, or contradictory material as residuals. Stop without solving a missing parent representation.
5. Freeze the first-set packet before any second-set work.

“Parent representation unsupported” is not the same as “parent meaning unknown.” A conditional effect can be accepted when its source meaning is clear even though the DSL cannot represent the parent. If the unknown parent changes who receives the effect or whether it happens, the effect claim remains proposed. A free-text caveat does not repair an unconditional proposition.

### Minimal artifact: existing primitives only

One private packet per ability, composed of:

- `claim-origin`/source snapshot: faction-qualified subject, provenance, byte identity.
- Extraction identity: adapter/ontology versions, extractor identity, ordered parent evidence, independence group.
- `semantic-claim`, `claim-occurrence`, `claim-assertion`: existing proposition, polarity, modality, identity, and lifecycle.
- `claim-evidence-binding`: exact UTF-8 source spans; authored-DSL paths are separate candidate provenance.
- `claim-review-decision`: independent reviewer, assertion binding, decision, rationale, policy identity.
- `unresolved-item`: existing kind, evidence/focus, affected candidates, blocking obligations, resolution state.
- `claim-set`: accepted and candidate occurrences, open residuals, `completeness.state = incomplete`, with retrieval/representation obligations explicitly checked.

Use existing mechanic arguments for actor, affected entity, parameters, condition, timing, duration, and scope. Where the existing proposition contract cannot faithfully preserve the context, record `ontology_gap`; do not invent a new predicate or fragment type to make the experiment pass.

Primitive membership can be shared without semantic equivalence. For example, Channelled Force, Ministorum Sermon, and a Blessings option involve Sustained Hits 1, but have different eligibility and activation conditions. Their source occurrences and contextual semantic identities must remain distinct.

No packet contains an accepted ability candidate, patch authorization, complete-coverage claim, or runtime certificate. Keep the existing complete-set gates intact. The projection's `complete` check only rejects residuals blocking the obligations actually checked; therefore neither an incomplete label nor a selectively checked certificate is sufficient consumer protection.

### Controlled second-set reuse

Use three arms with identical second-set sources, schema access, output requirements, and review standards:

| Arm | First-set material available |
|---|---|
| Fresh narrow analysis | None. It performs the same bounded evidence task, not the expensive full authoring pipeline. |
| Rig-intermediate reuse | All retained evidence, architecture, WHO/WHEN/WHAT, `NeedsSchema`, proposals, and review artifacts, including failed outputs with their status. Navigation or extraction costs count. |
| Reviewed-occurrence reuse | The frozen first-set occurrence packets, including residuals, rejected hypotheses, and boundary examples. |

For the added first-set abilities with no trial artifacts, prepare equivalent read-only Rig-format intermediate outputs under the pinned contract, or report that stratum separately. Never give the occurrence arm first-set information and call an empty Rig packet an equal baseline.

Use fresh model sessions with the same model/settings and independent, counterbalanced human reviewers. No reviewer sees another arm's answer to the same ability before submitting a decision. A separate adjudicator compares outputs blind to the arm.

Every second-set reviewer still reads its full source and verifies its own parameters and context. Precedents may avoid re-deriving an established pattern or exclusion; they may not import authority into new source occurrences. Freeze a reuse decision before adjudication: cited precedent, exact/substitution/rejected match, parameters checked, context differences, residuals, and the interpretation step actually avoided.

Each arm answers the same human questions: which bounded occurrences are supported, which apparent matches are unsafe, and which precise source/representation obligations remain. No arm assembles or validates a whole DSL ability. Thus savings cannot come merely from skipping Rig's application or full-fidelity gates.

Measure source-reading, extraction, precedent lookup, rechecking, review, correction, and adjudication separately; record model calls/tokens and human active-review time. Report both second-set marginal cost and first-plus-second-set total, including first-set packaging and independent review. Historical sunk artifacts get both a reuse-only view and a separately labeled historical-cost view where records permit it.

### Decision rules and failure criteria

Predeclare these as pilot thresholds, not measured outcomes:

1. **Independent acceptance:** at least two hard first-set abilities yield source-reviewed, context-complete occurrences while their whole claim sets remain incomplete.
2. **Useful distinction:** at least one positive pattern and one negative boundary survive independent adjudication. Trivial keyword recognition alone is insufficient.
3. **Safety:** zero accepted errors in actor, beneficiary, option binding, weapon scope, threshold, duration, exclusion, ordering, or source identity; zero promotion of partial evidence into full coverage or construction authority. Any such error fails the pilot.
4. **Second-set reuse:** useful reuse occurs in at least three of the six held-out abilities, with a recorded avoided reasoning step. At least one result changes a human decision: exclude an unsafe match, narrow a proposed correction's scope, or settle a disputed parameter from cited evidence.
5. **Efficiency:** the occurrence arm improves median second-set active-review time by at least 20% against Rig-intermediate reuse, without worse correctness, missing residuals, or an offsetting model-work increase. It must also beat fresh narrow analysis on that measure. Report totals: if first-set cost is not recovered across the two sets, do not claim amortization; implementation remains no-go on this pilot.

Also fail if identical primitive labels conceal different contexts; accepted leaves depend on unsettled parent meaning; rejected matches are generalized beyond their evidence; reviewers reopen essentially the same full interpretation; an ontology extension is required merely to record the experiment; or the advantage disappears once Rig's existing artifacts are available.

Six held-out abilities cannot establish corpus-wide efficiency. Success justifies the smallest local integration, not an authoring architecture or a corpus rollout.

### Recommendation and next implementation boundary

**Go for this read-only experiment. No-go for implementation now.** Existing infrastructure supports the experiment; independent semantic acceptance, useful second-set transfer, and net savings remain unmeasured.

Only after all five criteria pass, add the smallest missing read-only export/query in the existing claim tooling that returns selected occurrences together with their source identity, independent review evidence, parent context, and unresolved obligations. If the experiment uses existing queries directly, add nothing. Do not change schemas, Rig convergence, registry promotion, certified retrieval, patching, or runtime authority.

If the experiment fails, name the measured bottleneck:

- Same reasoning cost in every arm: contextual source interpretation dominates; serialization did not remove work.
- Rig artifacts perform equally well: retrieval/navigation of existing evidence is sufficient; no distinct semantic stage is justified.
- Most leaves cannot be accepted independently: the unresolved parent is genuinely part of their meaning.
- Source gaps or wrong bindings dominate: source completeness, segmentation, and provenance need attention.
- Partial review helps but complete authoring remains blocked: parent representation, reviewer input binding, family evidence, and execution reliability remain the authoring bottlenecks.

### Verification of this investigation

Read the historical Rig implementation, v23 event/CAS evidence, current source records, current authored DSL, and claim-graph paths above. Ran the existing `claims`, `claim-projection`, `claim-query`, `formalization`, and `retrieval` test files: **40 passed**. These establish primitive behavior and safety checks, not semantic truth or experimental reuse savings. No campaign, semantic-review experiment, production graph mutation, data change, or implementation was performed.
