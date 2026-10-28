[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AbilityView

# Class: AbilityView

Defined in: [data/entities.ts:146](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L146)

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

Defined in: [data/entities.ts:147](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L147)

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

Defined in: [data/entities.ts:149](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L149)

The full generated ability record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:154](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L154)

The ability's id (`ability_id` in the raw record).

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:158](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L158)

##### Returns

`string`

***

### phases

#### Get Signature

> **get** **phases**(): [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [data/entities.ts:174](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L174)

Game phases this ability acts in, unioned across its phase-mappings.

##### Returns

[`Phase`](../../generated/type-aliases/Phase.md)[]

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:179](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L179)

Units that list this ability in their `ability_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

***

### appliesTo

#### Get Signature

> **get** **appliesTo**(): `AbilityAppliesTo` \| `undefined`

Defined in: [data/entities.ts:189](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L189)

The curated `applies_to` keyword filter, or `undefined` when this ability
declares no resolvable unit scope. When present, it names which datasheet
units the ability benefits — the contract for roster-side highlighting
(e.g. a detachment rule that only buffs `POSSESSED` units).

##### Returns

`AbilityAppliesTo` \| `undefined`

## Methods

### describe()

> **describe**(): `string`

Defined in: [data/entities.ts:168](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L168)

Generated plain-English approximation of this ability's effect + scope,
rendered from the DSL by the conformance-pinned describer
(`translate/effect.ts`). The dataset carries no rules prose; this is the
displayable stand-in.

#### Returns

`string`

***

### affectsUnit()

> **affectsUnit**(`unit`): `boolean`

Defined in: [data/entities.ts:199](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L199)

Whether this ability's canonical keyword predicate includes `unit`, across
its `keywords` + `faction_keywords`. Always `false` when the ability has no
`applies_to` (no resolvable scope → no highlight). Pinned by the
`conformance/applies-to` corpus.

#### Parameters

##### unit

[`UnitView`](UnitView.md)

#### Returns

`boolean`

***

### affectedUnits()

> **affectedUnits**(`candidates`): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:208](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L208)

The subset of `candidates` (typically a roster's units) this ability's
`applies_to` scope benefits, preserving input order. Empty when the ability
declares no scope.

#### Parameters

##### candidates

[`UnitView`](UnitView.md)[]

#### Returns

[`UnitView`](UnitView.md)[]

***

### getBuffs()

> **getBuffs**(`source`, `context?`, `perspective?`, `rating?`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:221](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L221)

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

##### rating?

`string` \| `number`

#### Returns

[`Buff`](../type-aliases/Buff.md)[]

***

### describeBuffs()

> **describeBuffs**(`source`, `context?`, `perspective?`, `rating?`): [`EffectTranslation`](../type-aliases/EffectTranslation.md)

Defined in: [data/entities.ts:287](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/entities.ts#L287)

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

##### rating?

`string` \| `number`

#### Returns

[`EffectTranslation`](../type-aliases/EffectTranslation.md)
