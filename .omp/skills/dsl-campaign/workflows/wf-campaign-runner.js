import { canonicalJson, sha256 } from '../graph/canonical.js'
import { GraphStore } from '../graph/store.js'

export const STAGES = Object.freeze([
  'prioritize',
  'formalize',
  'retrieve-plan',
  'author',
  'verify',
  'audit',
  'family-apply',
  'close',
])

const STAGE_BY_TASK_KIND = Object.freeze({
  'prioritize-scout': 'prioritize',
  'prioritize-curate': 'prioritize',
  'source-retrieval': 'formalize',
  'source-formalization': 'formalize',
  'target-decomposition': 'formalize',
  'timing-decomposition': 'formalize',
  'effect-decomposition': 'formalize',
  'certified-retrieval': 'retrieve-plan',
  'construction-plan': 'retrieve-plan',
  author: 'author',
  verify: 'verify',
  audit: 'audit',
  'family-apply': 'family-apply',
  close: 'close',
})

const ACTIVE_TASK_STATES = new Set(['pending', 'ready', 'running'])
const UNSUCCESSFUL_TERMINAL_TASK_STATES = new Set(['failed-final', 'cancelled', 'stale', 'invalid-output'])
const TERMINAL_RUN_STATES = new Set(['completed', 'aborted', 'superseded', 'failed-final'])

function requireRunId(runId) {
  if (typeof runId !== 'string' || !/^c\d+$/.test(runId)) throw new TypeError('run_id must be a campaign id')
}

function parseTask(row) {
  let payload
  try { payload = JSON.parse(row.payload_json) } catch { throw new Error(`task payload malformed: ${row.id}`) }
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype || typeof payload.kind !== 'string' || !Array.isArray(payload.depends_on)) {
    throw new Error(`task definition malformed: ${row.id}`)
  }
  return { ...row, definition: payload }
}

function stageFor(task) {
  return STAGE_BY_TASK_KIND[task.definition.kind] ?? null
}

function dependenciesSealed(tasksById, task) {
  return task.definition.depends_on.every(id => {
    const dependency = tasksById.get(id)
    return dependency?.state === 'succeeded' && typeof dependency.node_id === 'string'
  })
}

function taskHasLiveExecution(store, task) {
  const attempt = store.db.prepare(`
    SELECT 1 FROM attempts
    WHERE run_id=? AND json_extract(payload_json, '$.task_id')=?
      AND state IN ('allocated', 'running')
    LIMIT 1
  `).get(task.run_id, task.id)
  if (attempt) return true
  return Boolean(store.db.prepare(`
    SELECT 1 FROM leases
    WHERE run_id=? AND json_extract(payload_json, '$.task_id')=?
      AND state IN ('allocated', 'active')
    LIMIT 1
  `).get(task.run_id, task.id))
}

function hasSucceededReplacement(tasks, task) {
  return tasks.some(replacement =>
    replacement.state === 'succeeded' &&
    replacement.definition.payload?.supersedes_task_id === task.id)
}

function terminalTaskBlockers(tasks) {
  return tasks
    .filter(task => UNSUCCESSFUL_TERMINAL_TASK_STATES.has(task.state) ||
      (task.state === 'superseded' && !hasSucceededReplacement(tasks, task)))
    .map(task => task.id)
}

function taskIsActionable(store, tasksById, task) {
  if (!ACTIVE_TASK_STATES.has(task.state)) return false
  if (task.state === 'pending') return dependenciesSealed(tasksById, task)
  if (task.state === 'running') return !taskHasLiveExecution(store, task)
  return true
}

function campaignState(run, tasks) {
  return {
    run_id: run.run_id,
    run_state: run.state,
    tasks: tasks.map(task => ({
      id: task.id,
      state: task.state,
      node_id: task.node_id,
      kind: task.definition.kind,
      depends_on: task.definition.depends_on,
    })),
  }
}

/**
 * Determine the next stage from durable task state without issuing a lease.
 * The persistent runner consumes this selection, so restart cannot make a human
 * select a stage or bypass its registered dependencies.
 */
export function nextCampaignStage(store, { run_id }) {
  requireRunId(run_id)
  const run = store.db.prepare('SELECT * FROM runs WHERE run_id=?').get(run_id)
  if (!run) throw new Error(`campaign not found: ${run_id}`)
  const tasks = store.db.prepare('SELECT * FROM tasks WHERE run_id=? ORDER BY id').all(run_id).map(parseTask)
  const state = campaignState(run, tasks)
  const state_digest = sha256(canonicalJson(state))

  if (TERMINAL_RUN_STATES.has(run.state)) {
    return { run_id, status: 'terminal', stage: null, task_ids: [], blocked_task_ids: [], state_digest }
  }
  switch (run.state) {
    case 'planned':
    case 'active':
      break
    case 'paused':
    case 'reconciliation-required':
      return { run_id, status: 'blocked', stage: null, task_ids: [], blocked_task_ids: [], state_digest }
    default:
      throw new Error(`campaign has unsupported state: ${run.state}`)
  }
  const terminalBlockers = terminalTaskBlockers(tasks)
  if (terminalBlockers.length) {
    return { run_id, status: 'blocked', stage: null, task_ids: [], blocked_task_ids: terminalBlockers, state_digest }
  }

  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const actionable = tasks.filter(task => taskIsActionable(store, tasksById, task))
  const unmapped = actionable.filter(task => !stageFor(task)).map(task => task.id)
  if (unmapped.length) {
    return { run_id, status: 'blocked', stage: null, task_ids: [], blocked_task_ids: unmapped, state_digest }
  }
  for (const stage of STAGES) {
    const task_ids = actionable.filter(task => stageFor(task) === stage).map(task => task.id)
    if (task_ids.length) return { run_id, status: 'ready', stage, task_ids, blocked_task_ids: [], state_digest }
  }

  const blocked_task_ids = tasks
    .filter(task => task.state === 'pending' || (task.state === 'running' && taskHasLiveExecution(store, task)))
    .map(task => task.id)
  return {
    run_id,
    status: blocked_task_ids.length ? 'waiting' : 'ready-to-close',
    stage: blocked_task_ids.length ? null : 'close',
    task_ids: [],
    blocked_task_ids,
    state_digest,
  }
}

function checkpointPayload(selection, observed) {
  return {
    ...selection,
    observed_sequence: observed.sequence,
    observed_hash: observed.checksum,
  }
}

/**
 * Persist the current state-machine selection as a hash-chained checkpoint.
 * A rerun after restart is idempotent until another graph event changes state.
 */
export function recordCampaignCheckpoint(store, { run_id }) {
  const selection = nextCampaignStage(store, { run_id })
  const checkpoint_id = `${run_id}:campaign-runner`
  const prior = store.verifyEvents()
  if (prior.sequence < 1) throw new Error('cannot checkpoint an empty graph')
  const existing = store.db.prepare('SELECT * FROM checkpoints WHERE id=?').get(checkpoint_id)
  const lastEvent = store.db.prepare('SELECT * FROM events ORDER BY sequence DESC LIMIT 1').get()
  const priorPayload = existing ? JSON.parse(existing.payload_json) : null
  if (priorPayload?.state_digest === selection.state_digest && lastEvent?.aggregate_kind === 'checkpoint' && lastEvent.aggregate_id === checkpoint_id) {
    return { ...selection, checkpoint_id, checkpoint_node_id: existing.node_id, recorded: false }
  }

  const payload = checkpointPayload(selection, prior)
  const checkpoint = store.createNode({ kind: 'checkpoint', payload })
  const eventPayload = {
    sequence: prior.sequence,
    hash: prior.checksum,
    projected_payload: payload,
  }
  if (!existing) {
    eventPayload.row = {
      id: checkpoint_id,
      run_id,
      state: 'none',
      node_id: checkpoint.node_id,
      payload,
    }
  }
  if (priorPayload) {
    eventPayload.previous_sequence = priorPayload.observed_sequence
    eventPayload.previous_hash = priorPayload.observed_hash
    eventPayload.expected_previous_hash = priorPayload.observed_hash
  }
  store.appendEvent('checkpoint-recorded', eventPayload, {
    aggregate_kind: 'checkpoint',
    aggregate_id: checkpoint_id,
    node_id: checkpoint.node_id,
  })
  return { ...selection, checkpoint_id, checkpoint_node_id: checkpoint.node_id, recorded: true }
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--run', '--graph'].includes(flag) || typeof value !== 'string') throw new Error('usage: wf-campaign-runner.js --run cNNN --graph <graph-root>')
    values.set(flag, value)
  }
  return { run_id: values.get('--run'), graph_root: values.get('--graph') }
}

if (import.meta.main) {
  const { run_id, graph_root } = parseArgs(process.argv.slice(2))
  const store = new GraphStore(graph_root)
  try {
    process.stdout.write(`${JSON.stringify(recordCampaignCheckpoint(store, { run_id }), null, 2)}\n`)
  } finally {
    store.close()
  }
}
