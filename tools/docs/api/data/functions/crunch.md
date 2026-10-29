[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / crunch

# Function: crunch()

> **crunch**(`input`, `dataset?`): [`EngineOutput`](../type-aliases/EngineOutput.md)

Defined in: [cruncher/engine.ts:104](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/engine.ts#L104)

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
