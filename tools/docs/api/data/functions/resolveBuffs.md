[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveBuffs

# Function: resolveBuffs()

> **resolveBuffs**(`buffs`, `ctx`): [`ResolvedModifiers`](../type-aliases/ResolvedModifiers.md)

Defined in: [cruncher/buffs.ts:257](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L257)

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
