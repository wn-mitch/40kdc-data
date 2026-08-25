import { completeFamilyApply, findFamilyApplyTask } from '../graph/scope.js'
import { issueReadyTask } from '../graph/scheduler.js'
import { GraphStore } from '../graph/store.js'

export const meta = {
  name: 'dsl-family-apply',
  description: 'Verify a scoped family transaction from its completed member audits',
  phases: [{
    title: 'Apply',
    detail: 'seal completed member audit outputs into one verified family apply transaction',
  }],
}

if (typeof args === 'string') args = JSON.parse(args)
if (!args || typeof args.run_id !== 'string' || !args.run_id) throw new Error('run_id required')
if (typeof args.graph_root !== 'string' || !args.graph_root) throw new Error('graph_root required')
if (typeof args.apply_transaction_id !== 'string' || !args.apply_transaction_id) throw new Error('apply_transaction_id required')


const store = new GraphStore(args.graph_root)
try {
  const task = findFamilyApplyTask(store, args.run_id, args.apply_transaction_id)
  const transaction = store.db.prepare('SELECT * FROM apply_transactions WHERE id=? AND run_id=?').get(args.apply_transaction_id, args.run_id)
  if (!transaction) throw new Error(`family apply transaction missing: ${args.apply_transaction_id}`)
  if (task.state === 'succeeded') {
    if (transaction.state !== 'verified' || transaction.node_id !== task.node_id) throw new Error('family apply completion drift')
    return { apply_transaction_id: args.apply_transaction_id, node_id: transaction.node_id, idempotent: true }
  }
  const issued = issueReadyTask(store, { run_id: args.run_id, label: task.definition.label, now: Date.now() })
  if (!issued.issued) throw new Error(`family apply task could not be issued: ${issued.reason}`)
  return completeFamilyApply(store, {
    run_id: args.run_id,
    apply_transaction_id: args.apply_transaction_id,
    envelope: issued.envelope,
  })
} finally {
  store.close()
}
