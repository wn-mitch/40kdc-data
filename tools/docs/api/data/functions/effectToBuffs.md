[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / effectToBuffs

# Function: effectToBuffs()

> **effectToBuffs**(`effect`, `source`, `context`, `perspective?`, `activation?`): [`EffectTranslation`](../type-aliases/EffectTranslation.md)

Defined in: [cruncher/from-dsl.ts:173](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/from-dsl.ts#L173)

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

### activation?

#### usage?

`unknown`

#### cost?

`unknown`

#### optional?

`boolean`

#### duration?

`unknown`

## Returns

[`EffectTranslation`](../type-aliases/EffectTranslation.md)
