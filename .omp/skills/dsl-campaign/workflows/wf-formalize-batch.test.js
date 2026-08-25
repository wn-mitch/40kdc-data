import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { canonicalSourceText, persistClaimExtraction, persistSourceSnapshot, resolveSourceBinding } from '../graph/formalization.js'
import { MECHANIC_REGISTRY, mechanicClaimAdapter } from '../graph/mechanic-claims.js'
import { completeTask, ensureTask, failTask, issueReadyTask, recordRetryableFailure } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'
const WORKFLOW = new URL('./wf-formalize-batch.js', import.meta.url)

function loadWorkflow() {
  const source = readFileSync(WORKFLOW, 'utf8')
    .replace(/import \{ readFileSync \} from 'node:fs'\n/, '')
    .replace(/import \{ join \} from 'node:path'\n/, '')
    .replace(/import \{\n[\s\S]*?\n\} from '\.\.\/graph\/formalization\.js'\n/, '')
    .replace(/import \{ MECHANIC_REGISTRY, mechanicClaimAdapter \} from '\.\.\/graph\/mechanic-claims\.js'\n/, '')
    .replace(/import \{ failTask, ensureTask, issueReadyTask, recordRetryableFailure \} from '\.\.\/graph\/scheduler\.js'\n/, '')
    .replace(/import \{ GraphStore \} from '\.\.\/graph\/store\.js'\n/, '')
    .replace(/import \{ createTrustedAgent \} from '\.\.\/graph\/workflow-runtime\.js'\n/, '')
    .replaceAll('export const ', 'const ')
  return new (Object.getPrototypeOf(async function () {}).constructor)(
    'args', 'agent', 'pipeline', 'parallel', 'log', 'readFileSync', 'join',
    'canonicalSourceText', 'resolveSourceBinding', 'persistSourceSnapshot', 'persistClaimExtraction', 'MECHANIC_REGISTRY', 'mechanicClaimAdapter',
    'failTask', 'ensureTask', 'issueReadyTask', 'recordRetryableFailure', 'GraphStore', 'createTrustedAgent', source,
  )
}

const model_identities = { who: 'fixture/who@1', when: 'fixture/when@1', what: 'fixture/what@1', formalizer: 'fixture/formalizer@1' }
const ability = { faction_id: 'fixture-faction', ability_id: 'fixture-ability' }
const sourceText = 'When this fabricated ability is selected, its friendly unit gains +1 Move until end of turn.'

function formalOutput({ legacy = false } = {}) {
  const assertion = {
    extraction_local_id: 'modifier',
    proposition: { schema_id: '40k.mechanic-claim', schema_version: '1', value: { predicate: 'mechanic.trigger', arguments: [], qualifiers: [] } },
    polarity: 'affirms', modality: 'asserted',
    evidence_bindings: [{ kind: 'source_span', start: 0, end: Buffer.byteLength(sourceText), coordinate_unit: 'utf8_byte' }],
    derivation_parent_labels: [],
  }
  if (legacy) assertion.claim_id = 'legacy-claim-id'
  return {
    clauses: [{ extraction_local_id: 'whole-source', start: 0, end: Buffer.byteLength(sourceText) }],
    assertions: [assertion],
    unresolved: [{ extraction_local_id: 'uncertain-duration', extraction_local_focus: ['modifier'], kind: 'ambiguous', evidence_bindings: [], candidate_local_labels: ['modifier'], blocks_obligations: ['represent'] }],
    signatures: { aggregate: {}, assertions: [{ extraction_local_id: 'modifier', signature: {} }] },
    completeness: { state: 'disputed', obligations_checked: ['represent'] },
  }
}

function harness({ legacy = false } = {}) {
  const calls = []
  const persisted = []
  const sourceSnapshots = []
  class Store { close() {} }
  const sourceNode = 'source-node'
  const helpers = { who: 'who-node', when: 'when-node', what: 'what-node' }
  const graphAgent = async (prompt, options) => {
    assert.equal(sourceSnapshots.length, 1, 'source snapshot must exist before any model invocation')
    calls.push({ prompt, options })
    if (options.label.endsWith(':who')) return { sealed_output_node_id: helpers.who }
    if (options.label.endsWith(':when')) return { sealed_output_node_id: helpers.when }
    if (options.label.endsWith(':what')) return { sealed_output_node_id: helpers.what }
    return {
      ...formalOutput({ legacy }), execution_envelope: { input_node_ids: [helpers.who, helpers.when, helpers.what] },
      execution_identity: { model_id: model_identities.formalizer, prompt_sha256: 'p'.repeat(64), output_schema_sha256: 's'.repeat(64), agent_contract_id: 'inquisitor@1' },
    }
  }
  return {
    calls, persisted, sourceSnapshots,
    dependencies: {
      readFileSync: () => JSON.stringify([{ ...ability, raw_text: sourceText }]), join: (...parts) => parts.join('/'),
      canonicalSourceText: entry => entry.raw_text,
      resolveSourceBinding: () => ({ store_key: 'fixture-faction/fixture-ability', byte_hash: 'b'.repeat(64) }),
      persistSourceSnapshot: (_store, value) => { sourceSnapshots.push(value); return { source_snapshot_id: 'snapshot-id', source_node_id: sourceNode } },
      persistClaimExtraction: (_store, value) => {
        if (value.assertions.some(assertion => 'claim_id' in assertion)) throw new TypeError('claim_id is not allowed in v1 extraction')
        persisted.push(value)
        return { extraction_id: 'extraction-id', claim_set_id: 'claim-set-id', certificate_node_id: 'certificate-node' }
      },
      failTask: () => {}, ensureTask: () => {}, issueReadyTask: () => ({ issued: true, envelope: { input_node_ids: [] } }), recordRetryableFailure: () => {}, GraphStore: Store,
      createTrustedAgent: () => graphAgent,
    },
  }
}

async function run(value, overrides = {}) {
  const deps = value.dependencies
  return loadWorkflow()(
    { repo_root: '/repo', graph_root: '/graph', run_id: 'run', raw_store_root: '/raw', model_identities, abilities: [ability], ...overrides },
    () => { throw new Error('raw agent must be wrapped') },
    async (items, work) => Promise.all(items.map(work)), async tasks => Promise.all(tasks.map(task => task())), () => {},
    deps.readFileSync, deps.join, deps.canonicalSourceText, deps.resolveSourceBinding, deps.persistSourceSnapshot, deps.persistClaimExtraction, MECHANIC_REGISTRY, {},
    deps.failTask, deps.ensureTask, deps.issueReadyTask, deps.recordRetryableFailure, deps.GraphStore, deps.createTrustedAgent,
  )
}

async function runRealPersistenceWorkflow({
  restart = false,
  restartCount = restart ? 1 : 0,
  retryFormalizer = false,
  removeRawBeforeRestart = false,
  sourceFinalFailure = false,
  sourceReadFailures = 0,
  sourceTaskMismatch = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wf-formalize-real-'))
  const raw = join(root, 'raw'); const graph = join(root, 'graph')
  mkdirSync(raw)
  writeFileSync(join(raw, 'fixture-faction.json'), JSON.stringify([{ ...ability, raw_text: sourceText, source: { kind: 'json', ref: 'fabricated://wf', edition: '11e', phases: ['Command'] } }]))
  const seed = new GraphStore(graph)
  const repository = seed.createNode({ kind: 'repository-version', payload: { workspace_hash: 'a'.repeat(64), files: [], tool_versions: {}, runner_hashes: [], schema_version: 4, policy_version: 2 } })
  const readiness = seed.createNode({ kind: 'decision', payload: {} })
  seed.appendEvent('run-created', { row: { run_id: 'run', campaign_id: 'run', state: 'planned', kind: 'graph-backed' }, repository_parent_node_id: repository.node_id, readiness_parent_node_id: readiness.node_id }, { aggregate_kind: 'run', aggregate_id: 'run', node_id: readiness.node_id })
  seed.appendEvent('run-started', { expected_state: 'planned' }, { aggregate_kind: 'run', aggregate_id: 'run' })
  const prefix = 'ability:fixture-faction/fixture-ability:initial'
  const sourceLabel = `${prefix}:source-retrieval`
  const sourceBinding = sourceFinalFailure ? null : resolveSourceBinding(raw, ability.faction_id, ability.ability_id)
  const sourceTaskAbility = sourceTaskMismatch ? { ...ability, faction_id: 'other-faction' } : ability
  ensureTask(seed, { run_id: 'run', label: sourceLabel, kind: 'source-retrieval', payload: { ...sourceTaskAbility, generation: 'initial', source_binding: sourceBinding } })
  if (sourceFinalFailure) failTask(seed, { run_id: 'run', label: sourceLabel, reason: 'source-unavailable' })
  ensureTask(seed, { run_id: 'run', label: `${prefix}:who`, kind: 'target-decomposition', depends_on: [`run:${sourceLabel}`], payload: { ...ability, generation: 'initial' } })
  ensureTask(seed, { run_id: 'run', label: `${prefix}:when`, kind: 'timing-decomposition', depends_on: [`run:${sourceLabel}`], payload: { ...ability, generation: 'initial' } })
  ensureTask(seed, { run_id: 'run', label: `${prefix}:what`, kind: 'effect-decomposition', depends_on: [`run:${sourceLabel}`], payload: { ...ability, generation: 'initial' } })
  ensureTask(seed, { run_id: 'run', label: `${prefix}:source-formalization`, kind: 'source-formalization', depends_on: [`run:${sourceLabel}`, `run:${prefix}:who`, `run:${prefix}:when`, `run:${prefix}:what`], payload: { ...ability, generation: 'initial' } })
  seed.close()
  const agentCalls = []
  let remainingSourceReadFailures = sourceReadFailures
  const sourceReadFileSync = (path, ...rest) => {
    if (path === join(raw, 'fixture-faction.json') && remainingSourceReadFailures > 0) {
      remainingSourceReadFailures -= 1
      throw new Error('temporary source read failure')
    }
    return readFileSync(path, ...rest)
  }
  const formalizerInputs = []
  const helperIdentity = {
    model_id: 'fixture/helper@1',
    prompt_sha256: 'c'.repeat(64),
    output_schema_sha256: 'd'.repeat(64),
    agent_contract_id: 'fixture-helper@1',
  }
  const trusted = () => async (prompt, options) => {
    agentCalls.push(options.label)
    const store = new GraphStore(graph)
    try {
      if (options.label.endsWith(':who') || options.label.endsWith(':when') || options.label.endsWith(':what')) {
        const sourceTask = store.db.prepare('SELECT node_id FROM tasks WHERE id=?').get('run:ability:fixture-faction/fixture-ability:initial:source-retrieval')
        const envelope = issueReadyTask(store, { run_id: 'run', label: options.label, now: Date.now() }).envelope
        const result = { role: options.agentType }
        const output = store.createNode({
          kind: 'workflow-output',
          payload: { output_kind: options.agentType, envelope, result, execution_identity: helperIdentity },
          parents: [{ node_id: sourceTask.node_id, edge_type: 'derived_from' }],
        })
        completeTask(store, { envelope, output_node_id: output.node_id })
        return { ...result, sealed_output_node_id: output.node_id, execution_identity: helperIdentity }
      }
      const input = JSON.parse(prompt.slice(prompt.lastIndexOf('Input:\n') + 'Input:\n'.length))
      formalizerInputs.push({
        input_node_ids: [...options.inputNodeIds],
        source_snapshot_id: input.source_snapshot_id,
        sealed_helper_node_ids: [...input.sealed_helper_node_ids],
        helpers: { who: input.who, when: input.when, what: input.what },
      })
      const envelope = issueReadyTask(store, { run_id: 'run', label: options.label, now: Date.now() }).envelope
      if (retryFormalizer && options.label.endsWith(':source-formalization') && agentCalls.filter(label => label === options.label).length === 1) {
        return {
          ...formalOutput({ legacy: true }),
          execution_envelope: envelope,
          execution_identity: {
            model_id: model_identities.formalizer,
            prompt_sha256: 'a'.repeat(64),
            output_schema_sha256: 'b'.repeat(64),
            agent_contract_id: 'inquisitor@1',
          },
        }
      }
      return {
        ...formalOutput(),
        execution_envelope: envelope,
        execution_identity: {
          model_id: model_identities.formalizer,
          prompt_sha256: 'a'.repeat(64),
          output_schema_sha256: 'b'.repeat(64),
          agent_contract_id: 'inquisitor@1',
        },
      }
    } finally {
      store.close()
    }
  }
  const invoke = () => loadWorkflow()(
    { repo_root: root, graph_root: graph, run_id: 'run', raw_store_root: raw, model_identities, abilities: [ability] },
    () => {}, async (items, work) => Promise.all(items.map(work)), async tasks => Promise.all(tasks.map(task => task())), () => {},
    sourceReadFileSync, join, canonicalSourceText, resolveSourceBinding, persistSourceSnapshot, persistClaimExtraction, MECHANIC_REGISTRY, mechanicClaimAdapter,
    failTask, ensureTask, issueReadyTask, recordRetryableFailure, GraphStore, trusted,
  )
  let output
  if (retryFormalizer) {
    try { output = await invoke() } catch (error) { output = { error } }
  } else output = await invoke()
  let restartOutput = null
  const restartOutputs = []
  let sequenceBeforeRestart = null
  let sequenceAfterRestart = null
  if (restartCount > 0) {
    const before = new GraphStore(graph)
    sequenceBeforeRestart = before.sequence()
    before.close()
    if (removeRawBeforeRestart) rmSync(raw, { recursive: true, force: true })
    for (let attempt = 0; attempt < restartCount; attempt += 1) {
      restartOutput = await invoke()
      restartOutputs.push(restartOutput)
    }
    const after = new GraphStore(graph)
    sequenceAfterRestart = after.sequence()
    after.close()
  }
  const store = new GraphStore(graph)
  try {
    const payloadContainsSentinel = table => store.db.prepare(`SELECT payload_json FROM ${table}`).all()
      .some(row => typeof row.payload_json === 'string' && row.payload_json.includes(sourceText))
    const taskLeakCount = payloadContainsSentinel('tasks') ? 1 : 0
    const eventLeakCount = payloadContainsSentinel('events') ? 1 : 0
    const nodeLeakCount = payloadContainsSentinel('nodes') ? 1 : 0
    const sourceTaskRow = store.db.prepare("SELECT payload_json FROM tasks WHERE id='run:ability:fixture-faction/fixture-ability:initial:source-retrieval'").get()
    const assertionRow = store.db.prepare("SELECT payload_json FROM nodes WHERE kind='claim-assertion'").get()
    const bindingRow = store.db.prepare("SELECT payload_json FROM nodes WHERE kind='claim-evidence-binding'").get()
    return {
      output, restartOutput, restartOutputs, agentCalls, formalizerInputs, sequenceBeforeRestart, sequenceAfterRestart,
      sourceAttemptCount: Number(store.db.prepare("SELECT count(*) AS n FROM attempts WHERE run_id='run' AND json_extract(payload_json,'$.task_id')='run:ability:fixture-faction/fixture-ability:initial:source-retrieval'").get().n),
      sourceTaskState: store.db.prepare("SELECT state FROM tasks WHERE id='run:ability:fixture-faction/fixture-ability:initial:source-retrieval'").get().state,
      noProsePersistence: { tasks: taskLeakCount === 0, events: eventLeakCount === 0, nodes: nodeLeakCount === 0 },
      sourceTaskPayload: sourceTaskRow ? JSON.parse(sourceTaskRow.payload_json).payload : null,
      assertion: assertionRow ? JSON.parse(assertionRow.payload_json) : null,
      binding: bindingRow ? JSON.parse(bindingRow.payload_json) : null,
    }
  } finally { store.close() }
}

describe('dsl formalize batch workflow', () => {
  test('persists workflow-local evidence and signatures through the real graph store', async () => {
    const value = await runRealPersistenceWorkflow()
    assert.equal(value.output.results[0].status, 'certified')
    assert.deepEqual(value.noProsePersistence, { tasks: true, events: true, nodes: true })
    assert.deepEqual(value.sourceTaskPayload.source_binding.store_key, 'fixture-faction/fixture-ability')
    assert.match(value.sourceTaskPayload.source_binding.byte_hash, /^[a-f0-9]{64}$/)
    assert.equal(value.binding.origin_id.length, 64)
    assert.equal(Object.hasOwn(value.binding, 'source_snapshot_id'), false)
    assert.deepEqual(value.assertion.signature.aggregate, {})
    assert.deepEqual(value.assertion.signature.assertion, {})
  })
  test('retries formalizer while reusing succeeded source and helpers', async () => {
    const value = await runRealPersistenceWorkflow({ restart: true, retryFormalizer: true })
    assert.match(value.output.error.message, /claim_id/)
    assert.equal(value.restartOutput.results[0].status, 'certified')
    assert.equal(value.agentCalls.filter(label => label.endsWith(':who')).length, 1)
    assert.equal(value.agentCalls.filter(label => label.endsWith(':when')).length, 1)
    assert.equal(value.agentCalls.filter(label => label.endsWith(':what')).length, 1)
    assert.equal(value.agentCalls.filter(label => label.endsWith(':source-formalization')).length, 2)
    assert.equal(value.formalizerInputs.length, 2)
    assert.deepEqual(value.formalizerInputs[0].input_node_ids, value.formalizerInputs[1].input_node_ids)
    assert.deepEqual(value.formalizerInputs[0].sealed_helper_node_ids, value.formalizerInputs[1].sealed_helper_node_ids)
    assert.deepEqual(value.formalizerInputs[0].helpers, value.formalizerInputs[1].helpers)
  })
  test('resumes completed formalization without reopening the raw store', async () => {
    const value = await runRealPersistenceWorkflow({ restart: true, removeRawBeforeRestart: true })
    assert.equal(value.output.results[0].status, 'certified')
    assert.equal(value.restartOutput.results[0].status, 'certified')
    assert.equal(value.sequenceAfterRestart, value.sequenceBeforeRestart)
  })

  test('returns source-unavailable for a failed-final source task without another transition', async () => {
    const value = await runRealPersistenceWorkflow({ restart: true, sourceFinalFailure: true, removeRawBeforeRestart: true })
    assert.equal(value.output.results[0].status, 'source-unavailable')
    assert.equal(value.restartOutput.results[0].status, 'source-unavailable')
    assert.equal(value.sequenceAfterRestart, value.sequenceBeforeRestart)
  })

  test('retries a transient source read and resumes from its registered source task', async () => {
    const value = await runRealPersistenceWorkflow({ restart: true, sourceReadFailures: 1 })
    assert.equal(value.output.results[0].status, 'source-retryable')
    assert.equal(value.restartOutput.results[0].status, 'certified')
    assert.equal(value.sourceAttemptCount, 2)
  })
  test('reuses sealed source and helper/formalization outputs after restart', async () => {
    const value = await runRealPersistenceWorkflow({ restart: true })
    assert.equal(value.output.results[0].status, 'certified')
    assert.equal(value.restartOutput.results[0].status, 'certified')
    assert.equal(value.agentCalls.length, 4)
    assert.equal(value.sequenceAfterRestart, value.sequenceBeforeRestart)
  })

  test('finalizes an exhausted source retry under its own lease', async () => {
    const value = await runRealPersistenceWorkflow({ restartCount: 2, sourceReadFailures: 3 })
    assert.equal(value.output.results[0].status, 'source-retryable')
    assert.deepEqual(value.restartOutputs.map(output => output.results[0].status), ['source-retryable', 'source-unavailable'])
    assert.equal(value.sourceAttemptCount, 3)
    assert.equal(value.sourceTaskState, 'failed-final')
  })

  test('rejects a mismatched source task before retrying a source failure', async () => {
    await assert.rejects(
      () => runRealPersistenceWorkflow({ sourceReadFailures: 1, sourceTaskMismatch: true }),
      /recovered source task definition invalid/,
    )
  })

  test('freezes source before parallel helpers and persists an unresolved closed extraction', async () => {
    const value = harness()
    const output = await run(value)
    assert.equal(output.results[0].status, 'certified')
    const helpers = value.calls.slice(0, 3)
    assert.deepEqual(helpers.map(call => call.options.label.split(':').at(-1)), ['who', 'when', 'what'])
    assert.ok(helpers.every(call => call.options.dependsOn.includes('ability:fixture-faction/fixture-ability:initial:source-retrieval')))
    assert.ok(helpers.every(call => call.options.inputNodeIds[0] === 'source-node'))
    assert.deepEqual(helpers.map(call => call.options.modelId), [model_identities.who, model_identities.when, model_identities.what])
    const formalizer = value.calls.at(-1)
    assert.deepEqual(formalizer.options.inputNodeIds, ['who-node', 'when-node', 'what-node'])
    assert.match(formalizer.prompt, /sealed_helper_node_ids/)
    assert.match(formalizer.prompt, /who-node/)
    assert.deepEqual(value.persisted[0].extraction_identity.ordered_parent_evidence_ids, ['who-node', 'when-node', 'what-node'])
    assert.equal(value.persisted[0].unresolved[0].kind, 'ambiguous')
  })

  test('rejects missing model identity before any model call', async () => {
    const value = harness()
    await assert.rejects(() => run(value, { model_identities: { ...model_identities, what: '' } }), /model_identities/)
    assert.equal(value.calls.length, 0)
    assert.equal(value.sourceSnapshots.length, 0)
  })

  test('rejects malformed legacy claim_id extraction shape', async () => {
    const value = harness({ legacy: true })
    await assert.rejects(() => run(value), /claim_id is not allowed/)
    assert.equal(value.persisted.length, 0)
  })
})
