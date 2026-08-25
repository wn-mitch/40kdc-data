import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { sha256 } from '../graph/canonical.js'
import { canonicalSourceText, persistClaimExtraction, persistSourceSnapshot } from '../graph/formalization.js'
import { authorizeClaimSet, persistRetrieval } from '../graph/retrieval.js'
import { completeTask, ensureTask, issueReadyTask } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'

const WORKFLOW = new URL('./wf-retrieve-plan-batch.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function loadWorkflow() {
  const source = readFileSync(WORKFLOW, 'utf8')
    .replace("import { completeTask, issueReadyTask } from '../graph/scheduler.js'\n", '')
    .replace("import { GraphStore } from '../graph/store.js'\n", '')
    .replace("import { authorizeClaimSet, persistRetrieval } from '../graph/retrieval.js'\n", '')
    .replaceAll('export const ', 'const ')
  return new AsyncFunction('args', 'completeTask', 'issueReadyTask', 'GraphStore', 'persistRetrieval', 'authorizeClaimSet', source)
}

function proposition() {
  return {
    schema_id: '40k.mechanic-claim',
    schema_version: '1',
    value: {
      predicate: 'mechanic.trigger',
      arguments: [{ role: 'event', value: 'command' }],
      qualifiers: [],
    },
  }
}

function extractionIdentity(sourceSnapshotId) {
  return {
    extractor_contract_version: '1',
    formalization_policy_version: '1',
    normalization_version: '1',
    extractor_implementation: 'fixture',
    extractor_identity: {
      kind: 'model',
      model_id: 'fixture/model@1',
      prompt_sha256: 'a'.repeat(64),
      output_schema_sha256: 'b'.repeat(64),
      agent_contract_id: 'fixture@1',
    },
    source_snapshot_id: sourceSnapshotId,
    ordered_parent_evidence_ids: [],
    lineage_root_origin_ids: [],
  }
}

function fixture({ unresolved = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wf-retrieve-plan-'))
  const graph = join(root, 'graph')
  const raw = join(root, 'raw')
  mkdirSync(raw)
  const ability = { faction_id: 'fixture-faction', ability_id: 'fixture-ability' }
  const text = 'Fabricated units act in the Command phase.'
  writeFileSync(join(raw, 'fixture-faction.json'), JSON.stringify([{
    ability_id: ability.ability_id,
    raw_text: text,
    source: { kind: 'json', ref: 'fabricated://fixture', edition: '11e', phases: ['Command'] },
  }]))

  const store = new GraphStore(graph)
  const repository = store.createNode({ kind: 'repository-version', payload: { workspace_hash: 'a'.repeat(64), files: [], tool_versions: {}, runner_hashes: [], schema_version: 4, policy_version: 2 } })
  const readiness = store.createNode({ kind: 'decision', payload: { state: 'answered' }, parents: [{ node_id: repository.node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} }] })
  store.appendEvent('run-created', { row: { run_id: 'run', campaign_id: 'run', state: 'planned', kind: 'graph-backed' }, repository_parent_node_id: repository.node_id, readiness_parent_node_id: readiness.node_id }, { aggregate_kind: 'run', aggregate_id: 'run', node_id: readiness.node_id })
  store.appendEvent('run-started', { expected_state: 'planned' }, { aggregate_kind: 'run', aggregate_id: 'run' })

  const prefix = `ability:${ability.faction_id}/${ability.ability_id}:initial`
  const sourceLabel = `${prefix}:source-retrieval`
  const formalizeLabel = `${prefix}:source-formalization`
  const retrievalLabel = `${prefix}:certified-retrieval`
  const planLabel = `${prefix}:construction-plan`
  ensureTask(store, { run_id: 'run', label: sourceLabel, kind: 'source-retrieval', payload: ability })
  const sourceEnvelope = issueReadyTask(store, { run_id: 'run', label: sourceLabel, now: Date.now() }).envelope
  const source = persistSourceSnapshot(store, {
    run_id: 'run', ...ability, envelope: sourceEnvelope, raw_store_root: raw,
    source_binding: { store_key: `${ability.faction_id}/${ability.ability_id}`, byte_hash: sha256(Buffer.from(text, 'utf8')) },
  })
  ensureTask(store, { run_id: 'run', label: formalizeLabel, kind: 'source-formalization', payload: ability })
  const formalizeEnvelope = issueReadyTask(store, { run_id: 'run', label: formalizeLabel, now: Date.now() }).envelope
  persistClaimExtraction(store, {
    run_id: 'run', ...ability, envelope: formalizeEnvelope, source_snapshot_node_id: source.source_node_id,
    raw_store_root: raw, extraction_identity: extractionIdentity(source.source_snapshot_id),
    assertions: [{
      extraction_local_id: 'trigger', proposition: proposition(), polarity: 'affirms', modality: 'asserted',
      evidence_bindings: [{ kind: 'source_span', start: 0, end: Buffer.from('Fabricated', 'utf8').length, coordinate_unit: 'utf8_byte' }],
    }],
    signatures: { aggregate: { actor: 'fabricated', affected_entity: null, event: 'command', duration: 'turn' }, assertions: [{ extraction_local_id: 'trigger', signature: { actor: 'fabricated', affected_entity: null, event: 'command', duration: 'turn' } }] },
    unresolved,
    completeness: { state: 'complete', obligations_checked: ['retrieve', 'represent'] },
  })
  ensureTask(store, { run_id: 'run', label: retrievalLabel, kind: 'certified-retrieval', depends_on: [`run:${formalizeLabel}`], payload: ability })
  ensureTask(store, { run_id: 'run', label: planLabel, kind: 'construction-plan', depends_on: [`run:${retrievalLabel}`], payload: ability })
  store.close()
  return { graph, ability }
}

test('advances a certified source claim set to a direct ready construction plan idempotently', async () => {
  const value = fixture()
  const run = loadWorkflow()
  const args = { run_id: 'run', graph_root: value.graph, abilities: [value.ability] }
  const first = await run(args, completeTask, issueReadyTask, GraphStore, persistRetrieval, authorizeClaimSet)
  assert.equal(first.results[0].status, 'ready-for-authoring')
  assert.equal(first.results[0].retrieval_advanced, true)
  assert.equal(first.results[0].construction_advanced, true)
  assert.deepEqual(first.results[0].selected_evidence_node_ids, [])
  assert.deepEqual(first.results[0].unmatched_claim_occurrence_ids, [])

  const store = new GraphStore(value.graph)
  const before = store.sequence()
  for (const suffix of ['certified-retrieval', 'construction-plan']) {
    const task = store.db.prepare('SELECT state,node_id FROM tasks WHERE id=?').get(`run:ability:${value.ability.faction_id}/${value.ability.ability_id}:initial:${suffix}`)
    assert.deepEqual(task.state, 'succeeded')
    assert.equal(task.node_id, first.results[0].construction_plan_node_id)
  }
  store.close()

  const second = await run(args, completeTask, issueReadyTask, GraphStore, persistRetrieval, authorizeClaimSet)
  assert.equal(second.results[0].status, 'ready-for-authoring')
  assert.equal(second.results[0].retrieval_advanced, false)
  assert.equal(second.results[0].construction_advanced, false)
  const replay = new GraphStore(value.graph)
  assert.equal(replay.sequence(), before)
  replay.close()
})

test('uses an explicit reusable source certificate when no local formalization task exists', async () => {
  const value = fixture()
  const store = new GraphStore(value.graph)
  const initial = `run:ability:${value.ability.faction_id}/${value.ability.ability_id}:initial`
  const certificate = store.db.prepare('SELECT node_id FROM tasks WHERE id=?').get(`${initial}:source-formalization`).node_id
  const generation = 'family-reuse'
  const prefix = `ability:${value.ability.faction_id}/${value.ability.ability_id}:${generation}`
  ensureTask(store, {
    run_id: 'run',
    label: `${prefix}:certified-retrieval`,
    kind: 'certified-retrieval',
    payload: { ...value.ability, input_node_ids: [certificate] },
  })
  ensureTask(store, {
    run_id: 'run',
    label: `${prefix}:construction-plan`,
    kind: 'construction-plan',
    depends_on: [`run:${prefix}:certified-retrieval`],
    payload: value.ability,
  })
  store.close()

  const run = loadWorkflow()
  const result = await run(
    { run_id: 'run', graph_root: value.graph, abilities: [{ ...value.ability, generation }] },
    completeTask,
    issueReadyTask,
    GraphStore,
    persistRetrieval,
    authorizeClaimSet,
  )
  assert.equal(result.results[0].status, 'ready-for-authoring')
  assert.equal(result.results[0].claim_set_certificate_node_id, certificate)
})

test('persists a blocked plan and pauses before authoring', async () => {
  const value = fixture()
  const persistBlockedPlan = (store, input) => {
    const plan = {
      faction_id: input.faction_id,
      ability_id: input.ability_id,
      claim_set_id: 'fixture-claim-set',
      selected_evidence_node_ids: [],
      covered_claim_occurrence_ids: [],
      unmatched_claim_occurrence_ids: ['unresolved'],
      state: 'blocked',
      blocking_unresolved_keys: ['unresolved'],
      rejected_conflicts: [],
      substitutions: [],
      composition_seams: [],
      required_checks: [],
    }
    const node = store.createNode({ kind: 'construction-plan', payload: plan })
    return { plan_node_id: node.node_id, plan }
  }
  const run = loadWorkflow()
  const result = await run(
    { run_id: 'run', graph_root: value.graph, abilities: [value.ability] },
    completeTask,
    issueReadyTask,
    GraphStore,
    persistBlockedPlan,
    authorizeClaimSet,
  )
  assert.equal(result.results[0].status, 'blocked')
  assert.equal(result.results[0].retrieval_advanced, false)
  assert.equal(result.results[0].construction_advanced, false)

  const store = new GraphStore(value.graph)
  const prefix = `run:ability:${value.ability.faction_id}/${value.ability.ability_id}:initial`
  assert.equal(store.db.prepare('SELECT state FROM runs WHERE run_id=?').get('run').state, 'paused')
  assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(`${prefix}:certified-retrieval`).state, 'ready')
  assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(`${prefix}:construction-plan`).state, 'pending')
  assert.equal(store.db.prepare('SELECT state FROM decisions WHERE id=?').get(`run:${value.ability.faction_id}/${value.ability.ability_id}:construction-plan-blocked`).state, 'open')
  store.close()
})
