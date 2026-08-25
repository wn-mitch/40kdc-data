import { completeTask, issueReadyTask } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'
import { authorizeClaimSet, persistRetrieval } from '../graph/retrieval.js'

export const meta = {
  name: 'dsl-retrieve-plan-batch',
  description: 'Advance certified source claim sets through deterministic retrieval and construction planning',
  phases: [
    { title: 'Retrieve', detail: 'Record reusable evidence matches against the current certified claim set' },
    { title: 'Plan', detail: 'Seal the exact-coverage construction plan and unblock authoring' },
  ],
}

// args: {
//   run_id: string,
//   graph_root: string,
//   abilities: [{ faction_id, ability_id, generation?: string }],
//   candidates_by_ability?: Record<"faction_id/ability_id", string[]>,
// }
//
// This stage has no model call. A complete current source claim set may form a
// direct source plan when no certified reusable evidence covers every claim.

const RESUMABLE_TASK_STATES = new Set(['pending', 'ready'])
if (typeof args === 'string') args = JSON.parse(args)
if (!args || typeof args.run_id !== 'string' || !args.run_id) throw new Error('run_id required')
if (typeof args.graph_root !== 'string' || !args.graph_root) throw new Error('graph_root required')
if (!Array.isArray(args.abilities) || !args.abilities.length) throw new Error('abilities required')

function abilityKey(ability) {
  if (!ability || typeof ability.faction_id !== 'string' || !ability.faction_id || typeof ability.ability_id !== 'string' || !ability.ability_id) {
    throw new TypeError('ability faction_id and ability_id required')
  }
  return `${ability.faction_id}/${ability.ability_id}`
}

function taskLabel(ability, suffix) {
  return `ability:${abilityKey(ability)}:${ability.generation || 'initial'}:${suffix}`
}

function taskRow(store, runId, label) {
  return store.db.prepare('SELECT * FROM tasks WHERE id=? AND run_id=?').get(`${runId}:${label}`, runId) || null
}

function planRow(store, runId, ability) {
  return store.db.prepare('SELECT node_id,payload_json FROM construction_plans WHERE id=? AND run_id=?')
    .get(`${runId}:${abilityKey(ability)}:construction-plan`, runId) || null
}

function parsePlan(row) {
  if (!row || typeof row.node_id !== 'string' || !row.node_id || typeof row.payload_json !== 'string') throw new Error('construction plan record invalid')
  let payload
  try { payload = JSON.parse(row.payload_json) } catch { throw new Error('construction plan payload malformed') }
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype) throw new Error('construction plan payload invalid')
  return { node_id: row.node_id, payload }
}

function completeWithPlan(store, runId, label, nodeId) {
  const row = taskRow(store, runId, label)
  if (!row) throw new Error(`registered task missing: ${label}`)
  if (row.state === 'succeeded') {
    if (row.node_id !== nodeId) throw new Error(`task output mismatch: ${label}`)
    return false
  }
  if (!RESUMABLE_TASK_STATES.has(row.state)) throw new Error(`task is not resumable: ${label} (${row.state})`)
  const issued = issueReadyTask(store, { run_id: runId, label, now: Date.now() })
  if (!issued.issued) throw new Error(`task could not be issued: ${label} (${issued.reason})`)
  completeTask(store, { envelope: issued.envelope, output_node_id: nodeId, now: Date.now() })
  return true
}

function taskDefinition(row) {
  let definition
  try { definition = JSON.parse(row.payload_json || '{}') } catch { throw new Error(`task payload malformed: ${row.id}`) }
  if (!definition || Object.getPrototypeOf(definition) !== Object.prototype || !definition.payload ||
      Object.getPrototypeOf(definition.payload) !== Object.prototype) {
    throw new Error(`task definition invalid: ${row.id}`)
  }
  return definition
}

function certificateForAbility(store, certificateNodeId, ability) {
  const node = store.db.prepare('SELECT kind FROM nodes WHERE node_id=?').get(certificateNodeId)
  if (node?.kind !== 'claim-set-certificate') throw new Error(`source formalization output invalid: ${abilityKey(ability)}`)
  const authorization = authorizeClaimSet(store, certificateNodeId, 'retrieve')
  const subject = `ability:${abilityKey(ability)}`
  if (authorization.subject_ref !== subject) throw new Error(`source formalization subject mismatch: expected ${subject}`)
  return certificateNodeId
}

function reusableSourceCertificate(store, runId, ability) {
  const retrieval = taskRow(store, runId, taskLabel(ability, 'certified-retrieval'))
  if (!retrieval) throw new Error(`certified retrieval task missing: ${abilityKey(ability)}`)
  const candidates = taskDefinition(retrieval).payload.input_node_ids
  if (!Array.isArray(candidates)) throw new Error(`certified retrieval inputs invalid: ${abilityKey(ability)}`)
  const certificates = candidates.filter(nodeId => store.db.prepare('SELECT kind FROM nodes WHERE node_id=?').get(nodeId)?.kind === 'claim-set-certificate')
  const matching = certificates.filter(nodeId => {
    try {
      certificateForAbility(store, nodeId, ability)
      return true
    } catch {
      return false
    }
  })
  if (matching.length !== 1) throw new Error(`reusable source formalization missing or ambiguous: ${abilityKey(ability)}`)
  return matching[0]
}

function sourceCertificate(store, runId, ability) {
  const label = taskLabel(ability, 'source-formalization')
  const row = taskRow(store, runId, label)
  if (!row) return reusableSourceCertificate(store, runId, ability)
  if (row.state !== 'succeeded') return null
  if (typeof row.node_id !== 'string' || !row.node_id) throw new Error(`source formalization output missing: ${label}`)
  return certificateForAbility(store, row.node_id, ability)
}

function pauseForBlockedPlan(store, runId, ability, plan) {
  const decisionId = `${runId}:${abilityKey(ability)}:construction-plan-blocked`
  let decision = store.db.prepare('SELECT node_id FROM decisions WHERE id=?').get(decisionId)
  if (!decision) {
    const node = store.createNode({
      kind: 'decision',
      payload: {
        state: 'open',
        decision: 'construction-plan-blocked',
        faction_id: ability.faction_id,
        ability_id: ability.ability_id,
        construction_plan_node_id: plan.node_id,
        plan_state: plan.payload.state,
        blocking_unresolved_keys: plan.payload.blocking_unresolved_keys || [],
      },
      parents: [{ node_id: plan.node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} }],
    })
    store.appendEvent('decision-opened', {
      row: {
        id: decisionId,
        run_id: runId,
        state: 'open',
        node_id: node.node_id,
        payload: node.payload,
      },
    }, { aggregate_kind: 'decision', aggregate_id: decisionId, node_id: node.node_id })
    decision = { node_id: node.node_id }
  }
  const run = store.db.prepare('SELECT state FROM runs WHERE run_id=?').get(runId)
  if (run?.state === 'active') {
    store.appendEvent('run-paused', {
      reason: `construction plan ${plan.payload.state}: ${abilityKey(ability)}`,
      decision_node_id: decision.node_id,
    }, { aggregate_kind: 'run', aggregate_id: runId, node_id: decision.node_id })
  } else if (run?.state !== 'paused') {
    throw new Error(`cannot pause campaign from ${run?.state || 'missing'} state`)
  }
  return decision.node_id
}

const store = new GraphStore(args.graph_root)
try {
  const results = []
  for (const ability of args.abilities) {
    const key = abilityKey(ability)
    const certificateNodeId = sourceCertificate(store, args.run_id, ability)
    if (!certificateNodeId) {
      results.push({ ability: { faction_id: ability.faction_id, ability_id: ability.ability_id }, status: 'waiting-for-source-formalization' })
      continue
    }

    let plan = planRow(store, args.run_id, ability)
    if (!plan) {
      const candidates = args.candidates_by_ability?.[key] || []
      if (!Array.isArray(candidates)) throw new TypeError(`candidates_by_ability[${key}] must be an array`)
      const persisted = persistRetrieval(store, {
        run_id: args.run_id,
        faction_id: ability.faction_id,
        ability_id: ability.ability_id,
        claim_set_certificate_node_id: certificateNodeId,
        candidates,
        required_checks: ['source-claim-coverage'],
      })
      plan = { node_id: persisted.plan_node_id, payload: persisted.plan }
    } else {
      plan = parsePlan(plan)
    }

    if (plan.payload.state !== 'ready') {
      const decision_node_id = pauseForBlockedPlan(store, args.run_id, ability, plan)
      results.push({
        ability: { faction_id: ability.faction_id, ability_id: ability.ability_id },
        status: plan.payload.state,
        claim_set_certificate_node_id: certificateNodeId,
        construction_plan_node_id: plan.node_id,
        selected_evidence_node_ids: plan.payload.selected_evidence_node_ids,
        unmatched_claim_occurrence_ids: plan.payload.unmatched_claim_occurrence_ids,
        retrieval_advanced: false,
        construction_advanced: false,
        decision_node_id,
      })
      break
    }

    const retrievalLabel = taskLabel(ability, 'certified-retrieval')
    const constructionLabel = taskLabel(ability, 'construction-plan')
    const retrievalAdvanced = completeWithPlan(store, args.run_id, retrievalLabel, plan.node_id)
    const constructionAdvanced = completeWithPlan(store, args.run_id, constructionLabel, plan.node_id)
    results.push({
      ability: { faction_id: ability.faction_id, ability_id: ability.ability_id },
      status: 'ready-for-authoring',
      claim_set_certificate_node_id: certificateNodeId,
      construction_plan_node_id: plan.node_id,
      selected_evidence_node_ids: plan.payload.selected_evidence_node_ids,
      unmatched_claim_occurrence_ids: plan.payload.unmatched_claim_occurrence_ids,
      retrieval_advanced: retrievalAdvanced,
      construction_advanced: constructionAdvanced,
    })
  }
  return { run_id: args.run_id, results }
} finally {
  store.close()
}
