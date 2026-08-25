import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { certifyAndExpandCampaignScope, compareDescriberScope, certifyShapeFamily, completeFamilyApply, expandCampaignScope } from './scope.js'
import { completeTask, ensureTask, issueReadyTask } from './scheduler.js'
import { GraphStore } from './store.js'
function fixture({ certify = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'scope-graph-'))
  const raw = join(root, 'raw')
  mkdirSync(raw)
  const entries = [
    { ability_id: 'alpha', ability_type: 'unit', raw_text: 'Select one fabricated target and apply the mechanic.', source: { kind: 'json', ref: 'fixture-alpha' } },
    { ability_id: 'beta', ability_type: 'unit', raw_text: 'Select another fabricated target and apply the mechanic.', source: { kind: 'json', ref: 'fixture-beta' } },
  ]
  writeFileSync(join(raw, 'fixture.json'), `${JSON.stringify(entries)}\n`)
  const store = new GraphStore(join(root, 'graph'))
  const repository = store.createNode({ kind: 'repository-version', payload: { workspace_hash: 'a'.repeat(64), files: [], tool_versions: {}, runner_hashes: [], schema_version: 3, policy_version: 2 } })
  const readiness = store.createNode({ kind: 'decision', payload: { state: 'answered' }, parents: [{ node_id: repository.node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} }] })
  store.appendEvent('run-created', { row: { run_id: 'c012', campaign_id: 'c012', state: 'planned', kind: 'graph-backed' }, repository_parent_node_id: repository.node_id, readiness_parent_node_id: readiness.node_id }, { aggregate_kind: 'run', aggregate_id: 'c012', node_id: readiness.node_id })
  store.appendEvent('run-started', { expected_state: 'planned' }, { aggregate_kind: 'run', aggregate_id: 'c012' })
  const packageNode = store.createNode({ kind: 'finding', payload: { state: 'resolved', artifact: 'shape-package' }, parents: [{ node_id: readiness.node_id, edge_type: 'derived_from', authorizes_reuse: false, metadata: {} }] })
  const shapePackage = {
    name: 'fabricated-selector', kind: 'effect-leaf', parameters: [{ name: 'target', type: 'string', load_bearing: true }],
    schema_branch: { type: 'object', properties: { type: { const: 'fabricated-selector' } } },
    faithful_family: [
      { faction: 'fixture', ability_id: 'alpha', fit: 'faithful', match_strength: 'exact' },
      { faction: 'fixture', ability_id: 'beta', fit: 'needs-param', match_strength: 'near' },
    ],
  }
  const certified = certify ? certifyShapeFamily(store, { run_id: 'c012', shape_package: shapePackage, shape_package_node_id: packageNode.node_id }) : null
  return { store, raw, repository, certified, packageNode, shapePackage }
}

test('certified family scope expands claims, fresh DAGs, and apply atomically', () => {
  const value = fixture()
  const result = expandCampaignScope(value.store, {
    run_id: 'c012', expected_repository_hash: 'a'.repeat(64), raw_store_root: value.raw,
    family_template_node_id: value.certified.family_template_node_id,
    family_members: value.certified.family_members,
    apply_transaction_id: 'c012:family-apply',
  })
  assert.deepEqual(result.claimed_keys, ['fixture/alpha', 'fixture/beta'])
  assert.equal(value.store.db.prepare("SELECT count(*) AS n FROM claims WHERE run_id='c012' AND state='active'").get().n, 2)
  assert.equal(value.store.db.prepare("SELECT state FROM apply_transactions WHERE id='c012:family-apply'").get().state, 'planned')
  const tasks = value.store.db.prepare("SELECT payload_json FROM tasks WHERE run_id='c012'").all().map(row => JSON.parse(row.payload_json))
  assert.equal(tasks.filter(task => task.kind === 'source-formalization').length, 2)
  const apply = tasks.find(task => task.kind === 'family-apply')
  assert.equal(apply.depends_on.length, 2)
  assert.ok(apply.depends_on.every(id => id.includes(':audit')))
  const edgeTypes = value.store.db.prepare('SELECT edge_type FROM edges WHERE child_node_id=? ORDER BY edge_type').all(result.apply_transaction_node_id).map(row => row.edge_type)
  assert.deepEqual(edgeTypes, ['derived_from', 'satisfies', 'satisfies'])
  assert.equal(value.store.db.prepare("SELECT count(*) AS n FROM events WHERE event_type='campaign-scope-expanded'").get().n, 1)
  value.store.close()
})

test('family certification and scope expansion roll back as one transaction', () => {
  const value = fixture({ certify: false })
  const before = {
    events: value.store.sequence(),
    nodes: value.store.db.prepare('SELECT count(*) AS n FROM nodes').get().n,
    templates: value.store.db.prepare('SELECT count(*) AS n FROM family_templates').get().n,
    instances: value.store.db.prepare('SELECT count(*) AS n FROM family_instances').get().n,
    applyTransactions: value.store.db.prepare('SELECT count(*) AS n FROM apply_transactions').get().n,
    claims: value.store.db.prepare('SELECT count(*) AS n FROM claims').get().n,
    tasks: value.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,
  }
  assert.throws(() => certifyAndExpandCampaignScope(value.store, {
    run_id: 'c012',
    shape_package: value.shapePackage,
    shape_package_node_id: value.packageNode.node_id,
    expected_repository_hash: 'b'.repeat(64),
    raw_store_root: value.raw,
  }), /repository-hash-drift/)
  assert.deepEqual({
    events: value.store.sequence(),
    nodes: value.store.db.prepare('SELECT count(*) AS n FROM nodes').get().n,
    templates: value.store.db.prepare('SELECT count(*) AS n FROM family_templates').get().n,
    instances: value.store.db.prepare('SELECT count(*) AS n FROM family_instances').get().n,
    applyTransactions: value.store.db.prepare('SELECT count(*) AS n FROM apply_transactions').get().n,
    claims: value.store.db.prepare('SELECT count(*) AS n FROM claims').get().n,
    tasks: value.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,
  }, before)
  value.store.close()
})

test('family apply atomically verifies the transaction after every member audit', () => {
  const { store } = fixture()
  const auditNodes = ['alpha', 'beta'].map(label => {
    const audit = ensureTask(store, { run_id: 'c012', label: `fixture:${label}:audit`, kind: 'audit' })
    const issued = issueReadyTask(store, { run_id: 'c012', label: audit.payload.label, now: 1_800_000_000_000 })
    const node = store.createNode({ kind: 'finding', payload: { state: 'resolved', label } })
    completeTask(store, { envelope: issued.envelope, output_node_id: node.node_id, now: 1_800_000_000_001 })
    return { task: audit, node }
  })
  const transactionNode = store.createNode({
    kind: 'apply-transaction',
    payload: {
      run_id: 'c012',
      apply_transaction_id: 'c012:fixture-apply',
      family_template_node_id: 'fixture-template',
      authorized_keys: ['fixture/alpha', 'fixture/beta'],
    },
  })
  store.appendEvent('apply-planned', {
    row: {
      id: 'c012:fixture-apply',
      run_id: 'c012',
      state: 'planned',
      node_id: transactionNode.node_id,
      payload: transactionNode.payload,
    },
  }, { aggregate_kind: 'apply-transaction', aggregate_id: 'c012:fixture-apply', node_id: transactionNode.node_id })
  const apply = ensureTask(store, {
    run_id: 'c012',
    label: 'family:fixture:apply',
    kind: 'family-apply',
    depends_on: auditNodes.map(audit => audit.task.id),
    payload: { apply_transaction_id: 'c012:fixture-apply' },
  })
  const issued = issueReadyTask(store, { run_id: 'c012', label: apply.payload.label, now: 1_800_000_000_002 })
  const result = completeFamilyApply(store, {
    run_id: 'c012',
    apply_transaction_id: 'c012:fixture-apply',
    envelope: issued.envelope,
  })
  assert.equal(result.idempotent, false)
  assert.equal(store.db.prepare('SELECT state FROM apply_transactions WHERE id=?').get('c012:fixture-apply').state, 'verified')
  assert.equal(store.db.prepare('SELECT state FROM tasks WHERE id=?').get(apply.id).state, 'succeeded')
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE event_type='apply-verified'").get().n, 1)
  assert.deepEqual(
    store.db.prepare('SELECT node_id FROM tasks WHERE id=?').get(apply.id).node_id,
    store.db.prepare('SELECT node_id FROM apply_transactions WHERE id=?').get('c012:fixture-apply').node_id,
  )
  store.close()
})

test('scope expansion failure leaves claims, tasks, nodes, and events unchanged', () => {
  const value = fixture()
  const before = {
    events: value.store.sequence(),
    nodes: value.store.db.prepare('SELECT count(*) AS n FROM nodes').get().n,
    claims: value.store.db.prepare('SELECT count(*) AS n FROM claims').get().n,
    tasks: value.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,
  }
  assert.throws(() => expandCampaignScope(value.store, {
    run_id: 'c012', expected_repository_hash: 'b'.repeat(64), raw_store_root: value.raw,
    family_template_node_id: value.certified.family_template_node_id,
    family_members: value.certified.family_members,
    apply_transaction_id: 'c012:family-apply',
  }), /repository-hash-drift/)
  assert.deepEqual({
    events: value.store.sequence(),
    nodes: value.store.db.prepare('SELECT count(*) AS n FROM nodes').get().n,
    claims: value.store.db.prepare('SELECT count(*) AS n FROM claims').get().n,
    tasks: value.store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,
  }, before)
  value.store.close()
})

test('whole-corpus describer scope requires the exact authorized changed set', () => {
  const long = 'x'.repeat(5000)
  const baseline = { abilities: [
    { faction: 'fixture', ability_id: 'alpha', english: `${long}A` },
    { faction: 'fixture', ability_id: 'beta', english: 'stable' },
  ] }
  const updated = { abilities: [
    { faction: 'fixture', ability_id: 'alpha', english: `${long}B` },
    { faction: 'fixture', ability_id: 'beta', english: 'stable' },
  ] }
  const result = compareDescriberScope({ baseline, updated, authorized_keys: ['fixture/alpha'] })
  assert.deepEqual(result.changed_keys, ['fixture/alpha'])
  assert.notEqual(result.baseline_hash, result.updated_hash)
  assert.throws(() => compareDescriberScope({ baseline, updated, authorized_keys: ['fixture/beta'] }), /unauthorized-describer-drift/)
  assert.throws(() => compareDescriberScope({ baseline, updated, authorized_keys: ['fixture/alpha', 'fixture/beta'] }), /authorized-output-unchanged/)
})
