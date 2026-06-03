[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AbilityView

# Class: AbilityView

Defined in: [data/entities.ts:87](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L87)

An ability, linked to the phases it acts in and the units that have it.

Phases are not stored on the ability — they live in `phase-mappings` records.

## Example

```ts
units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("shooting"));
```

## Constructors

### Constructor

> **new AbilityView**(`raw`, `ds`): `AbilityView`

Defined in: [data/entities.ts:88](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L88)

#### Parameters

##### raw

[`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md)

The full generated ability record.

##### ds

[`Dataset`](Dataset.md)

#### Returns

`AbilityView`

## Properties

### raw

> `readonly` **raw**: [`AbilityDSLEntry`](../../generated/interfaces/AbilityDSLEntry.md)

Defined in: [data/entities.ts:90](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L90)

The full generated ability record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:95](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L95)

The ability's id (`ability_id` in the raw record).

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:99](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L99)

##### Returns

`string`

***

### phases

#### Get Signature

> **get** **phases**(): [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [data/entities.ts:104](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L104)

Game phases this ability acts in, unioned across its phase-mappings.

##### Returns

[`Phase`](../../generated/type-aliases/Phase.md)[]

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:109](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L109)

Units that list this ability in their `ability_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

## Methods

### getBuffs()

> **getBuffs**(`source`, `context?`, `perspective?`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:122](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L122)

Buff stack this ability contributes against `context`, with provenance
tagged via `source` (the caller knows whether this ability is being read
as army, detachment, unit, leader, etc.). DSL branches the buff layer
can't auto-apply are dropped here; call [describeBuffs](#describebuffs) if you
also want the diagnostics. `perspective` defaults to `"attacker"`; pass
`"target"` to translate the ability as a defensive buff (FNP, T/Sv
stat-mods, save rerolls, incoming hit penalties).

#### Parameters

##### source

[`BuffSource`](../type-aliases/BuffSource.md)

##### context?

[`EngineContext`](../type-aliases/EngineContext.md)

##### perspective?

[`TranslationPerspective`](../type-aliases/TranslationPerspective.md) = `"attacker"`

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### describeBuffs()

> **describeBuffs**(`source`, `context?`, `perspective?`): [`EffectTranslation`](../type-aliases/EffectTranslation.md)

Defined in: [data/entities.ts:135](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/entities.ts#L135)

Full DSL→Buff translation, including the `unsupported` list of effect
fragments the buff layer can't model. The SPA renders these as warnings
so users see which abilities have effects that need a manual toggle.

#### Parameters

##### source

[`BuffSource`](../type-aliases/BuffSource.md)

##### context?

[`EngineContext`](../type-aliases/EngineContext.md)

##### perspective?

[`TranslationPerspective`](../type-aliases/TranslationPerspective.md) = `"attacker"`

#### Returns

[`EffectTranslation`](../type-aliases/EffectTranslation.md)
