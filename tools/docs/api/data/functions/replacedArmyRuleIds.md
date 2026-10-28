[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / replacedArmyRuleIds

# Function: replacedArmyRuleIds()

> **replacedArmyRuleIds**(`dataset`, `factionId`, `detachmentIds`): `Set`\<`string`\>

Defined in: [abilities-resolver/resolver.ts:220](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L220)

The army rules of `factionId` that the selected detachments' own army rules replace: a
faction-typed record with a `detachment_id` among `detachmentIds` (a Combat Patrol box's army
rule) drops each record its `interactions` name with type `replaces`. A selected Combat Patrol
detachment (`game_modes` includes `combat-patrol`) lists its complete army-rule set in
`detachment_rule_ids`, so it also drops every faction-typed record it does not list. Callers
that combine several detachments pass all of them, so a rule replaced in one is not restored by
another.

## Parameters

### dataset

[`Dataset`](../classes/Dataset.md)

### factionId

`string`

### detachmentIds

readonly (`string` \| `undefined`)[]

## Returns

`Set`\<`string`\>
