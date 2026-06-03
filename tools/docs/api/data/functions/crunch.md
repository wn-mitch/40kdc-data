[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / crunch

# Function: crunch()

> **crunch**(`input`, `dataset?`): [`EngineOutput`](../type-aliases/EngineOutput.md)

Defined in: [cruncher/engine.ts:53](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/engine.ts#L53)

Compute the expected per-stage projection for one (attacker, target, buffs)
triple. The dataset defaults to the embedded one — pass an alternate when
crunching against a different bundle (e.g. tests).

## Parameters

### input

[`EngineInput`](../type-aliases/EngineInput.md)

### dataset?

[`Dataset`](../classes/Dataset.md)

## Returns

[`EngineOutput`](../type-aliases/EngineOutput.md)
