[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / allocate

# Function: allocate()

> **allocate**(`input`, `dataset?`, `defences?`): [`AllocationOutput`](../type-aliases/AllocationOutput.md)

Defined in: [cruncher/allocation.ts:158](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/allocation.ts#L158)

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
