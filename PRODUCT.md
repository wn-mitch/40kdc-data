# 40kdc-data — Product

## Register
product

## Users
- **Schema consumers**: Rust + TS developers building Warhammer 40K tools (list
  builders, damage calculators, roster importers) who depend on
  `@alpaca-software/40kdc-data` or the `wh40kdc` crate to skip rebuilding
  datasheet plumbing from scratch.
- **Enrichment authors**: community contributors hand-encoding ability
  mechanics in the DSL — they live in JSON, value editor ergonomics over
  visual flourish, and care that their schemas validate.
- **Salvo end-users**: 40K players using the example damage calculator to
  answer "what happens if X shoots Y?" mid-game or pre-game — phone first,
  desktop second, attention partial, hands often otherwise occupied.

## Product purpose
Ship the canonical schema layer plus a typed, linked dataset for community 40K
tooling, and prove the package's surface area through a small set of example
apps. Salvo is the headline example: a Warhammer 40K 11th-edition damage
calculator that exercises the dataset's units / weapons / abilities / phases
end-to-end through one focused user task — projecting a shooting or melee
salvo's expected damage against a target.

## Strategic principles
- **Data first, app second**: the package is the product. Examples exist to
  validate the API, not the other way around. Don't let UI requirements bleed
  back into schema decisions.
- **Mechanics, never text**: numeric facts are fair game; GW prose is not. The
  DSL is the medium for ability meaning.
- **Linked, not duplicated**: every entity carries a `game_version` and refs;
  one source of truth, many tools.
- **Tools share a dialect**: when an example app needs a visual language, it
  reaches for the shadowboxing dialect (industrial near-black, teal accent,
  inset rim-lit elevation) shared with sibling apps so they feel
  like one product family.

## Anti-references
- **Battlescribe-era list builders**: dense gridded tables, every keyword in a
  pill, modal-on-modal UX. Salvo is for *one* question at a time, not for
  authoring a list.
- **Brand-heavy SaaS chrome**: hero gradients, illustrated empty states,
  marketing-flavored copy. The package and Salvo are utilities for people who
  already know 40K.
- **Generic "AI dashboard" cards**: equal-sized icon-plus-heading grids with no
  hierarchy. Salvo's projection table is the hero; everything else is setup.

## Voice
Terse, technical, present-tense. Status verbs over adjectives. Numbers shown
exactly, not rounded with marketing language. Errors are diagnostic
("ListForge URL decoded but no units matched"), not apologetic.
