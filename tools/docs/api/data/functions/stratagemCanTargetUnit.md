[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / stratagemCanTargetUnit

# Function: stratagemCanTargetUnit()

> **stratagemCanTargetUnit**(`stratagem`, `members`, `triggerSubject?`, `printed?`): `boolean`

Defined in: [abilities-resolver/resolver.ts:284](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L284)

Whether a unit of `members` (each member's keywords: a unit and the units attached to it) can
be a stratagem's friendly target, as `stratagemCanTarget`. A target that selects a model needs
one member that meets it alone; a unit target reads every member as one combined unit. A target
bound to the triggering unit is also held to the keyword lists of the `triggerSubject` (the
stratagem's WHEN, its ability's `trigger.subject`), which say which friendly units can trigger
it. A keyword the WHEN requires that no datasheet prints (`printed` says which do) is one the
army gains in play, such as a detachment's designation, so it is not held against a unit.
Keywords compare by `normalizeName` (case, diacritics and apostrophe variants aside).

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

`boolean`
