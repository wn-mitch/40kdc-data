[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / resolveBuffs

# Function: resolveBuffs()

> **resolveBuffs**(`buffs`, `ctx`): [`ResolvedModifiers`](../type-aliases/ResolvedModifiers.md)

Defined in: [cruncher/buffs.ts:235](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/buffs.ts#L235)

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
