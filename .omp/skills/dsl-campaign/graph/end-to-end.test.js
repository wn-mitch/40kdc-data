import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { acceptIntake, prepareIntake } from './intake.js'
import { bootstrapRegistry, recoverLegacy } from './legacy.js'
import { projectRegistry, reconcileAbilityCatalog } from './projection.js'
import { nextCampaignId, prepareCampaign, readiness, startCampaign, supersedeCampaign } from './readiness.js'
import { wholeGraphPriorities } from './retrieval.js'
import { GraphStore } from './store.js'
import { repositoryVersionPayload } from './versions.js'
import { completeTask, issueReadyTask } from './scheduler.js'
import { sealOutput } from './workflow-lineage.js'

const repoRoot = resolve('.')
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile('_private/loop-state/claim-graph-intake-c004-c006-c008.json', 'utf8'))

function completeFixture() {
  const temp = mkdtempSync(join(tmpdir(), 'graph-e2e-'))
  const registryPath = join(temp, 'registry.json')
  copyFileSync('_private/loop-state/registry.json', registryPath)
  const store = new GraphStore(join(temp, 'graph'))
  bootstrapRegistry(store, { repoRoot, registryPath })
  const prepared = prepareIntake(store, { repoRoot, manifest })
  const outcomes = prepared.prepared.entries.map((entry, index) => ({
    faction_id: entry.faction_id, ability_id: entry.ability_id, envelope: entry.envelope,
    outcome: index === 1 ? 'represented-gap' : 'certified', reason: index === 1 ? 'known approximation remains represented' : 'fixture certification',
    source: { store_key: entry.ability_id, provenance: { kind: 'fixture' }, byte_hash: 'd'.repeat(64) },
    claims: [{ claim_occurrence_id: 'claim-1', actor: 'bearer', affected_entity: 'target', event: 'fixture', producer_ports: [], consumer_ports: [], polarity: 'positive', quantifier: 'one', timing: 'event', duration: 'instant', scope: 'unit', ordering: 'ordered', restrictions: [], exclusions: [] }],
    coverage: { covered_claim_occurrence_ids: ['claim-1'], required_checks: ['schema', 'policy'] }, unresolved_findings: [], approximation: index === 1,
  }))
  for (const entry of prepared.prepared.entries) for (const envelope of Object.values(entry.execution_envelopes)) {
    store.db.prepare("UPDATE tasks SET state='succeeded' WHERE id=?").run(envelope.task_id)
    store.db.prepare("UPDATE attempts SET state='succeeded' WHERE id=?").run(envelope.attempt_id)
    store.db.prepare("UPDATE leases SET state='released' WHERE id=?").run(envelope.lease_id)
  }
  acceptIntake(store, { repoRoot, result: { schema_version: 1, run_id: prepared.runId, manifest_hash: prepared.prepared.manifest_hash, outcomes } })
  recoverLegacy(store, { repoRoot })
  const repository = store.db.prepare("SELECT node_id FROM nodes WHERE kind='repository-version' ORDER BY rowid DESC LIMIT 1").get()
  reconcileAbilityCatalog(store, repoRoot, repository.node_id)
  const catalogVersion = store.db.prepare('SELECT repository_version_id FROM ability_catalog LIMIT 1').get()
  store.db.prepare(`
    INSERT INTO ability_catalog(faction_id,ability_id,ability_name,faction_name,repository_version_id)
    VALUES
      ('fixture-faction','fixture-ability','Fixture Ability','Fixture Faction',?),
      ('fixture-faction','other-ability','Other Ability','Fixture Faction',?)
  `).run(catalogVersion.repository_version_id, catalogVersion.repository_version_id)
  projectRegistry(store, registryPath)
  return { store, registryPath }
}

function sealCuration(store, campaignId, worklist = [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability' }]) {
  const task = store.db.prepare('SELECT payload_json FROM tasks WHERE id=?').get(`${campaignId}:prioritize:curate`)
  const issued = issueReadyTask(store, { run_id: campaignId, label: JSON.parse(task.payload_json).label, now: 1_800_000_000_000 })
  const sealed = sealOutput('prioritize-curate', {
    mode: 'curate',
    priorities: worklist.map(entry => ({ target: `${entry.faction_id}/${entry.ability_id}`, reason: 'fixture', expected_gain: 'fidelity' })),
  }, issued.envelope)
  const node = store.createNode({
    kind: sealed.kind,
    payload: sealed.payload,
    parents: sealed.parents,
    producer_contract_version: sealed.producer_contract_version,
  })
  completeTask(store, { envelope: issued.envelope, output_node_id: node.node_id, now: 1_800_000_000_001 })
}

function prepareFixtureCampaign(store, registryPath, campaignId) {
  const gate = readiness(store, { repoRoot, registryPath })
  assert.equal(gate.ready, true, gate.errors.join('; '))
  const result = prepareCampaign(store, {
    id: campaignId,
    repoRoot,
    registryPath,
    prioritizeInput: { worklist_cap: 1, scout_shapes: [], excluded_claims: gate.excluded_claims, artifacts: {} },
  })
  assert.equal(result.prepared, true, result.gate?.errors?.join('; '))
  sealCuration(store, campaignId)
  return result
}

test('fabricated full path reaches readiness and protects active claims', () => {
  const { store, registryPath } = completeFixture()
  const gate = readiness(store, { repoRoot, registryPath })
  assert.equal(gate.ready, true, gate.errors.join('; '))
  assert.equal(gate.next_campaign_id, nextCampaignId(store))
  assert.equal(gate.intake_outcomes, 12)
  assert.equal(gate.excluded_claims.filter(claim => claim.run_id === 'legacy-c005').length, 9)
  const campaignId = gate.next_campaign_id
  prepareFixtureCampaign(store, registryPath, campaignId)
  const worklist = [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability' }]
  const sequence = store.sequence()
  const dry = startCampaign(store, { id: campaignId, repoRoot, registryPath, worklist, dryRun: true })
  assert.equal(dry.dry_run, true)
  assert.equal(store.sequence(), sequence)
  assert.deepEqual(dry.dag.map(task => task.kind), [
    'source-retrieval', 'target-decomposition', 'timing-decomposition', 'effect-decomposition',
    'source-formalization', 'certified-retrieval', 'construction-plan', 'author', 'verify', 'audit',
  ])
  const overlap = startCampaign(store, { id: campaignId, repoRoot, registryPath, worklist: [{ faction_id: 'aeldari', ability_id: 'far-reaching-doom' }], dryRun: false })
  assert.equal(overlap.started, false)
  assert.match(overlap.gate.errors.join(' '), /overlaps active claims/)
  store.close()
})

test('campaign IDs advance after completed graph runs', () => {
  const { store } = completeFixture()
  const campaignId = nextCampaignId(store)
  const next = `c${(BigInt(campaignId.slice(1)) + 1n).toString().padStart(3, '0')}`
  store.db.prepare('INSERT INTO runs(run_id,campaign_id,state,kind,target) VALUES (?,?,?,?,?)')
    .run(campaignId, campaignId, 'completed', 'graph-backed', 'curated')
  assert.equal(nextCampaignId(store), next)
  store.db.prepare('INSERT INTO runs(run_id,campaign_id,state,kind,target) VALUES (?,?,?,?,?)')
    .run('large', 'c9007199254740993', 'completed', 'graph-backed', 'curated')
  assert.equal(nextCampaignId(store), 'c9007199254740994')
  store.close()
})

test('readiness warns about historical metadata gaps but rejects an unavailable worklist ability', () => {
  const { store, registryPath } = completeFixture()
  const referenced = store.db.prepare('SELECT faction_id,ability_id FROM node_ability_refs ORDER BY faction_id,ability_id LIMIT 1').get()
  store.db.prepare('DELETE FROM ability_catalog WHERE faction_id=? AND ability_id=?').run(referenced.faction_id, referenced.ability_id)
  const key = `${referenced.faction_id}/${referenced.ability_id}`

  const historical = readiness(store, { repoRoot, registryPath })
  assert.equal(historical.ready, true, historical.errors.join('; '))
  assert.ok(historical.missing_ability_metadata.includes(key))
  assert.deepEqual(historical.missing_required_ability_metadata, [])
  assert.ok(historical.warnings.some(warning => warning.includes('historical reference')))

  const required = readiness(store, { repoRoot, registryPath, worklist: [referenced] })
  assert.equal(required.ready, false)
  assert.ok(required.missing_required_ability_metadata.includes(key))
  assert.ok(required.errors.some(error => error.includes(`ability metadata missing: ${key}`)))

  const unavailable = { faction_id: 'missing-faction', ability_id: 'missing-ability' }
  const unavailableKey = `${unavailable.faction_id}/${unavailable.ability_id}`
  const unknown = readiness(store, { repoRoot, registryPath, worklist: [unavailable] })
  assert.equal(unknown.ready, false)
  assert.ok(unknown.missing_required_ability_metadata.includes(unavailableKey))
  assert.ok(unknown.errors.some(error => error.includes(`ability metadata missing: ${unavailableKey}`)))
  store.close()
})

test('non-dry start claims worklist and creates mandatory task DAG atomically', () => {
  const { store, registryPath } = completeFixture()
  const worklist = [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability' }]
  const campaignId = nextCampaignId(store)
  prepareFixtureCampaign(store, registryPath, campaignId)
  const started = startCampaign(store, { id: campaignId, repoRoot, registryPath, worklist, dryRun: false })
  assert.equal(started.started, true, started.gate?.errors?.join('; '))
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM claims WHERE run_id=? AND state='active'").get(campaignId).n, 1)
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks WHERE run_id=?').get(campaignId).n, 11)
  store.close()
})


test('start rejects a worklist that differs from sealed curation', () => {
  const { store, registryPath } = completeFixture()
  const campaignId = nextCampaignId(store)
  prepareFixtureCampaign(store, registryPath, campaignId)
  assert.throws(() => startCampaign(store, {
    id: campaignId,
    repoRoot,
    registryPath,
    worklist: [{ faction_id: 'fixture-faction', ability_id: 'other-ability' }],
    dryRun: true,
  }), /worklist differs from sealed campaign curation/)
  store.close()
})
test('superseding an unschedulable campaign releases its claims for a fresh successor', () => {
  const { store, registryPath } = completeFixture()
  const worklist = [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability' }]
  const campaignId = nextCampaignId(store)
  prepareFixtureCampaign(store, registryPath, campaignId)
  assert.equal(startCampaign(store, { id: campaignId, repoRoot, registryPath, worklist, dryRun: false }).started, true)
  const before = store.replayChecksum()
  const superseded = supersedeCampaign(store, {
    id: campaignId,
    reason: 'source-formalization-terminal-invalid-output',
    expected_replay_checksum: before,
    registryPath,
    now: '2026-08-25T00:00:00.000Z',
  })
  assert.deepEqual({ superseded: superseded.superseded, released_claims: superseded.released_claims }, { superseded: true, released_claims: 1 })
  assert.equal(store.db.prepare('SELECT state FROM runs WHERE run_id=?').get(campaignId).state, 'superseded')
  assert.equal(store.db.prepare('SELECT state FROM claims WHERE run_id=?').get(campaignId).state, 'released')
  assert.equal(supersedeCampaign(store, {
    id: campaignId,
    reason: 'source-formalization-terminal-invalid-output',
    expected_replay_checksum: store.replayChecksum(),
    registryPath,
  }).idempotent, true)

  const successorId = nextCampaignId(store)
  prepareFixtureCampaign(store, registryPath, successorId)
  assert.equal(startCampaign(store, { id: successorId, repoRoot, registryPath, worklist, dryRun: false }).started, true)
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM claims WHERE run_id=? AND state='active'").get(successorId).n, 1)
  store.close()
})

test('active lease excludes a start-campaign task after its claim is released', () => {
  const { store, registryPath } = completeFixture()
  const worklist = [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability' }]
  const campaignId = nextCampaignId(store)
  prepareFixtureCampaign(store, registryPath, campaignId)
  const started = startCampaign(store, { id: campaignId, repoRoot, registryPath, worklist, dryRun: false })
  assert.equal(started.started, true)
  store.db.prepare("UPDATE claims SET state='released' WHERE run_id=?").run(campaignId)
  const task = started.dag.find(item => item.payload.faction_id === 'fixture-faction' && item.payload.ability_id === 'fixture-ability')
  store.db.prepare('INSERT INTO attempts(id,run_id,state,payload_json) VALUES (?,?,?,?)').run('attempt-active', campaignId, 'running', '{}')
  const taskId = `${campaignId}:${task.label}`
  store.db.prepare('INSERT INTO leases(id,run_id,state,payload_json) VALUES (?,?,?,?)').run('lease-active', campaignId, 'active', JSON.stringify({ task_id: taskId, attempt_id: 'attempt-active', input_hash: 'a'.repeat(64), expires_at: new Date(Date.now() + 60_000).toISOString() }))
  const ranking = wholeGraphPriorities(store, {
    repoRoot,
    candidates: [{ faction_id: 'fixture-faction', ability_id: 'fixture-ability', effect: { type: 'invulnerable-save', target: 'unit', modifier: { invuln_sv: 5 } } }],
  })
  assert.equal(task.payload.faction_id, 'fixture-faction')
  assert.deepEqual(ranking.eligible, [])
  assert.equal(ranking.excluded[0].exclusion_reason, 'active-claim-or-lease')
  store.close()
})

test('repository identity ignores operating-system metadata files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'graph-version-'))
  const goRoot = join(temp, 'go')
  mkdirSync(goRoot, { recursive: true })
  writeFileSync(join(goRoot, 'version.go'), 'package gofixture\n')
  const before = repositoryVersionPayload(temp)
  writeFileSync(join(goRoot, '.DS_Store'), `volatile-${Date.now()}`)
  const after = repositoryVersionPayload(temp)
  assert.equal(after.workspace_hash, before.workspace_hash)
})
