[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / isLegalLeverSelection

# Function: isLegalLeverSelection()

> **isLegalLeverSelection**(`levers`, `groups`, `selectedIds`): `boolean`

Defined in: [data/lever-selection.ts:12](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/lever-selection.ts#L12)

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
