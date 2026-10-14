[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ShareRegistry

# Interface: ShareRegistry

Defined in: [share/registry.ts:30](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/registry.ts#L30)

The committed registry artifact (mirrors `data/share-registry.json`).

## Properties

### version

> **version**: `number`

Defined in: [share/registry.ts:31](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/registry.ts#L31)

***

### kinds

> **kinds**: `Record`\<[`ShareKind`](../type-aliases/ShareKind.md), `string`[]\>

Defined in: [share/registry.ts:32](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/registry.ts#L32)

***

### aliases

> **aliases**: `Record`\<`string`, `string`\>

Defined in: [share/registry.ts:34](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/registry.ts#L34)

Rename map applied on decode: a retained (old) id → its current id.

***

### tombstones

> **tombstones**: `string`[]

Defined in: [share/registry.ts:36](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/registry.ts#L36)

Ids dropped from the dataset whose slots are retained for old tokens.
