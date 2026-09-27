[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / DecodeResult

# Type Alias: DecodeResult

> **DecodeResult** = \{ `ok`: `true`; `list`: [`ShareList`](../interfaces/ShareList.md); \} \| \{ `ok`: `false`; `reason`: `"malformed"` \| `"stale-registry"`; \}

Defined in: [share/codec.ts:77](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L77)

Outcome of decodeShareList: a list, or why it couldn't be read.
