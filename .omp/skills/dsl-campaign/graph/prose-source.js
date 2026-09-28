import { join } from 'node:path'

/**
 * The private dump-prose export the graph reads rule text from: `<faction>.json` arrays of
 * `{ ability_id, raw_text | when/target/effect/restrictions, source }` entries plus an
 * `index.json` of `{ schema_version, factions: { <faction>: { <ability_id>: entry } } }`.
 * `npm run prose -- export` (tools/src/mfm/prose-cli.ts) writes it from `_private/dump.json`.
 */
export function proseRoot(repoRoot) {
  return join(repoRoot, '_private', 'prose')
}

