[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / crunch

# Function: crunch()

> **crunch**(`input`, `dataset?`): [`EngineOutput`](../type-aliases/EngineOutput.md)

Defined in: [cruncher/engine.ts:112](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/engine.ts#L112)

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
