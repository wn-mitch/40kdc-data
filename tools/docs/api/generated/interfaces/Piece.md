[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Piece

# Interface: Piece

Defined in: [generated.ts:3484](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3484)

One terrain piece placed on the board. Geometry comes from a catalog `template` or an inline `footprint` (if both are present, `footprint` is authoritative and `template` is provenance).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "piece".

## Properties

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:3488](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3488)

Kebab-case identifier

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:3489](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3489)

***

### piece\_type?

> `optional` **piece\_type?**: `"area"` \| `"feature"`

Defined in: [generated.ts:3493](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3493)

An `area` is a gameplay zone with extent (an 11e 'terrain area' by default; set `terrain: false` for an EMPTY area such as a bare objective marker); a `feature` is physical scenery (walls, containers, pipes) placed on an area.

***

### terrain?

> `optional` **terrain?**: `boolean`

Defined in: [generated.ts:3497](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3497)

Whether this area is gameplay terrain — an 11e terrain area that confers cover / area-terrain rules. `false` marks an EMPTY area: it still has a footprint (extent, for measurement and control-range display) but is not terrain and grants no cover, e.g. a 10th-edition objective marker sitting on open ground. Only meaningful for `area` pieces; absent means true (a terrain area). This is the data signal that distinguishes a 10th-style bare objective marker from an 11th objective embedded in a terrain area.

***

### template?

> `optional` **template?**: `string`

Defined in: [generated.ts:3501](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3501)

Kebab-case identifier

***

### footprint?

> `optional` **footprint?**: \{ `type`: `"rectangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"right-triangle"`; `width`: `number`; `height`: `number`; \} \| \{ `type`: `"polygon"`; `points`: \[[`Vec2`](Vec2.md), [`Vec2`](Vec2.md), [`Vec2`](Vec2.md), `...Vec2[]`\]; \}

Defined in: [generated.ts:3505](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3505)

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

Defined in: [generated.ts:3523](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3523)

***

### rotation\_degrees?

> `optional` **rotation\_degrees?**: `number`

Defined in: [generated.ts:3527](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3527)

Clockwise rotation about the centroid in the y-down board frame. Absent or 0 means the template's natural orientation.

***

### mirror?

> `optional` **mirror?**: `"none"` \| `"horizontal"` \| `"vertical"`

Defined in: [generated.ts:3531](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3531)

Reflection applied in the centroid-local frame before rotation: `horizontal` negates local x (left-right flip), `vertical` negates local y.

***

### parent\_area\_id?

> `optional` **parent\_area\_id?**: `string`

Defined in: [generated.ts:3535](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3535)

Kebab-case identifier

***

### floor?

> `optional` **floor?**: `number`

Defined in: [generated.ts:3539](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3539)

Ruin floor this piece occupies (0 = ground level).

***

### height\_inches?

> `optional` **height\_inches?**: `number`

Defined in: [generated.ts:3543](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3543)

Height of the piece in inches; overrides the template default. Gates Plunging Fire (a piece 3" or taller confers +1 BS on ground-level targets).

***

### terrain\_area\_keywords?

> `optional` **terrain\_area\_keywords?**: [`TerrainAreaKeyword`](../type-aliases/TerrainAreaKeyword.md)[]

Defined in: [generated.ts:3547](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3547)

Terrain-area keywords this piece's area carries; overrides the template default.

***

### link\_group?

> `optional` **link\_group?**: `string`

Defined in: [generated.ts:3551](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3551)

Pieces sharing a `link_group` value are linked terrain — treated as a single terrain feature (and, where an objective sits among them, a single objective).

***

### objective\_role?

> `optional` **objective\_role?**: `"expansion"` \| `"home"` \| `"center"`

Defined in: [generated.ts:3555](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3555)

Designates this terrain area — or, when `link_group`'d, the union of linked areas (one objective for the set) — as carrying an objective of the given 11e role: `home` (inside a deployment zone), `center` (board middle), or `expansion` (no-man's-land). Implies `is_objective`.

***

### is\_objective?

> `optional` **is\_objective?**: `boolean`

Defined in: [generated.ts:3559](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3559)

Whether this piece carries an objective marker.

***

### objective?

> `optional` **objective?**: `object`

Defined in: [generated.ts:3563](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3563)

Objective-marker metadata. Only meaningful when `is_objective` is true.

#### position?

> `optional` **position?**: [`Vec22`](Vec22.md)

#### control\_range\_inches?

> `optional` **control\_range\_inches?**: `number`

Range from the marker within which models contribute to control.

***

### keystones?

> `optional` **keystones?**: `object`[]

Defined in: [generated.ts:3573](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3573)

Measurement keystones: the author-selected dimension lines a reference card prints so a player can place this piece with a tape measure (board edge → a feature of the placed piece). Only the selection is stored — the distance is always DERIVED from the resolved geometry by the shared keystone resolver (pinned by the conformance corpus), so a keystone can never disagree with the layout. Vertex indices follow the resolver's pinned vertex order; re-authoring a template's footprint invalidates them, so review keystones when geometry changes.

#### edge

> **edge**: `"left"` \| `"right"` \| `"top"` \| `"bottom"`

The board edge the measurement runs from, in the y-down board frame (left/right pin x against board width; top/bottom pin y against board height).

#### ref

> **ref**: \{ `kind`: `"vertex"`; `index`: `number`; \} \| \{ `kind`: `"face"`; `side`: `"min-x"` \| `"max-x"` \| `"min-y"` \| `"max-y"`; \}

Which feature of the placed piece the measurement reaches: a footprint vertex (by resolver vertex order) or an axis-aligned bounding face of the placed footprint.
