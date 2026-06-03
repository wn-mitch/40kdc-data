[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / attributeStages

# Function: attributeStages()

> **attributeStages**(`input`, `dataset?`, `opts?`): [`AttributedStage`](../type-aliases/AttributedStage.md)[]

Defined in: [cruncher/attribution.ts:92](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L92)

Decompose each pipeline stage of `crunch(input)` into the marginal lift of
every toggleable buff group, via leave-one-out recompute.

Cost is `groups + 2` `crunch` calls (full + baseline + one per group); the
engine is closed-form, so this is cheap to call per weapon line.

## Parameters

### input

[`EngineInput`](../type-aliases/EngineInput.md)

The same [EngineInput](../type-aliases/EngineInput.md) you'd pass to [crunch](crunch.md).

### dataset?

[`Dataset`](../classes/Dataset.md)

Optional dataset override (defaults to the embedded one).

### opts?

`epsilon` — lifts/residuals at or below this magnitude are
               treated as zero (default 1e-6).

#### epsilon?

`number`

## Returns

[`AttributedStage`](../type-aliases/AttributedStage.md)[]
