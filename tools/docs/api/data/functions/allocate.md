[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / allocate

# Function: allocate()

> **allocate**(`input`, `dataset?`, `defences?`): [`AllocationOutput`](../type-aliases/AllocationOutput.md)

Defined in: [cruncher/allocation.ts:161](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/allocation.ts#L161)

Exact allocation of an attacking unit's damage into the target's models. Without an explicit
`defences.zeroing`, the input's `damage-zeroing` buffs supply it.

## Parameters

### input

[`EngineInput`](../type-aliases/EngineInput.md)

### dataset?

[`Dataset`](../classes/Dataset.md)

### defences?

[`AllocationDefences`](../type-aliases/AllocationDefences.md) = `{}`

## Returns

[`AllocationOutput`](../type-aliases/AllocationOutput.md)
