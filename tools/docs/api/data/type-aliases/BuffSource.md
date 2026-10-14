[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffSource

# Type Alias: BuffSource

> **BuffSource** = \{ `kind`: `"weapon-keyword"`; `weaponId`: `string`; `keywordId`: `string`; \} \| \{ `kind`: `"ability"`; `abilityId`: `string`; `abilityKind`: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`; `sourceUnitId?`: `string`; \} \| \{ `kind`: `"manual"`; `label`: `string`; \}

Defined in: [cruncher/buffs.ts:16](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L16)

Where a buff originated. Drives stable tie-breaking inside `resolveBuffs`.

## Union Members

### Type Literal

\{ `kind`: `"weapon-keyword"`; `weaponId`: `string`; `keywordId`: `string`; \}

***

### Type Literal

\{ `kind`: `"ability"`; `abilityId`: `string`; `abilityKind`: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`; `sourceUnitId?`: `string`; \}

#### kind

> **kind**: `"ability"`

#### abilityId

> **abilityId**: `string`

#### abilityKind

> **abilityKind**: `"army"` \| `"detachment"` \| `"detachment-stratagem"` \| `"unit"` \| `"attached"` \| `"support"`

#### sourceUnitId?

> `optional` **sourceUnitId?**: `string`

For `abilityKind: "attached"`, the combined-unit member the ability
came from (so the UI can name it and show its leader/bodyguard role).
Absent for other kinds.

***

### Type Literal

\{ `kind`: `"manual"`; `label`: `string`; \}
