[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Piece

# Interface: Piece

Defined in: [generated.ts:915](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L915)

One terrain piece placed on the board. Geometry comes from a catalog `template` or an inline `footprint` (if both are present, `footprint` is authoritative and `template` is provenance).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "piece".

## Properties

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:919](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L919)

Kebab-case identifier

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:920](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L920)

***

### piece\_type?

> `optional` **piece\_type?**: `"area"` \| `"feature"`

Defined in: [generated.ts:924](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L924)

An `area` is a gameplay terrain zone (the 11e 'terrain area'); a `feature` is physical scenery (walls, containers, pipes) placed on an area.

***

### template?

> `optional` **template?**: `string`

Defined in: [generated.ts:928](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L928)

Kebab-case identifier

***

### footprint?

> `optional` **footprint?**: \{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"right-triangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"polygon"`; `points`: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]; \}

Defined in: [generated.ts:932](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L932)

Inline geometry, standing in for or overriding a template footprint. Authoritative when present.

#### Union Members

##### Type Literal

\{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \}

***

##### Type Literal

\{ `type`: `"right-triangle"`; `width`: `number`; `height`: `number`; \}

***

##### Type Literal

\{ `type`: `"polygon"`; `points`: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]; \}

##### type

> **type**: `"polygon"`

##### points

> **points**: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]

###### Min Items

3

***

### position

> **position**: [`Vec21`](Vec21.md)

Defined in: [generated.ts:950](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L950)

***

### rotation\_degrees?

> `optional` **rotation\_degrees?**: `number`

Defined in: [generated.ts:954](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L954)

Clockwise rotation about the centroid in the y-down board frame. Absent or 0 means the template's natural orientation.

***

### mirror?

> `optional` **mirror?**: `"none"` \| `"horizontal"` \| `"vertical"`

Defined in: [generated.ts:958](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L958)

Reflection applied in the centroid-local frame before rotation: `horizontal` negates local x (left-right flip), `vertical` negates local y.

***

### parent\_area\_id?

> `optional` **parent\_area\_id?**: `string`

Defined in: [generated.ts:962](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L962)

Kebab-case identifier

***

### floor?

> `optional` **floor?**: `number`

Defined in: [generated.ts:966](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L966)

Ruin floor this piece occupies (0 = ground level).

***

### height\_inches?

> `optional` **height\_inches?**: `number`

Defined in: [generated.ts:970](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L970)

Height of the piece in inches; overrides the template default. Gates Plunging Fire (a piece 3" or taller confers +1 BS on ground-level targets).

***

### terrain\_area\_keywords?

> `optional` **terrain\_area\_keywords?**: [`TerrainAreaKeyword`](../type-aliases/TerrainAreaKeyword.md)[]

Defined in: [generated.ts:974](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L974)

Terrain-area keywords this piece's area carries; overrides the template default.

***

### link\_group?

> `optional` **link\_group?**: `string`

Defined in: [generated.ts:978](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L978)

Pieces sharing a `link_group` value are linked terrain — treated as a single terrain feature (and, where an objective sits among them, a single objective).

***

### is\_objective?

> `optional` **is\_objective?**: `boolean`

Defined in: [generated.ts:982](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L982)

Whether this piece carries an objective marker.

***

### objective?

> `optional` **objective?**: `object`

Defined in: [generated.ts:986](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L986)

Objective-marker metadata. Only meaningful when `is_objective` is true.

#### position?

> `optional` **position?**: [`Vec22`](Vec22.md)

#### control\_range\_inches?

> `optional` **control\_range\_inches?**: `number`

Range from the marker within which models contribute to control.
