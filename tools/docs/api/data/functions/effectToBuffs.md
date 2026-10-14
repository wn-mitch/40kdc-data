[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / effectToBuffs

# Function: effectToBuffs()

> **effectToBuffs**(`effect`, `source`, `context`, `perspective?`): [`EffectTranslation`](../type-aliases/EffectTranslation.md)

Defined in: [cruncher/from-dsl.ts:161](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L161)

Walk an ability DSL `effect` tree and produce the buff stack it contributes
against `context` from the given `perspective`, plus an `unsupported` list
naming any branches the buff layer can't express today.

## Parameters

### effect

`unknown`

### source

[`BuffSource`](../type-aliases/BuffSource.md)

### context

[`EngineContext`](../type-aliases/EngineContext.md)

### perspective?

[`TranslationPerspective`](../type-aliases/TranslationPerspective.md) = `"attacker"`

## Returns

[`EffectTranslation`](../type-aliases/EffectTranslation.md)
