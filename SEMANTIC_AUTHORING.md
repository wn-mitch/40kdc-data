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
- **Reuse follows approved meaning across scoped spellings.** Reapplying stored surfaces only
  replays known wording; an uncovered alias of an approved operator needs its own scoped surface.
  Numeric surface keys preserve positive and negative operators, including Unicode dash signs;
  existing mathematical-minus keys retain their stored spelling.
- **An operator decides a meaning once across its operand spellings.** A leaf operator
  (`leaf-operators.ts`, `review-apply` action `operator`) is a worded template with typed slots
  ("{subject} is eligible to {acts} in a turn in which it {moves}") whose every slot lists the
  spellings it covers and the parameter value each supplies. Each occurrence's own words bind its
  operands; a neighbouring example never does. The operator expands to scoped surfaces linked by
  `leaf_surfaces.operator_id`, so matching, scope, blocking and undo are those of any surface. A
  spelling whose wording another surface decides with a different meaning refuses the whole
  operator; one decided with the same meaning stays as decided. Anaphoric spellings ("that unit",
  "it") and spellings whose value a family's earlier decisions contradict are not slot spellings.
- **Anaphoric subjects point back; compilation binds them.** "That enemy unit", "that unit",
  "it" and "those units" record the unit-ref value `antecedent` (`antecedent-families.ts` lists
  the families and keys that accept it). Compilation (`compile-antecedent.ts`) binds it to the
  selected unit when a selection precedes the leaf; else to every unit a unit-filter right
  before it matches ("Friendly **K** units" + "have X", an army-wide grant); else to the unit a
  preceding aura reaches (its recipient: "While a friendly X unit is within 6\" of this model,
  that unit …"); else to a Stratagem's target; else to the unit of a preceding event that names
  a unit; else, outside a Stratagem, to the record's own unit (its model when the record only
  ever names this model). It refuses a Stratagem leaf with none of these, and a leaf whose family
  cannot name the unit it binds to. A roll-modifier's `preceding` roll ("adding 1 to the result")
  binds the same way to the nearest roll or test before it (`compile-preceding-roll.ts`). Because the leaf
  stays the same wherever the wording occurs, "that enemy unit is **X**" is one operator.
- **A family version widens; it never reinterprets.** A later version (`family-extensions.ts`)
  adds values or optional parameters and hands the rest of a leaf to the previous version, so
  earlier leaves move across by identity.
- **Leaves stay compositional.** "Select one enemy unit", "within 24″ of this unit", "visible to
  …" and "excluding …" are separate leaves. Lowering may fold them into one selector; authoring
  does not absorb qualifiers into a broader leaf to raise completion counts.
- **Frequency and ownership are separate qualifications.** A usage frequency records its cadence
  without choosing army, unit or model ownership. A reviewed `usage-scope` leaf supplies the
  allowance owner; an explicitly bound usage leaf can carry it directly. Compilation refuses an
  unbound frequency rather than guessing an owner or turning a target-selection cap into a global
  usage limit. Effects do not restrict reuse of the frequency wording.
- **Stat adjustments and setters do not choose their recipient.** Signed number/stat terms accept spaced
  and compact spellings. A bonus improves the named stat and a penalty worsens it, including
  characteristics whose beneficial numerical direction is downward. The unsigned
  `characteristic-set@3` operand records a literal value and operation `set`; it may remain
  unbound until a reviewed recipient (and, for weapon characteristics, weapon scope) is folded
  in. Compilation refuses missing or conflicting bindings and never defaults a bare setter to a unit.
  Recipient and weapon scope remain separate qualifications; explicitly reviewed bindings are retained.
  Unsigned stat values are not treated as bonuses.
- **Attack-property prefixes supply scope, not an effect.** A `weapon-property-scope` leaf names
  the recipient and melee, ranged or all-weapons scope. The following stat adjustment or
  weapon-ability name supplies the property. Lowering retains explicit bindings, rejects
  conflicting recipients or scopes, and does not carry a stat scope into another sentence.
- **Returned-model exclusions filter models, not their unit.** A `returned-model-exclusion`
  leaf excludes individual returned models with the named keywords, including within attached
  units. Source-backed clause binding folds it into `return-models.modifier.exclude_model_keyword`;
  count, wounds and placement remain separate. Compilation rejects orphaned or ambiguous
  exclusions rather than applying a whole-unit keyword condition.
- **What a model comes back with qualifies its placement, not the ability.** `wounds-remaining`
  ("with 3 wounds remaining"), `starting-strength` ("its unit has a Starting Strength of 1") and
  `leaves-attached-unit` ("that model is not part of an attached unit") are separate leaves that
  fold into the nearest effect before them in their fragment (`compile-model-state.ts`): a
  set-up, a return-models (wounds only) or a split-unit (Starting Strength only). They never gate.
  Compilation refuses one with no such effect before it, one past a new moment, and one that
  contradicts the effect's own value.
- **Source semantics are separate from DSL realization.** A leaf records what the source says, not
  which constructor it compiles to today. A meaning the DSL cannot yet express is a `DSL_GAP`; the
  annotation is not distorted to fit.
- **Roll thresholds do not guess the die.** A minimum-result leaf records the lower bound
  ("on a 2+" means at least 2); the dice leaf supplies its upper bound during compilation.
  Explicit ranges and exact results retain both bounds.
- **A reactive effect names the roll its trigger names.** A before-roll or after-roll moment over one
  roll kind is followed by an effect whose `roll` is that kind (`roll-result` with `roll: hit` after
  "after making a Hit roll"). `roll: any` on such an effect is accepted by the schema and changes
  other rolls, so drafters must not author it.
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
