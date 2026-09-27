[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / crunch

# Function: crunch()

> **crunch**(`input`, `dataset?`): [`EngineOutput`](../type-aliases/EngineOutput.md)

Defined in: [cruncher/engine.ts:64](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/engine.ts#L64)

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
