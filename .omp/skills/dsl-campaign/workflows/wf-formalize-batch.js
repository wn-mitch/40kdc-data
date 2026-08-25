import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalSourceText,
  persistClaimExtraction,
  persistSourceSnapshot,
  resolveSourceBinding,
} from '../graph/formalization.js'
import { MECHANIC_REGISTRY, mechanicClaimAdapter } from '../graph/mechanic-claims.js'
import { failTask, ensureTask, issueReadyTask, recordRetryableFailure } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'
import { createTrustedAgent } from '../graph/workflow-runtime.js'

export const meta = {
  name: 'dsl-formalize-batch',
  description: 'Freeze authoritative sources and persist closed mechanic claim extractions before retrieval',
}

export const WHO_PROMPT_VERSION = 2
export const WHEN_PROMPT_VERSION = 2
export const WHAT_PROMPT_VERSION = 2
export const FORMALIZER_PROMPT_VERSION = 2
export const FORMALIZATION_IMPLEMENTATION_VERSION = '2'

// args: { repo_root, graph_root, run_id, raw_store_root?, model_identities: { who, when, what, formalizer }, abilities: [{ faction_id, ability_id, generation? }] }
if (typeof args === 'string') args = JSON.parse(args)
if (!args?.graph_root || !args?.run_id || !Array.isArray(args.abilities)) throw new Error('graph_root, run_id, and abilities required')
const modelIdentities = args.model_identities
if (!modelIdentities || !['who', 'when', 'what', 'formalizer'].every(key => typeof modelIdentities[key] === 'string' && modelIdentities[key])) {
  throw new Error('model_identities.who, model_identities.when, model_identities.what, and model_identities.formalizer required')
}
const rawStoreRoot = args.raw_store_root || join(args.repo_root, '..', '40kdc-abilities')
const graphAgent = createTrustedAgent({ driverArgs: args, invokeAgent: agent })

const JSON_VALUE = {}
const MECHANIC_VALUE = {
  type: 'object', additionalProperties: false, required: ['predicate', 'arguments', 'qualifiers'],
  properties: {
    predicate: { enum: MECHANIC_REGISTRY.predicates.values },
    arguments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'value'], properties: {
      role: { enum: MECHANIC_REGISTRY.argument_roles.values }, value: JSON_VALUE,
    } } },
    qualifiers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'value'], properties: {
      kind: { enum: MECHANIC_REGISTRY.qualifier_kinds.values }, value: JSON_VALUE,
    } } },
  },
}
const PASSIVE_RULE = 'Emit mechanic.duration continuous with timing.passive only when behavior is absent/passive, scope duration is absent/permanent, and there is no trigger, nested condition, finite duration, ability/local usage, or trigger/rule-state/resource-action cost. Map permanent to continuous; retain finite durations; one-use also emits mechanic.usage once-per-battle.'
const MECHANIC_CONTRACT = Object.freeze({
  registry_schema_sha256: MECHANIC_REGISTRY.registry_schema_sha256,
  predicates: MECHANIC_REGISTRY.predicates.values,
  argument_roles: MECHANIC_REGISTRY.argument_roles.values,
  qualifier_kinds: MECHANIC_REGISTRY.qualifier_kinds.values,
  passive_rule: PASSIVE_RULE,
})
const SOURCE_SPAN = {
  type: 'object', additionalProperties: false, required: ['kind', 'start', 'end', 'coordinate_unit'],
  properties: {
    kind: { const: 'source_span' },
    start: { type: 'integer', minimum: 0 },
    end: { type: 'integer', minimum: 1 },
    coordinate_unit: { const: 'utf8_byte' },
  },
}
const DERIVED_EVIDENCE = {
  type: 'object', additionalProperties: false, required: ['kind', 'derivation_local_parent_ids', 'derivation_rule_id', 'derivation_rule_version'],
  properties: {
    kind: { const: 'derived_evidence' },
    derivation_local_parent_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, uniqueItems: true },
    derivation_rule_id: { type: 'string', minLength: 1 },
    derivation_rule_version: { type: 'string', minLength: 1 },
  },
}
const EVIDENCE = { oneOf: [SOURCE_SPAN, DERIVED_EVIDENCE] }
const PROPOSITION = {
  type: 'object', additionalProperties: false, required: ['schema_id', 'schema_version', 'value'],
  properties: { schema_id: { const: '40k.mechanic-claim' }, schema_version: { const: '1' }, value: MECHANIC_VALUE },
}
const ASSERTION = {
  type: 'object', additionalProperties: false,
  required: ['extraction_local_id', 'proposition', 'polarity', 'modality', 'evidence_bindings', 'derivation_parent_labels'],
  properties: {
    extraction_local_id: { type: 'string', minLength: 1 },
    proposition: PROPOSITION,
    polarity: { enum: ['affirms', 'denies'] },
    modality: { enum: ['asserted', 'conditional', 'permitted', 'required', 'possible'] },
    evidence_bindings: { type: 'array', minItems: 1, items: EVIDENCE },
    derivation_parent_labels: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  },
}
const UNRESOLVED = {
  type: 'object', additionalProperties: false,
  required: ['extraction_local_id', 'extraction_local_focus', 'kind', 'evidence_bindings', 'candidate_local_labels', 'blocks_obligations'],
  properties: {
    extraction_local_id: { type: 'string', minLength: 1 },
    extraction_local_focus: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, uniqueItems: true },
    kind: { enum: ['ambiguous', 'unsupported', 'contradictory', 'incomplete_source', 'ontology_gap', 'awaiting_evidence'] },
    evidence_bindings: { type: 'array', items: EVIDENCE },
    candidate_local_labels: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    blocks_obligations: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  },
}
const FORMALIZATION_OUT = {
  type: 'object', additionalProperties: false, required: ['clauses', 'assertions', 'unresolved', 'signatures', 'completeness'],
  properties: {
    clauses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['extraction_local_id', 'start', 'end'], properties: {
      extraction_local_id: { type: 'string', minLength: 1 }, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 },
    } } },
    assertions: { type: 'array', items: ASSERTION },
    unresolved: { type: 'array', items: UNRESOLVED },
    signatures: { type: 'object', additionalProperties: false, required: ['aggregate', 'assertions'], properties: {
      aggregate: JSON_VALUE,
      assertions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['extraction_local_id', 'signature'], properties: {
        extraction_local_id: { type: 'string', minLength: 1 }, signature: JSON_VALUE,
      } } },
    } },
    completeness: { type: 'object', additionalProperties: false, required: ['state', 'obligations_checked'], properties: {
      state: { enum: ['complete', 'incomplete', 'disputed'] },
      obligations_checked: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    } },
  },
}
const DECOMPOSITION_OUT = { type: 'object', additionalProperties: true }

function entryFor(factionId, abilityId) {
  const rows = JSON.parse(readFileSync(join(rawStoreRoot, `${factionId}.json`), 'utf8'))
  return rows.find(row => (row.ability_id ?? row.id) === abilityId) || null
}

function taskRow(store, runId, label) {
  if (!store.db?.prepare) return null
  return store.db.prepare('SELECT * FROM tasks WHERE id=? AND run_id=?').get(`${runId}:${label}`, runId) || null
}
function registeredTaskKind(row) {
  if (typeof row?.kind === 'string') return row.kind
  if (typeof row?.payload_json !== 'string') return null
  try { return JSON.parse(row.payload_json || '{}').kind || null } catch { return null }
}
function registeredTaskPayload(row) {
  if (typeof row?.payload_json !== 'string') return null
  let registered
  try { registered = JSON.parse(row.payload_json || '{}') } catch { throw new Error('recovered task payload malformed') }
  const payload = registered?.payload
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype) throw new Error('recovered task payload invalid')
  return payload
}

function recoveredSourceBinding(row, common, { allowNull = false } = {}) {
  if (registeredTaskKind(row) !== 'source-retrieval') throw new Error('recovered source task definition invalid')
  const payload = registeredTaskPayload(row)
  if (payload.faction_id !== common.faction_id || payload.ability_id !== common.ability_id || payload.generation !== common.generation) {
    throw new Error('recovered source task definition invalid')
  }
  const binding = payload.source_binding
  if (binding === null && allowNull) return null
  if (!binding || Object.getPrototypeOf(binding) !== Object.prototype ||
      Object.keys(binding).some(key => !['store_key', 'byte_hash'].includes(key)) ||
      typeof binding.store_key !== 'string' || binding.store_key !== `${common.faction_id}/${common.ability_id}` ||
      typeof binding.byte_hash !== 'string' || !/^[a-f0-9]{64}$/.test(binding.byte_hash)) {
    throw new Error('recovered source task binding invalid')
  }
  return { store_key: binding.store_key, byte_hash: binding.byte_hash }
}

function nodeRow(store, nodeId) {
  if (typeof nodeId !== 'string' || !nodeId) throw new Error('recovered task output node required')
  const row = store.db.prepare('SELECT kind,payload_json FROM nodes WHERE node_id=?').get(nodeId)
  if (!row) throw new Error(`recovered task output node missing: ${nodeId}`)
  let payload
  try { payload = JSON.parse(row.payload_json || '{}') } catch { throw new Error(`recovered task output payload malformed: ${nodeId}`) }
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype) throw new Error(`recovered task output payload must be an object: ${nodeId}`)
  return { ...row, node_id: nodeId, payload }
}

function recoveredSourceSnapshot(store, row, common, binding) {
  if (!row || row.state !== 'succeeded') return null
  if (registeredTaskKind(row) !== 'source-retrieval' || typeof row.node_id !== 'string' || !row.node_id) throw new Error('recovered source task definition invalid')
  const node = nodeRow(store, row.node_id)
  if (node.kind !== 'source-snapshot') throw new Error(`recovered source task output kind invalid: ${node.kind}`)
  const source = node.payload
  for (const key of ['source_snapshot_id', 'faction_id', 'ability_id', 'store_key', 'byte_hash']) {
    if (typeof source[key] !== 'string' || !source[key]) throw new Error(`recovered source snapshot ${key} required`)
  }
  if (source.faction_id !== common.faction_id || source.ability_id !== common.ability_id ||
      source.store_key !== binding.store_key || source.byte_hash !== binding.byte_hash) {
    throw new Error('recovered source snapshot binding mismatch')
  }
  const projection = store.db.prepare('SELECT id,node_id FROM source_snapshots WHERE id=?').get(source.source_snapshot_id)
  if (!projection || (projection.node_id && projection.node_id !== row.node_id)) throw new Error('recovered source snapshot projection mismatch')
  return { source_snapshot_id: source.source_snapshot_id, source_node_id: row.node_id, idempotent: true }
}

function recoveredHelper(store, row, taskKind, outputKind) {
  if (!row || row.state !== 'succeeded') return null
  if (registeredTaskKind(row) !== taskKind || typeof row.node_id !== 'string' || !row.node_id) throw new Error('recovered helper task definition invalid')
  const node = nodeRow(store, row.node_id)
  if (node.kind !== 'workflow-output' || node.payload.output_kind !== outputKind) throw new Error(`recovered helper output kind invalid: ${node.kind}`)
  const result = node.payload.result
  if (!result || Object.getPrototypeOf(result) !== Object.prototype) throw new Error('recovered helper output result invalid')
  return { ...result, sealed_output_node_id: row.node_id, ...(node.payload.execution_identity ? { execution_identity: node.payload.execution_identity } : {}) }
}

function recoveredFormalization(store, row, ability, sourceSnapshot) {
  if (!row || row.state !== 'succeeded') return null
  if (registeredTaskKind(row) !== 'source-formalization' || typeof row.node_id !== 'string' || !row.node_id) throw new Error('recovered formalization task definition invalid')
  const node = nodeRow(store, row.node_id)
  if (node.kind !== 'claim-set-certificate') throw new Error(`recovered formalization output kind invalid: ${node.kind}`)
  const certificate = node.payload
  for (const key of ['certificate_id', 'claim_set_id', 'extraction_id']) {
    if (typeof certificate[key] !== 'string' || !certificate[key]) throw new Error(`recovered formalization ${key} required`)
  }
  if (!sourceSnapshot || typeof sourceSnapshot.source_snapshot_id !== 'string') throw new Error('recovered formalization source snapshot required')
  const subjectRef = `ability:${ability.faction_id}/${ability.ability_id}`
  const projection = store.db.prepare(`
    SELECT cs.certificate_node_id,cs.subject_ref,cs.origin_id,co.subject_ref AS origin_subject_ref,
      co.source_snapshot_id,co.current_state AS origin_state
    FROM claim_sets cs
    JOIN claim_origins co ON co.origin_id=cs.origin_id
    WHERE cs.claim_set_id=? AND cs.state='current'
  `).get(certificate.claim_set_id)
  if (!projection || projection.certificate_node_id !== row.node_id || projection.subject_ref !== subjectRef ||
      projection.origin_subject_ref !== subjectRef || projection.source_snapshot_id !== sourceSnapshot.source_snapshot_id ||
      projection.origin_state !== 'current') throw new Error('recovered formalization current authority mismatch')
  return {
    ability,
    status: 'certified',
    extraction_id: certificate.extraction_id,
    claim_set_id: certificate.claim_set_id,
    certificate_node_id: row.node_id,
    idempotent: true,
  }
}

function registerTask(store, { run_id, label, kind, depends_on = [], payload = {} }) {
  return ensureTask(store, { run_id, label, kind, depends_on, payload })
}

function issueSourceEnvelope(store, { run_id, label, payload }) {
  registerTask(store, { run_id, label, kind: 'source-retrieval', depends_on: [], payload })
  const issued = issueReadyTask(store, { run_id, label, now: Date.now() })
  if (!issued.issued) throw new Error(issued.reason)
  return issued.envelope
}

export const SOURCE_RETRIEVAL_RETRY_LIMIT = 3

function sourceFailure(store, { run_id, label, common, deterministic = false }) {
  const task = taskRow(store, run_id, label)
  if (!task || !['pending', 'ready', 'running'].includes(task.state)) throw new Error(`source task cannot retry: ${label}`)
  const binding = recoveredSourceBinding(task, common, { allowNull: true })
  registerTask(store, { run_id, label, kind: 'source-retrieval', depends_on: [], payload: { ...common, source_binding: binding } })
  const issued = issueReadyTask(store, { run_id, label, now: Date.now() })
  if (!issued.issued) throw new Error(issued.reason)
  const attempts = Number(store.db.prepare(
    "SELECT count(*) AS n FROM attempts WHERE run_id=? AND json_extract(payload_json,'$.task_id')=?",
  ).get(run_id, task.id).n)
  if (deterministic || attempts >= SOURCE_RETRIEVAL_RETRY_LIMIT) {
    failTask(store, {
      run_id,
      label,
      envelope: issued.envelope,
      reason: deterministic ? 'source-entry-absent' : 'source-retry-limit-exhausted',
    })
    return { terminal: true }
  }
  recordRetryableFailure(store, { envelope: issued.envelope, reason: 'source-unavailable' })
  return { terminal: false }
}

const results = await pipeline(args.abilities, async ability => {
  const generation = ability.generation || 'initial'
  const common = { faction_id: ability.faction_id, ability_id: ability.ability_id, generation }
  const prefix = `ability:${ability.faction_id}/${ability.ability_id}:${generation}`
  const sourceLabel = `${prefix}:source-retrieval`
  const sourceStore = new GraphStore(args.graph_root)
  let sourceSnapshot
  try {
    let sourceText = null
    let binding
    const existingSourceTask = taskRow(sourceStore, args.run_id, sourceLabel)
    if (existingSourceTask?.state === 'failed-final') {
      binding = recoveredSourceBinding(existingSourceTask, common, { allowNull: true })
      registerTask(sourceStore, {
        run_id: args.run_id, label: sourceLabel, kind: 'source-retrieval', depends_on: [], payload: { ...common, source_binding: binding },
      })
      return { ability, status: 'source-unavailable', reason: 'source-unavailable' }
    }
    if (existingSourceTask?.state === 'succeeded') {
      binding = recoveredSourceBinding(existingSourceTask, common)
    } else {
      try {
        const entry = entryFor(ability.faction_id, ability.ability_id)
        if (!entry) {
          const error = new Error('authoritative source entry is absent')
          error.code = 'SOURCE_ENTRY_ABSENT'
          throw error
        }
        sourceText = canonicalSourceText(entry)
        binding = resolveSourceBinding(rawStoreRoot, ability.faction_id, ability.ability_id)
      } catch (error) {
        const failure = sourceFailure(sourceStore, {
          run_id: args.run_id,
          label: sourceLabel,
          common,
          deterministic: error?.code === 'SOURCE_ENTRY_ABSENT',
        })
        return { ability, status: failure.terminal ? 'source-unavailable' : 'source-retryable', reason: 'source-unavailable' }
      }
    }
    const sourceTask = existingSourceTask || registerTask(sourceStore, {
      run_id: args.run_id, label: sourceLabel, kind: 'source-retrieval', depends_on: [], payload: { ...common, source_binding: binding },
    })
    sourceSnapshot = recoveredSourceSnapshot(sourceStore, sourceTask, common, binding)
    if (!sourceSnapshot) {
      const sourceEnvelope = issueSourceEnvelope(sourceStore, {
        run_id: args.run_id, label: sourceLabel, payload: { ...common, source_binding: binding },
      })
      sourceSnapshot = persistSourceSnapshot(sourceStore, {
        run_id: args.run_id, ...common, envelope: sourceEnvelope, raw_store_root: rawStoreRoot,
        source_binding: binding, parents: sourceEnvelope.input_node_ids,
      })
    }

    const formalizationLabel = `${prefix}:source-formalization`
    const formalizationTask = registerTask(sourceStore, {
      run_id: args.run_id, label: formalizationLabel, kind: 'source-formalization',
      depends_on: [`${args.run_id}:${sourceLabel}`, `${args.run_id}:${prefix}:who`, `${args.run_id}:${prefix}:when`, `${args.run_id}:${prefix}:what`],
      payload: common,
    })
    const resumed = recoveredFormalization(sourceStore, formalizationTask, ability, sourceSnapshot)
    if (resumed) return resumed

    if (sourceText === null) {
      try {
        sourceText = canonicalSourceText(entryFor(ability.faction_id, ability.ability_id))
        const currentBinding = resolveSourceBinding(rawStoreRoot, ability.faction_id, ability.ability_id)
        if (currentBinding.store_key !== binding.store_key || currentBinding.byte_hash !== binding.byte_hash) throw new Error('source byte hash changed')
      } catch (error) {
        return { ability, status: 'source-unavailable', reason: error.message }
      }
    }
    const basePrompt = JSON.stringify({
      ability_id: ability.ability_id, faction_id: ability.faction_id, source_snapshot_id: sourceSnapshot.source_snapshot_id, source_text: sourceText,
      mechanic_contract: MECHANIC_CONTRACT,
    })
    const helperOptions = (agentType, taskKind, label, modelId, promptId, promptVersion) => ({
      agentType, taskKind, phase: 'Formalize', label, dependsOn: [sourceLabel],
      schema: DECOMPOSITION_OUT, taskPayload: common, graphSourceTexts: [sourceText], graphEphemeralKeys: ['raw_text', 'source_text'],
      authoritative: true, modelId, promptId, promptVersion, agentContractId: `${agentType}@${promptVersion}`, sourceSnapshotId: sourceSnapshot.source_snapshot_id,
      orderedParentEvidenceNodeIds: [sourceSnapshot.source_node_id],
    })
    const helperCall = (agentType, taskKind, label, modelId, promptId, promptVersion, prompt) => {
      const row = registerTask(sourceStore, {
        run_id: args.run_id, label, kind: taskKind, depends_on: [`${args.run_id}:${sourceLabel}`], payload: common,
      })
      return recoveredHelper(sourceStore, row, taskKind, agentType) ||
        graphAgent(prompt, helperOptions(agentType, taskKind, label, modelId, promptId, promptVersion))
    }
    const [who, when, what] = await parallel([
      () => helperCall('target-dummy', 'target-decomposition', `${prefix}:who`, modelIdentities.who, 'formalize-who', WHO_PROMPT_VERSION, `Decompose WHO into relational mechanic claims with no quoted source text. Input:\n${basePrompt}`),
      () => helperCall('chronomancer', 'timing-decomposition', `${prefix}:when`, modelIdentities.when, 'formalize-when', WHEN_PROMPT_VERSION, `Decompose WHEN into relational mechanic claims with no quoted source text. Input:\n${basePrompt}`),
      () => helperCall('vox-hound', 'effect-decomposition', `${prefix}:what`, modelIdentities.what, 'formalize-what', WHAT_PROMPT_VERSION, `Decompose WHAT into relational mechanic claims with no quoted source text. Input:\n${basePrompt}`),
    ])
    const helperNodeIds = [who.sealed_output_node_id, when.sealed_output_node_id, what.sealed_output_node_id]
    const formalized = await graphAgent(`Aggregate sealed WHO/WHEN/WHAT analyses into closed, extraction-local mechanic propositions. Emit no source text and no semantic, occurrence, evidence-binding, extraction, assertion, unresolved, claim-set, certificate, or graph node IDs. Evidence locations are UTF-8 byte spans or derived local parents only. A complete output must check both retrieve and represent. Apply the supplied passive rule exactly. Input:\n${JSON.stringify({
      source_snapshot_id: sourceSnapshot.source_snapshot_id, source_text: sourceText, sealed_helper_node_ids: helperNodeIds, who, when, what,
      mechanic_contract: MECHANIC_CONTRACT,
    })}`, {
      agentType: 'inquisitor', taskKind: 'source-formalization', phase: 'Formalize', label: formalizationLabel,
      dependsOn: [sourceLabel, `${prefix}:who`, `${prefix}:when`, `${prefix}:what`],
      completion: 'deferred', schema: FORMALIZATION_OUT, taskPayload: common, graphSourceTexts: [sourceText], graphEphemeralKeys: ['raw_text', 'source_text'],
      authoritative: true, modelId: modelIdentities.formalizer, promptId: 'formalize-claims', promptVersion: FORMALIZER_PROMPT_VERSION,
      agentContractId: `inquisitor@${FORMALIZER_PROMPT_VERSION}`, sourceSnapshotId: sourceSnapshot.source_snapshot_id,
      orderedParentEvidenceNodeIds: helperNodeIds,
    })
    const store = new GraphStore(args.graph_root)
    try {
      const persisted = persistClaimExtraction(store, {
        run_id: args.run_id, ...common, envelope: formalized.execution_envelope,
        source_snapshot_node_id: sourceSnapshot.source_node_id, raw_store_root: rawStoreRoot, adapter: mechanicClaimAdapter,
        extraction_identity: {
          extractor_contract_version: FORMALIZER_PROMPT_VERSION,
          formalization_policy_version: FORMALIZER_PROMPT_VERSION,
          normalization_version: 1,
          extractor_implementation: `wf-formalize-batch@${FORMALIZATION_IMPLEMENTATION_VERSION}`,
          model_and_prompt_identity: formalized.execution_identity,
          ordered_parent_evidence_ids: helperNodeIds,
        },
        clauses: formalized.clauses, assertions: formalized.assertions, unresolved: formalized.unresolved,
        signatures: formalized.signatures, completeness: formalized.completeness,
        parents: helperNodeIds,
      })
      return { ability, status: 'certified', ...persisted }
    } finally {
      store.close()
    }
  } finally {
    sourceStore.close()
  }
})

return { run_id: args.run_id, results }
