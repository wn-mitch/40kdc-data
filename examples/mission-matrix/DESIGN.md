# Design Brief — mission-matrix

A play-aid for 11th-edition Warhammer 40K missions: pick your Force Disposition
matchup to read your primary, then draw and score secondary mission cards when
no physical deck is on hand. Single-page Svelte app, dark-first, industrial.
This is the `product` register (the design serves the task; it is not the
product). Visual language is the shared **shadowboxing** dialect, ported from
`~/bevy-deploy-helper/site`.

## Tech Stack

- **Framework:** Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) + Vite 6
- **Styling:** Tailwind CSS v4 with `@theme` design tokens in `src/app.css`
- **Fonts:** Barlow Condensed (headings, uppercase, tracked), Barlow (body), JetBrains Mono (numbers/VP)
- **Data:** the embedded `@alpaca-software/40kdc-data` dataset + its card-driven scoring engine

## Design Tokens

Tailwind utilities generate from the `@theme` block (`bg-bg`, `text-text`,
`bg-accent`, `border-border`, `font-heading`, `shadow-md`, ...). Never hardcode
hex; always go through a token utility.

### Colors

```
--color-bg:                #0f0f11   page background
--color-surface:           #1b1b1f   raised pane fill
--color-border:            #2e2e34   dividers, outlines
--color-text:              #ededf0   primary text
--color-text-muted:        #a8a8b2   secondary text (AAA on bg)
--color-text-dim:          #8a8a94   tertiary text (AA on bg)
--color-accent:            #14b8a6   teal — the single accent
--color-accent-foreground: #0a1f1c   text on accent fill
--color-accent-dim:        #0d4a44   accent highlight backgrounds
```

Darker nested tier: `--color-panel #0c0c0e`, `--color-panel-surface #151517`,
`--color-panel-border #262629`, `--color-panel-hover #1e1e22`.
Semantic: `--color-success`, `--color-warning`, `--color-danger`.

Color strategy is **Restrained**: tinted near-black neutrals plus the teal
accent kept under ~10% of the surface. The accent marks the live selection, the
score total, and focus — nothing decorative.

### Typography

- Headings / labels: `font-heading`, `font-bold`, `uppercase`, `tracking-wider`.
- Body: `font-body`, `text-sm`/`text-xs` (compact, glanceable at the table).
- Numbers (VP, caps): `font-mono`, `tabular-nums` so columns of digits align.
- Hierarchy via scale + weight contrast, not color.

### Radius & Elevation

Angular: `--radius-sm 2px`, `--radius-md 4px` (default; use `rounded`),
`--radius-lg 8px` (floating overlays only). Never `rounded-lg` inline.
Elevation is the inset rim-lit `--shadow-sm` / `--shadow-md`, not flat drop
shadows. `.focus-ring` applies the 2px accent focus box.

## Layout

Three zones, glanceable on a phone at the table:

- **Primary + active secondary** stacked on the left (the cards you are reading).
- **Scorecard** centered: a compact VP ledger (primary, secondary, total) — a
  running tally, *not* a hero-metric big-number treatment.
- **Drawn-secondaries hand** on the right: drawn cards with remaining cap; tap to
  make one active and assert the awards you scored.

Collapses to a single column under ~560px (phone is the primary device). The
disposition matrix stays as the primary selector on wide screens; pill rows
replace it on phones.

## Anti-references / slop guards

- No hero gradients, illustrated empty states, or marketing copy — this is a
  utility for people who already know 40K.
- No equal-sized icon-plus-heading card grids. Cards here are literal game
  cards; never nest a card inside a card.
- No side-stripe borders, gradient text, or glassmorphism. No em dashes in copy.
- The category reflex for "dark tool" is generic teal-on-black SaaS; avoid it by
  keeping the accent scarce and letting the mono VP numbers and condensed
  headings carry the character.

## Voice

Terse, technical, present-tense. Numbers shown exactly. Labels are nouns
(`Secondary`, `Cap`, `Draw`), actions are verbs (`Score`, `Discard`, `Reset`).
