[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffSource

# Type Alias: BuffSource

> **BuffSource** = \{ `kind`: `"weapon-keyword"`; `weaponId`: `string`; `keywordId`: `string`; \} \| \{ `kind`: `"ability"`; `abilityId`: `string`; `abilityKind`: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`; `sourceUnitId?`: `string`; `selectsModel?`: `true`; \} \| \{ `kind`: `"manual"`; `label`: `string`; \}

Defined in: [cruncher/buffs.ts:20](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L20)

Where a buff originated. Drives stable tie-breaking inside `resolveBuffs`.

## Union Members

### Type Literal

\{ `kind`: `"weapon-keyword"`; `weaponId`: `string`; `keywordId`: `string`; \}

***

### Type Literal

\{ `kind`: `"ability"`; `abilityId`: `string`; `abilityKind`: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`; `sourceUnitId?`: `string`; `selectsModel?`: `true`; \}

#### kind

> **kind**: `"ability"`

#### abilityId

> **abilityId**: `string`

#### abilityKind

> **abilityKind**: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`

#### sourceUnitId?

> `optional` **sourceUnitId?**: `string`

For `abilityKind: "attached"`, the combined-unit member the ability
came from (so the UI can name it and show its leader/bodyguard role);
for `"support"`, the other unit that provides it. Absent for other kinds.

#### selectsModel?

> `optional` **selectsModel?**: `true`

For `abilityKind: "detachment-stratagem"`, set when the Stratagem targets one model of the unit.

***

### Type Literal

\{ `kind`: `"manual"`; `label`: `string`; \}
