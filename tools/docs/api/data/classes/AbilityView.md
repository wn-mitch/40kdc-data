[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AbilityView

# Class: AbilityView

Defined in: [data/entities.ts:139](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L139)

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

Defined in: [data/entities.ts:140](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L140)

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

Defined in: [data/entities.ts:142](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L142)

The full generated ability record.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [data/entities.ts:147](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L147)

The ability's id (`ability_id` in the raw record).

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [data/entities.ts:151](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L151)

##### Returns

`string`

***

### phases

#### Get Signature

> **get** **phases**(): [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [data/entities.ts:166](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L166)

Game phases this ability acts in, unioned across its phase-mappings.

##### Returns

[`Phase`](../../generated/type-aliases/Phase.md)[]

***

### units

#### Get Signature

> **get** **units**(): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:171](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L171)

Units that list this ability in their `ability_ids`.

##### Returns

[`UnitView`](UnitView.md)[]

***

### appliesTo

#### Get Signature

> **get** **appliesTo**(): `AbilityAppliesTo` \| `undefined`

Defined in: [data/entities.ts:181](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L181)

The curated `applies_to` keyword filter, or `undefined` when this ability
declares no resolvable unit scope. When present, it names which datasheet
units the ability benefits — the contract for roster-side highlighting
(e.g. a detachment rule that only buffs `POSSESSED` units).

##### Returns

`AbilityAppliesTo` \| `undefined`

## Methods

### describe()

> **describe**(): `string`

Defined in: [data/entities.ts:161](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L161)

Generated plain-English approximation of this ability's effect + scope,
rendered from the DSL by the conformance-pinned describer
(`translate/effect.ts`). The dataset carries no rules prose; this is the
displayable stand-in.

#### Returns

`string`

***

### affectsUnit()

> **affectsUnit**(`unit`): `boolean`

Defined in: [data/entities.ts:192](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L192)

Whether this ability's `applies_to` scope includes `unit` — true iff the
unit carries every `required_keywords` entry and no `excluded_keywords`,
across its `keywords` + `faction_keywords`. Always `false` when the ability
has no `applies_to` (no resolvable scope → no highlight). Pinned by the
`conformance/applies-to` corpus.

#### Parameters

##### unit

[`UnitView`](UnitView.md)

#### Returns

`boolean`

***

### affectedUnits()

> **affectedUnits**(`candidates`): [`UnitView`](UnitView.md)[]

Defined in: [data/entities.ts:201](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L201)

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

> **getBuffs**(`source`, `context?`, `perspective?`): [`Buff`](../type-aliases/Buff.md)[]

Defined in: [data/entities.ts:214](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L214)

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

Defined in: [data/entities.ts:279](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/entities.ts#L279)

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
