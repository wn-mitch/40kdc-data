# Semantic authoring

This is the settled architecture for turning ability source text into trusted semantics and DSL.
Read it before proposing a change to how abilities are authored. The workbench code lives in
`tools/src/semantic-authoring/`; its CLI is `npm run semantic-authoring -- commands`.

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

The Velochy vocabulary migration may repair activation metadata on an existing incomplete record
without replacing its effects. This is a migration-only operation, not a partial-record authoring
or publication path: its entire WHEN scope and correlated actor/object qualifiers must already be
trusted, and it reuses the compiler's event/filter lowering. The existing effect, usage, duration
and static eligibility remain unchanged, with source/input fingerprints and whole-projection
validation. Untiled effects remain untiled; this operation never reports a whole-record compile or
gate pass. Missing or contradictory timing semantics still require an explicit human leaf review.

## Where work happens

One live workbench database (`_private/round5c/workbench.sqlite`) holds all source, proposals,
decisions and derived rows. All authoring runs through the `semantic-authoring` CLI: model stages
(`segment`, `classify`) and mechanical copies (`propagate`) may write to it directly after keeping
one rolling copy (`workbench.sqlite.pre-run`); human decisions arrive only through
`review-apply <decisions.json>`, written from the reviewer's answers in chat. There is no review UI.

Publication follows the same rule. `review-sheet <faction>` (read-only) compiles and gates every
fully described source in a faction, renders each beside its published record, and drafts an
unsigned decisions file of `approve-shape` decisions for the members that pass every gate. The
integrity gate projects each record alone into the dataset and runs the schema and
referential-integrity checks `prepare-publication` runs, so a member that passes every gate is
one publication accepts on its own. The reviewer signs the draft; `review-apply` records the
approvals as `compiled_entries`, refusing an `approve-shape` decision whose members include one
that fails that integrity check; `publishable` lists the approved entries that would change
tracked data; `prepare-publication` and `publish` write them.

The `_private/round5c/` directory is intentionally retained as the persisted workbench and
artifact location so existing local databases and run history remain reachable. Stored algorithm
and export identifiers, plus historical review reports under `_reports/`, also keep their original
identities. Active code, commands, environment variables, and test names use
`semantic-authoring`; these persisted names are not compatibility aliases.

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
- **A family version widens; it never reinterprets.** A later version (`tools/src/semantic-authoring/families/`)
  adds values or optional parameters and hands the rest of a leaf to the previous version, so
  earlier leaves move across by identity.
- **Named-region authoring uses version 3.** Versions 1 and 2 remain byte-stable historical
  contracts so existing reviewed registry fingerprints keep their identity. Version 3 is the
  current contract: `baseline_region` and `phase_extensions` are validated against the closed
  canonical DSL recipe fragments, `region_id`, `owner_faction`, and `beneficiary_faction` use
  canonical entity IDs, and `qualifies_by_keyword` must be nonblank. The v2-to-v3 family mapping
  preserves already-canonical parameters unchanged. A v2 fingerprint that only satisfies the
  historical loose recipe boundary remains active and is reported for review rather than being
  forced through v3 or crashing workbench initialization. Compilation consumes the canonical v3
  recipe without reinterpreting historical leaves.
- **Leaves stay compositional.** "Select one enemy unit", "within 24″ of this unit", "visible to
  …" and "excluding …" are separate leaves. Lowering may fold them into one canonical selector;
  authoring does not absorb qualifiers into a broader leaf to raise completion counts. A selector
  uses `filter` plus inclusive `count` bounds, optional per-target `limit`, `bind_as`, and
  event-dependent `eligibility`. `for-each-unit` means all matches and therefore omits `count`.
- **Canonical targets name roles and references, not legacy aliases.** A model target is
  `this-model`/`model-in-this-unit`, or a `unit-filter` with `level: "model"` and (for actual
  attachment membership) `member_of` plus `attachment_role: "bodyguard"|"leader"`. This is
  actual attached membership, including retained membership of destroyed models; it is never
  inferred from `CHARACTER`, `has_ability: ["leader"]`, or a bearer label. `self` and `bearer`
  are retired DSL target spellings. A source family's reviewed `bodyguard_only` parameter may
  remain as source semantics, but deterministic lowering emits the typed target filter.
- **Static applicability is not runtime targeting.** Top-level `applies_to` is the human-curated
  roster-highlighting keyword predicate (`all_of`, `any_of`, `none_of`, `not_all_of`); absent or
  null matches no unit, while `{}` matches every unit. Runtime recipients use `unit-filter`
  (`all_of`, `any_of`, `none_of`, `not_all_of`, and typed predicates), and ordinary predicates
  use `matches`; never copy runtime effect targets into `applies_to`.
- **Board-dependent predicates preserve unknown.** A range, visibility, engagement, or placement
  test with no board state is not silently false or true by invented geometry. Lowering and
  consumers retain an explicit unknown/permissive outcome where the current runtime contract
  requires it; a known distance outside a range is the only range rejection.
- **Frequency and ownership are separate qualifications.** A usage frequency records its cadence
  without choosing army, unit or model ownership. A reviewed `usage-scope` leaf supplies the
  allowance owner; an explicitly bound usage leaf can carry it directly. Compilation refuses an
  unbound frequency rather than guessing an owner or turning a target-selection cap into a global
  usage limit. Effects do not restrict reuse of the frequency wording.
- **Ability-use context keeps event identity intact.** A `game-event` trigger for
  `used` binds the whole use (`binds_event_variable`), including its actor and exact
  rule definition. An `ability-modifier` with `ability:{event:"used",event_var}`,
  `aspect:"selection"`, and `operation:"set"` replaces that use's original
  `selection` with a canonical `unit-selector`; `recipient_duration` is a
  `scope-duration`. It is an override, not an additional activation or grant.
  Ability-use history compares the same ability across a different actor, and
  army-state predicates retain their explicit friendly/enemy owner and state.
- **Named ability definitions are distinct from stance options.** A granted named
  ability uses `{ability_id, definition_id}`; declare the definition once with
  its paired `ability-grant.modifier.definition`, then reuse that identity for
  later cross-record grants and references. `rule-state` exchange is atomic
  (lose the held state and gain the other), and suppression exceptions retain
  `except_from:"this-ability"` provenance. Resource income resolves in its
  ordered phase-ended sequence; fixed payments require the pool minimum and are
  not player-menu choices.
- **Oath procedures keep their parent semantics.** `oath-determine` references the
  parent procedure and never invents a stance option. Selection history,
  duplicate/exhaustion, and method qualifiers remain separate reviewed
  qualifiers. Fulfilled qualities retain the parent lifetime unless an explicit
  duration overrides it. An additional-deed reward requires its own event
  prefix, `instead` branch, ordinary reward, and method qualifier; passive
  policies compile independently from turn-start fulfilled activation. The
  acknowledged Code Chivalric stub remains intentionally untouched.
- **Historical compilation is explicit and provenance-bound.** Correlated
  recipient reactions keep the enemy actor distinct from the friendly event
  object and consume one shared parent usage. Historical gates require
  `abilityVersionIds` plus a matching `historicalSourceHashes` map; omitting
  them means current versions only, without changing current DB data or
  provenance. Named ability-state, Oath, and contextual ability-use families
  are registered compiler families, not ad-hoc recipient predicates. The core
  keyword publisher indexes canonical `keyword-grant` leaves and unit/detachment
  inventories, never labels copied from recipient filters.
  A historical record without a live core owner retains reviewed bearer
  eligibility as explicit runtime predicates, including every required and
  excluded keyword. Its phase availability uses `activation-window`; a
  `use-window` leaf requires an actual core Stratagem to check.
- **Stance and option identity are stable data, not labels.** Every option has a required unique
  `id` within its containing ability plus display `name`. Cross-record references use
  `{ability_id, option_id}` and resolve in the faction-local then shared-core namespace. Renaming
  `name` must not change references, lever ids, or capacity links. A shared usage allowance and
  local triggers remain independent; several ability parts can consume one parent allowance.
- **Capacity allocation is an intersection problem.** A complete lever selection must satisfy every
  `group` and `groups` pool and every provider dependency. Capacity raises are assigned to eligible
  options: a fixed option raise cannot fund another option, and overlapping subsets cannot spend
  one slot twice. Consumers must validate the complete selection; summing scalar caps is not
  equivalent. `isLegalLeverSelection` is the public helper for this check.
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
  units. Source-backed clause binding folds it into the return effect's typed model target
  (`target: {level: "model", member_of: "this-unit", none_of: [...]}`); count, wounds and
  placement remain separate. Compilation rejects orphaned or ambiguous exclusions rather than
  applying a whole-unit keyword condition. The source family's `bodyguard_only` parameter,
  when reviewed, remains distinct from this lowered target filter.
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
- **A reviewed "if it does" makes its permission a choice.** Compilation reads accepted CONNECTIVE
  rows whose `reviewed_relation` is `condition-of` (`connective-rows.ts`); a duplicate-text copy
  takes the relation of the row it copies. Each connective sits on the first trusted leaf at or
  after it in its fragment (`within` when a leaf's own span holds it), in the trusted view only,
  and joins the compilation inputs hash only when a record has one. "If it does" / "If you do"
  points back to the nearest leaf before it that is not a condition or duration
  (`compile-connective-plan.ts`). An optional-use, or what one offers, is already optional and
  only has to cover it; a unit selection already scopes its body. A permission effect (make-move,
  ability-activate, a set-up that is neither required nor forbidden, an allowing
  eligibility-permission) with the effects after the connective in its merged sentence is one
  choice (`compile-connective-lower.ts`): when they are the whole of a part with its own moment
  and nothing else in the part is optional, that part's moment (part 0) or node (a later part) is
  optional; otherwise they become one optional ability-part under the permission's gate. A bare
  "if"/"while" before a condition leaf, a connective inside a leaf and "when doing so" change
  nothing. Compilation refuses an antecedent the player cannot decline, a range with no effect
  (a consequence reviewed as a condition must be an effect), a moment among the consequents,
  overlapping ranges, a range across parts, container options, an "instead" or pick, an unshared
  roll band or a split window, and a bare "if" before a moment. It never flattens the gate.
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
- **Conditions written as moments:** a bare "if" before an EVENT leaf ("if one or more models are
  destroyed …") is a condition on what happened, not a trigger. Compilation refuses it until a
  `happened` lowering for such leaves exists.
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
