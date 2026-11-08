[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / stratagemTargetNames

# Function: stratagemTargetNames()

> **stratagemTargetNames**(`stratagem`, `members`, `triggerSubject?`, `printed?`): `Record`\<`string`, `boolean`\>

Defined in: [abilities-resolver/resolver.ts:308](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L308)

For a Stratagem with several targets (an array-form `target_restrictions`), whether a unit of
`members` can be each named friendly target, read as [stratagemCanTargetUnit](stratagemCanTargetUnit.md) reads each
target: what `{stratagem_target: name}` resolves to when the Stratagem is used on that unit.
Enemy targets are not listed; a Stratagem with no named targets gives an empty record.

## Parameters

### stratagem

[`Stratagem`](../../generated/interfaces/Stratagem.md)

### members

readonly `ReadonlySet`\<`string`\>[]

### triggerSubject?

`unknown`

### printed?

(`keyword`) => `boolean`

## Returns

`Record`\<`string`, `boolean`\>
