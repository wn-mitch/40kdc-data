[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveBuffs

# Function: resolveBuffs()

> **resolveBuffs**(`buffs`, `ctx`): [`ResolvedModifiers`](../type-aliases/ResolvedModifiers.md)

Defined in: [cruncher/buffs.ts:711](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L711)

Collapse a flat buff stack into a [ResolvedModifiers](../type-aliases/ResolvedModifiers.md) read-out. Pure
function; the engine — and any UI that wants to render the resolved table
before crunching — both go through this.

## Parameters

### buffs

[`Buff`](../type-aliases/Buff.md)[]

### ctx

[`EngineContext`](../type-aliases/EngineContext.md)

## Returns

[`ResolvedModifiers`](../type-aliases/ResolvedModifiers.md)
