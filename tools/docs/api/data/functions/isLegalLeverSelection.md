[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / isLegalLeverSelection

# Function: isLegalLeverSelection()

> **isLegalLeverSelection**(`levers`, `groups`, `selectedIds`): `boolean`

Defined in: [data/lever-selection.ts:12](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/lever-selection.ts#L12)

Check every intersecting activation pool and provider dependency. Capacity raises
supply extra slots only for their fixed option or allowed subset; overlapping
subsets use exact assignment, so the same slot cannot fund two activations.
Option matching uses immutable lever ids, including granted-record prefixes.

## Parameters

### levers

readonly [`SelectableLever`](../type-aliases/SelectableLever.md)[]

### groups

readonly [`StackableBuffGroup`](../type-aliases/StackableBuffGroup.md)[]

### selectedIds

`ReadonlySet`\<`string`\>

## Returns

`boolean`
