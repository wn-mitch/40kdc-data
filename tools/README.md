# @alpaca-software/40kdc-data

Published by [Alpaca Software](https://alpacasoft.dev).

The [40kdc](https://tabletop-developer-consortium.github.io) Warhammer 40,000
dataset behind a **linked, typed API**. Find a unit, then walk straight to its
weapons, abilities, the game phases those abilities act in, and its faction —
all strongly typed, all resolved for you.

The full dataset is embedded in the package, so there is no network call, no
database, and no filesystem access at runtime. It works the same in Node,
bundlers, and the browser.

```ts
import { units } from "@alpaca-software/40kdc-data";

units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("shooting"))
  .map(a => a.id); // ["berzerker-frenzy"]
```

## Install

```bash
npm install @alpaca-software/40kdc-data
```

## The shape

Top-level collections (`units`, `weapons`, `factions`, `abilities`,
`detachments`, `stratagems`, …) are accessors over a single embedded
[`Dataset`](docs/api/data/classes/Dataset.md). Each collection is iterable and
offers:

| Method | Returns |
| --- | --- |
| `.all` | every record (deduplicated) |
| `.get(id)` | one record by exact id |
| `.find(nameOrId)` | first match by id or name |
| `.findAll(nameOrId)` | every match (surfaces names shared across factions) |
| `.byFaction(id)` | records belonging to a faction |

Records resolve their links lazily:

- `unit.faction`, `unit.weapons`, `unit.abilities`
- `ability.phases` (joined from `phase-mappings`), `ability.units`
- `weapon.units`
- `faction.units`, `faction.abilities`, `faction.weapons`

The full underlying record is always available via `.raw`.

### Name matching is built for a global player base

Warhammer 40,000 is played worldwide, and many names carry diacritics or
punctuation — "Khârn the Betrayer", "T'au", "Be'lakor". `find`/`findAll` are
diacritic- and punctuation-insensitive, so `find("Kharn")` resolves "Khârn the
Betrayer" and `find("Belakor")` resolves "Be'lakor". The exact rule is exported
as `normalizeName` so you can reproduce it in your own search UI.

## API reference

Auto-generated from the source: [`docs/api/`](docs/api/README.md).

## Also: schema validation

This package also ships the canonical JSON Schemas and an AJV-based validator
(`createValidator`, `listSchemaIds`, and the `40kdc-validate` CLI) for checking
data against them. See the repository root for schema details.

## Licensing & attribution

- Code (`tools/`): **MIT**.
- Embedded enrichment data (`data/enrichment/`): **CC BY 4.0** —
  attribution: *40kdc community contributors*
  (<https://github.com/Tabletop-Developer-Consortium/40kdc-data>).
- JSON Schemas: **CC0**.

Stat lines and points are numerical facts. Ability and rules text are never
stored — abilities are community-authored structured mechanics (the Ability
DSL), not reproductions of copyrighted text.
