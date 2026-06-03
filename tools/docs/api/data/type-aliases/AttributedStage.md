[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AttributedStage

# Type Alias: AttributedStage

> **AttributedStage** = `object`

Defined in: [cruncher/attribution.ts:34](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L34)

A pipeline stage with its value decomposed across the toggleable buffs.

## Properties

### name

> **name**: [`Stage`](Stage.md)\[`"name"`\]

Defined in: [cruncher/attribution.ts:35](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L35)

***

### expected

> **expected**: `number`

Defined in: [cruncher/attribution.ts:37](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L37)

Stage value with every buff on — identical to [crunch](../functions/crunch.md)'s stage.

***

### detail

> **detail**: `string`

Defined in: [cruncher/attribution.ts:39](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L39)

The engine's stage detail string, unchanged.

***

### baseline

> **baseline**: `number`

Defined in: [cruncher/attribution.ts:41](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L41)

Stage value with all groupable buffs removed (intrinsics kept).

***

### lifts

> **lifts**: [`StageLift`](StageLift.md)[]

Defined in: [cruncher/attribution.ts:43](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L43)

Per-group marginal effect; groups whose |delta| ≤ epsilon are dropped.

***

### residual

> **residual**: `number`

Defined in: [cruncher/attribution.ts:49](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L49)

`expected − baseline − Σ lifts`. Non-zero when buffs collide under a cap
(two +1s sharing one ±1 cap each show ≈0 lift; the real +1 lands here),
so a UI can surface it honestly as "overlap (capped)".

***

### intrinsics

> **intrinsics**: `string`[]

Defined in: [cruncher/attribution.ts:51](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L51)

Active weapon-keyword ids (intrinsic, auto-injected); display-only.
