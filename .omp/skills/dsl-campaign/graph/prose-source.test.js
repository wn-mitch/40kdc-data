import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import { resolveSourceBinding } from './formalization.js'
import { proseRoot } from './prose-source.js'
import { prohibitedStoreStrings } from './workflow-lineage.js'

test('the prose export lives under the repo\'s git-ignored _private/ tree', () => {
  assert.equal(relative('/repo', proseRoot('/repo')), join('_private', 'prose'))
})

test('the graph reads the export shape prose-cli writes: faction arrays and a factions index', () => {
  const repo = mkdtempSync(join(tmpdir(), 'prose-source-'))
  try {
    const root = proseRoot(repo)
    mkdirSync(root, { recursive: true })
    const entry = { ability_id: 'helix-test', faction_id: 'fabricated', raw_text: 'Fabricated rule text for the export shape.', source: { kind: 'mfm', ref: 'dump.json#row-1', edition: '11e' } }
    writeFileSync(join(root, 'fabricated.json'), JSON.stringify([entry]))
    writeFileSync(join(root, 'index.json'), JSON.stringify({ schema_version: 1, source: 'mfm-dump', factions: { fabricated: { 'helix-test': entry } } }))
    assert.equal(resolveSourceBinding(root, 'fabricated', 'helix-test').store_key, 'fabricated/helix-test')
    assert.deepEqual(prohibitedStoreStrings(root).map(item => item.store_key), ['fabricated/helix-test'])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
