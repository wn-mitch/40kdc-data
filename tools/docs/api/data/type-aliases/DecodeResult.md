[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / DecodeResult

# Type Alias: DecodeResult

> **DecodeResult** = \{ `ok`: `true`; `list`: [`ShareList`](../interfaces/ShareList.md); \} \| \{ `ok`: `false`; `reason`: `"malformed"` \| `"stale-registry"`; \}

Defined in: [share/codec.ts:77](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/share/codec.ts#L77)

Outcome of decodeShareList: a list, or why it couldn't be read.
