[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnitView

# Class: UnitView

Defined in: [data/entities.ts:31](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L31)

A unit, linked to its faction, weapons, and abilities.

## Constructors

### Constructor

> **new UnitView**(`raw`, `ds`): `UnitView`

Defined in: [data/entities.ts:32](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L32)

#### Parameters

##### raw

[`Unit`](../../generated/interfaces/Unit.md)

The full generated `Unit` record.

##### ds

[`Dataset`](Dataset.md)

#### Returns

`UnitView`

## Properties

### raw

> `readonly` **raw**: [`Unit`](../../generated/interfaces/Unit.md)

Defined in: [data/entities.ts:34](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L34)

The full generated `Unit` record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:38](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L38)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:42](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L42)

##### Returns

`string`

***

### factionId

#### Get Signature

> **get** **factionId**(): `string`

Defined in: [data/entities.ts:46](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L46)

##### Returns

`string`

***

### role

#### Get Signature

> **get** **role**(): `"character"` \| `"battleline"` \| `"dedicated-transport"` \| `"fortification"` \| `"allied"` \| `"epic-hero"` \| `undefined`

Defined in: [data/entities.ts:50](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L50)

##### Returns

`"character"` \| `"battleline"` \| `"dedicated-transport"` \| `"fortification"` \| `"allied"` \| `"epic-hero"` \| `undefined`

***

### keywords

#### Get Signature

> **get** **keywords**(): readonly `string`[]

Defined in: [data/entities.ts:54](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L54)

##### Returns

readonly `string`[]

***

### factionKeywords

#### Get Signature

> **get** **factionKeywords**(): readonly `string`[]

Defined in: [data/entities.ts:58](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L58)

##### Returns

readonly `string`[]

***

### modelCount

#### Get Signature

> **get** **modelCount**(): \{\[`k`: `string`\]: `unknown`; `min`: `number`; `max`: `number`; \} \| `undefined`

Defined in: [data/entities.ts:62](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L62)

##### Returns

\{\[`k`: `string`\]: `unknown`; `min`: `number`; `max`: `number`; \} \| `undefined`

***

### points

#### Get Signature

> **get** **points**(): `object`[] \| `undefined`

Defined in: [data/entities.ts:66](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L66)

##### Returns

`object`[]

***

`undefined`

***

### profiles

#### Get Signature

> **get** **profiles**(): readonly (\{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \} \| \{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \})[]

Defined in: [data/entities.ts:71](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L71)

All stat profiles for this unit (at least one is always present).

##### Returns

readonly (\{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \} \| \{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \})[]

***

### profileCount

#### Get Signature

> **get** **profileCount**(): `number`

Defined in: [data/entities.ts:75](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L75)

##### Returns

`number`

***

### faction

#### Get Signature

> **get** **faction**(): [`FactionView`](FactionView.md) \| `undefined`

Defined in: [data/entities.ts:80](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L80)

The unit's faction, or `undefined` if its `faction_id` is unknown.

##### Returns

[`FactionView`](FactionView.md) \| `undefined`

***

### weapons

#### Get Signature

> **get** **weapons**(): [`WeaponView`](WeaponView.md)[]

Defined in: [data/entities.ts:90](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L90)

Weapons referenced by `weapon_ids`, resolved within the unit's own faction —
a bare id shared across factions (e.g. `close-combat-weapon`) resolves to the
wielder's own copy (issue #59), falling back to global first-wins only for a
genuinely cross-faction id. Unresolved ids are skipped.

##### Returns

[`WeaponView`](WeaponView.md)[]

***

### abilities

#### Get Signature

> **get** **abilities**(): [`AbilityView`](AbilityView.md)[]

Defined in: [data/entities.ts:98](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L98)

Abilities referenced by `ability_ids`; unresolved ids are skipped.

##### Returns

[`AbilityView`](AbilityView.md)[]

***

### wargearOptions

#### Get Signature

> **get** **wargearOptions**(): [`WargearOption`](../../generated/interfaces/WargearOption.md)[]

Defined in: [data/entities.ts:110](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L110)

Wargear options (weapon swaps, add-ons, choices) authored for this unit.

##### Returns

[`WargearOption`](../../generated/interfaces/WargearOption.md)[]

## Methods

### profileAt()

> **profileAt**(`i?`): \{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \} \| \{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \}

Defined in: [data/entities.ts:119](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L119)

The stat profile at index `i` (default 0). Returns the schema-generated
profile object directly so callers can feed it straight to the engine
without an intermediate wrapper.

#### Parameters

##### i?

`number` = `0`

#### Returns

##### Type Literal

\{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \}

##### Index Signature

\[`k`: `string`\]: `unknown`

###### name?

> `optional` **name?**: `string`

Profile name (e.g., 'Wounded' for degrading)

###### M

> **M**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### T

> **T**: `number`

###### W

> **W**: `number`

###### Sv

> **Sv**: `number`

###### invuln\_sv?

> `optional` **invuln\_sv?**: `number` \| `null`

###### invuln\_sv\_ranged?

> `optional` **invuln\_sv\_ranged?**: `number` \| `null`

Attack-scoped invulnerable save that applies only to ranged attacks.

###### invuln\_sv\_melee?

> `optional` **invuln\_sv\_melee?**: `number` \| `null`

Attack-scoped invulnerable save that applies only to melee attacks.

###### Ld

> **Ld**: `number`

###### OC

> **OC**: `number`

***

##### Type Literal

\{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../../generated/type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \}

##### Index Signature

\[`k`: `string`\]: `unknown`

###### name?

> `optional` **name?**: `string`

Profile name (e.g., 'Wounded' for degrading)

###### M

> **M**: [`StatValue`](../../generated/type-aliases/StatValue.md)

###### T

> **T**: `number`

###### W

> **W**: `number`

###### Sv

> **Sv**: `number`

###### invuln\_sv?

> `optional` **invuln\_sv?**: `number` \| `null`

###### invuln\_sv\_ranged?

> `optional` **invuln\_sv\_ranged?**: `number` \| `null`

Attack-scoped invulnerable save that applies only to ranged attacks.

###### invuln\_sv\_melee?

> `optional` **invuln\_sv\_melee?**: `number` \| `null`

Attack-scoped invulnerable save that applies only to melee attacks.

###### Ld

> **Ld**: `number`

###### OC

> **OC**: `number`
