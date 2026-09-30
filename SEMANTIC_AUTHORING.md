# Semantic authoring

This is the settled architecture for turning ability source text into trusted semantics and DSL.
Read it before proposing a change to how abilities are authored. The workbench code lives in
`tools/src/round5c/`; its CLI is `npm run round5c -- commands`.

## Objective

Build trusted source semantics for the whole corpus with the most semantic horizon removed per
human decision.

## Authoring flow

```
model-assisted segmentation (proposals only)
→ human-authorized leaves
→ scoped surface reuse
→ sideways propagation
→ independent leaves converge within a source record
→ deterministic compilation to DSL
```

1. A model may propose segmentation, a family, parameters, retrieval candidates, or a bounded
   structural alternative. A proposal is never trusted.
2. The human reviewer confirms, corrects, or rejects. A confirmed span becomes a **trusted leaf**:
   "this span of source expresses semantic family X with source-supported parameters Y".
3. A confirmed meaning can be decided as a **scoped surface**: a wording plus an occurrence-level
   scope (`leaf_surfaces.scope_json`, `surface-scope.ts`), mapped to one fingerprint. Applying it
   writes **derived** leaves wherever the wording occurs inside its scope, on every record.
4. Byte-identical records share decisions through `propagate --duplicate-texts`; each copy names
   the row it copies (`derived_from_annotation_id`).
5. When a record's source is fully accounted for by trusted leaves, structural decisions and
   connectives, it is **leaf-complete**. The deterministic compiler (`compile.ts`) lowers its
   leaves to canonical DSL and the gates check it. No model writes canonical DSL.

## Where work happens

One live workbench database (`_private/round5c/workbench.sqlite`) holds all source, proposals,
decisions and derived rows. All authoring runs through the `round5c` CLI: model stages
(`segment`, `classify`) and mechanical copies (`propagate`) may write to it directly after keeping
one rolling copy (`workbench.sqlite.pre-run`); human decisions arrive only through
`review-apply <decisions.json>`, written from the reviewer's answers in chat. There is no review UI.

## Authority

- Models propose; the human reviewer authorizes semantic truth.
- `authority_kind` is `human`, `derived` (a mechanical copy of a human decision: a human-founded
  surface's application, a duplicate-text copy, a version migration) or `machine`.
- Machine rows are a shadow layer: never trusted, never counted as coverage, and replaced when a
  human confirms the same meaning.
- Every derived row traces to its human decision: `derived_from_surface_id` → the surface's
  founding batch, or `derived_from_annotation_id` → the copied row. Undoing the source retracts
  what was derived from it.

## Durable primitives

SourceRecord, SourceSpan, SemanticFamily, SemanticFingerprint, Proposal, HumanJudgment,
TrustedLeaf, ScopedSurface, DerivedLeaf, ReviewBatch, ModelRun, DSLMapping. TrustedRelation and
TrustedShape are added only when evidence earns them. Derived analysis state is not persisted
unless it is needed to operate.

## Rules that hold

- **A surface is wording plus scope, not wording alone.** A scope narrows by source fragment,
  ability kind, the words opening the occurrence's clause, the words just before it, and the next
  words after it. It is stored with the surface and checked for every occurrence on every
  application. The same wording under a different scope is a different decision.
- **Leaves stay compositional.** "Select one enemy unit", "within 24″ of this unit", "visible to
  …" and "excluding …" are separate leaves. Lowering may fold them into one selector; authoring
  does not absorb qualifiers into a broader leaf to raise completion counts.
- **Source semantics are separate from DSL realization.** A leaf records what the source says, not
  which constructor it compiles to today. A meaning the DSL cannot yet express is a `DSL_GAP`; the
  annotation is not distorted to fit.
- **A placeholder is not a meaning.** A trusted leaf whose parameter still holds the import
  placeholder `"source"` does not count as resolved source (`placeholders.ts`), and no new
  decision may create one. A text holding such a leaf is not leaf-complete.

## Proven results

- **Exact duplicates:** 95 trusted source annotations → 604 derived copies, 6.36 per source, no
  model involved.
- **Sideways-1:** 3 human surface decisions → 865 derived leaves → 305 new distinct texts.
- **Sideways-2:** scoped surfaces reproduce exactly from stored rows alone (865 rows, 0
  differences); 0 known counterexamples admitted across 11 surfaces.
- **Sideways-3:** 5 human surface decisions → 9 previously incomplete distinct texts became
  leaf-complete → 9/9 compile and pass every gate with no compiler, schema, lowering or gate
  change. The first run was 8/9; the failure was an imported placeholder leaf, not composition.

## Closed approaches

Closed barring new empirical evidence. Do not reopen them as ideas not yet tried hard enough.
Several were closed by pilots in earlier rounds (round 5B–5D) whose reports live outside this
repository; the reason given is the finding that closed each.

- **Jev as semantic segmenter.** Its segmentation pilots were worse than DeepSeek's; Jev now only
  ranks families for spans a segmenter cut (`jev-classify.ts`).
- **Independent yes/no family questions**, and **Jev top-3 followed by independent re-checks.**
  Per-family questions multiplied cost without better agreement than one kind-scoped ranked
  choice, which is the classifier kept.
- **Whole-ability zero-shot semantic graph generation.** Whole-rule output cannot be reviewed,
  corrected, or reused piece by piece; trusted leaves can, and they propagate.
- **Exhaustive proof-route preservation**, and **large arbitrary graph architecture before broad
  leaf coverage.** The route and formation machinery grew without moving coverage. Sideways-3
  showed composition from complete trusted leaves compiling unchanged.
- **Sol/Terra as corpus-wide semantic overseer.** A model supervising models does not create
  trusted semantics; only human authority does.
- **Gold-conditioned candidate search.** Searching toward the authored DSL optimizes toward the
  existing encodings, errors included, rather than toward what the source says.
- **Model-authored canonical DSL as the primary authoring path.** Canonical DSL comes only from
  deterministic lowering of trusted leaves.

## Open frontier

These are the next layers of work. None of them is a reason to reopen the leaf architecture.

- **Connectives and local structure:** "and" / "or" between leaves are decided per occurrence
  today; 88 near-complete texts in the Sideways-3 cohort hold a connective residual.
- **Segmentation throughput:** most of the corpus has not been segmented.
- **Ontology saturation and the long tail:** rare wordings need their own decisions.
- **True DSL gaps**, recorded as `DSL_GAP` with the source meaning kept intact.

Known limitation: one active surface per wording (`leaf_surfaces_one_meaning`). A wording that
needs two meanings under disjoint scopes cannot hold both yet. This is an implementation limit, not
a semantic rule.

## Instruction to agents

Do not redesign the semantic-authoring architecture because a later frontier is difficult. First
classify the problem as segmentation, leaf semantics, relation/composition, or DSL
representation, and solve it at that layer.
