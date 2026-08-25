import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { abilityCampaignDag } from '../graph/readiness.js'
import { completeTask, ensureTask, issueReadyTask, recordRetryableFailure } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'
import { nextCampaignStage, recordCampaignCheckpoint } from './wf-campaign-runner.js'

function fixture(runId = 'c999') {
  const root = mkdtempSync(join(tmpdir(), 'campaign-runner-'))
  const store = new GraphStore(root)
  const repository = store.createNode({ kind: 'repository-version', payload: { workspace_hash: 'a'.repeat(64), files: [], tool_versions: {}, runner_hashes: [], schema_version: 3, policy_version: 2 } })
  const readiness = store.createNode({
    kind: 'decision',
    payload: { state: 'answered' },
    parents: [{ node_id: repository.node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} }],
  })
  store.appendEvent('run-created', {
    row: { run_id: runId, campaign_id: runId, state: 'planned', kind: 'graph-backed' },
    repository_parent_node_id: repository.node_id,
    readiness_parent_node_id: readiness.node_id,
  }, { aggregate_kind: 'run', aggregate_id: runId, node_id: readiness.node_id })
  store.appendEvent('run-started', { expected_state: 'planned' }, { aggregate_kind: 'run', aggregate_id: runId })
  return { root, store, runId }
}

function output(store, envelope, marker) {
  return store.createNode({
    kind: 'finding',
    payload: { state: 'resolved', marker },
    parents: envelope.input_node_ids.map(node_id => ({ node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} })),
  })
}

test('campaign runner dispatches prepared curation before authoring stages', () => {
  const { store, runId } = fixture()
  const task = ensureTask(store, { run_id: runId, label: 'prioritize:curate', kind: 'prioritize-curate' })
  const next = nextCampaignStage(store, { run_id: runId })
  assert.equal(next.stage, 'prioritize')
  assert.deepEqual(next.task_ids, [task.id])
  store.close()
})

test('campaign runner chooses the earliest dependency-ready stage and checkpoints it', () => {
  const { store, runId } = fixture()
  const formalize = ensureTask(store, { run_id: runId, label: 'ability:fixture/army-rule:source-formalization', kind: 'source-formalization' })
  ensureTask(store, {
    run_id: runId,
    label: 'ability:fixture/army-rule:author',
    kind: 'author',
    depends_on: [formalize.id],
  })

  assert.deepEqual(nextCampaignStage(store, { run_id: runId }), {
    run_id: runId,
    status: 'ready',
    stage: 'formalize',
    task_ids: [formalize.id],
    blocked_task_ids: [],
    state_digest: nextCampaignStage(store, { run_id: runId }).state_digest,
  })

  const initial = recordCampaignCheckpoint(store, { run_id: runId })
  assert.equal(initial.stage, 'formalize')
  assert.equal(initial.recorded, true)
  assert.equal(store.db.prepare('SELECT state FROM checkpoints WHERE id=?').get(initial.checkpoint_id).state, 'recorded')
  assert.equal(recordCampaignCheckpoint(store, { run_id: runId }).recorded, false)

  const issued = issueReadyTask(store, { run_id: runId, label: 'ability:fixture/army-rule:source-formalization', now: 1_800_000_000_000 })
  const node = output(store, issued.envelope, 'formalized')
  completeTask(store, { envelope: issued.envelope, output_node_id: node.node_id, now: 1_800_000_000_001 })

  const next = recordCampaignCheckpoint(store, { run_id: runId })
  assert.equal(next.stage, 'author')
  assert.equal(next.recorded, true)
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE aggregate_kind='checkpoint'").get().n, 2)
  store.close()
})

test('campaign runner dispatches ready source retrieval to formalization', () => {
  const { store, runId } = fixture()
  const source = ensureTask(store, {
    run_id: runId,
    label: 'ability:fixture/army-rule:source-retrieval',
    kind: 'source-retrieval',
  })
  ensureTask(store, {
    run_id: runId,
    label: 'ability:fixture/army-rule:source-formalization',
    kind: 'source-formalization',
    depends_on: [source.id],
  })

  const next = nextCampaignStage(store, { run_id: runId })
  assert.equal(next.status, 'ready')
  assert.equal(next.stage, 'formalize')
  assert.deepEqual(next.task_ids, [source.id])
  store.close()
})

test('campaign runner restart reuses an unchanged durable checkpoint', () => {
  const { root, store, runId } = fixture()
  ensureTask(store, { run_id: runId, label: 'ability:fixture/army-rule:source-formalization', kind: 'source-formalization' })
  const beforeRestart = recordCampaignCheckpoint(store, { run_id: runId })
  const sequence = store.sequence()
  store.close()

  const resumed = new GraphStore(root)
  const afterRestart = recordCampaignCheckpoint(resumed, { run_id: runId })
  assert.equal(afterRestart.recorded, false)
  assert.equal(afterRestart.checkpoint_node_id, beforeRestart.checkpoint_node_id)
  assert.equal(resumed.sequence(), sequence)
  resumed.close()
})

test('campaign runner resumes decomposition tasks registered by the ability DAG', () => {
  const { store, runId } = fixture()
  const dag = abilityCampaignDag({
    faction_id: 'fixture',
    ability_id: 'army-rule',
    generation: 'initial',
    source_binding: { store_key: 'fixture/army-rule', byte_hash: 'a'.repeat(64) },
  })
  const tasks = new Map()
  for (const entry of dag) {
    const task = ensureTask(store, {
      run_id: runId,
      label: entry.label,
      kind: entry.kind,
      depends_on: entry.depends_on.map(label => tasks.get(label).id),
      payload: entry.payload,
    })
    tasks.set(entry.label, task)
  }
  const source = tasks.get('ability:fixture/army-rule:initial:source-retrieval')
  const issued = issueReadyTask(store, { run_id: runId, label: source.payload.label, now: 1_800_000_000_000 })
  completeTask(store, { envelope: issued.envelope, output_node_id: output(store, issued.envelope, 'source').node_id, now: 1_800_000_000_001 })

  const next = nextCampaignStage(store, { run_id: runId })
  assert.equal(next.stage, 'formalize')
  assert.deepEqual(next.task_ids, ['who', 'when', 'what'].map(suffix => tasks.get(`ability:fixture/army-rule:initial:${suffix}`).id).sort())
  store.close()
})

test('campaign runner waits for a live task and resumes after a retryable failure', () => {
  const { store, runId } = fixture()
  const task = ensureTask(store, { run_id: runId, label: 'ability:fixture/army-rule:source-formalization', kind: 'source-formalization' })
  const issued = issueReadyTask(store, { run_id: runId, label: task.payload.label, now: 1_800_000_000_000 })
  const waiting = nextCampaignStage(store, { run_id: runId })
  assert.equal(waiting.status, 'waiting')
  assert.deepEqual(waiting.blocked_task_ids, [task.id])

  recordRetryableFailure(store, { envelope: issued.envelope, reason: 'fixture', now: 1_800_000_000_001 })
  const resumed = nextCampaignStage(store, { run_id: runId })
  assert.equal(resumed.stage, 'formalize')
  assert.deepEqual(resumed.task_ids, [task.id])
  store.close()
})

test('campaign runner blocks unsuccessful terminal tasks but accepts a completed replacement', () => {
  for (const [event, state] of [
    ['task-failed-final', 'failed-final'],
    ['task-cancelled', 'cancelled'],
    ['task-stale', 'stale'],
    ['task-invalid-output', 'invalid-output'],
  ]) {
    const { store, runId } = fixture()
    const task = ensureTask(store, { run_id: runId, label: `fixture:${state}`, kind: 'audit' })
    const issued = issueReadyTask(store, { run_id: runId, label: task.payload.label, now: 1_800_000_000_000 })
    store.appendEvent(event, { expected_state: 'running' }, { aggregate_kind: 'task', aggregate_id: task.id })
    const blocked = nextCampaignStage(store, { run_id: runId })
    assert.equal(blocked.status, 'blocked')
    assert.deepEqual(blocked.blocked_task_ids, [task.id])
    assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(task.id).state, state)
    assert.equal(issued.envelope.task_id, task.id)
    store.close()
  }

  const { store, runId } = fixture()
  const original = ensureTask(store, { run_id: runId, label: 'fixture:original', kind: 'audit' })
  store.appendEvent('task-superseded', { expected_state: 'ready' }, { aggregate_kind: 'task', aggregate_id: original.id })
  const replacement = ensureTask(store, {
    run_id: runId,
    label: 'fixture:replacement',
    kind: 'audit',
    payload: { supersedes_task_id: original.id },
  })
  const issued = issueReadyTask(store, { run_id: runId, label: replacement.payload.label, now: 1_800_000_000_000 })
  completeTask(store, { envelope: issued.envelope, output_node_id: output(store, issued.envelope, 'replacement').node_id, now: 1_800_000_000_001 })
  assert.equal(nextCampaignStage(store, { run_id: runId }).status, 'ready-to-close')
  store.close()
})

test('campaign runner dispatches family apply after audit', () => {
  const { store, runId } = fixture()
  const task = ensureTask(store, { run_id: runId, label: 'family:fixture:apply', kind: 'family-apply' })
  const next = nextCampaignStage(store, { run_id: runId })
  assert.equal(next.stage, 'family-apply')
  assert.deepEqual(next.task_ids, [task.id])
  store.close()
})
