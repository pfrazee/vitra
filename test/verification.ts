import ava from 'ava'
import { StorageInMemory, Database, OpLog, ContractFraudProof, ExecutorBehavior } from '../src/index.js'

const SIMPLE_CONTRACT = `
import assert from 'assert'
import { index } from 'contract'

export async function get ({path}) {
  return await index.get(path)
}

export function put ({path, value}, emit) {
  emit({op: 'PUT', path, value})
}

export const apply = {
  PUT (tx, op) {
    tx.put(op.path, op.value)
  }
}
`

ava('verification failure: executor processed an op multiple times', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT},
    executorBehavior: ExecutorBehavior.TEST_PROCESS_OP_MULTIPLE_TIMES
  })

  const monitor = await db.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await db.call('put', {path: '/foo', value: 'hello world'})
  await db.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ProcessedOutOfOrderError')
  t.is(violations[0].details.data.expectedSeq as number, 1)
  t.is(violations[0].details.data.executedSeq as number, 0)

  try {
    await db.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ProcessedOutOfOrderError')
    t.is(violation.details.data.expectedSeq as number, 1)
    t.is(violation.details.data.executedSeq as number, 0)
  }

  await monitor.close()
  await db.close()
})

ava('verification failure: executor skipped an operation', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT},
    executorBehavior: ExecutorBehavior.TEST_SKIP_OPS
  })

  const monitor = await db.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await db.call('put', {path: '/foo', value: 'hello world'})
  await db.call('put', {path: '/bar', value: 'hello world!'})
  await db.call('put', {path: '/baz', value: 'hello world!!'})
  await db.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ProcessedOutOfOrderError')
  t.is(violations[0].details.data.expectedSeq as number, 1)
  t.is(violations[0].details.data.executedSeq as number, 2)

  try {
    await db.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ProcessedOutOfOrderError')
    t.is(violation.details.data.expectedSeq as number, 1)
    t.is(violation.details.data.executedSeq as number, 2)
  }

  await monitor.close()
  await db.close()
})

ava('verification failure: executor op-changes do not match contract', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT},
    executorBehavior: ExecutorBehavior.TEST_WRONG_OP_MUTATIONS
  })

  const monitor = await db.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await db.call('put', {path: '/foo', value: 'hello world'})
  await db.call('put', {path: '/bar', value: 'hello world!'})
  await db.call('put', {path: '/baz', value: 'hello world!!'})
  await db.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ChangeMismatchError')
  t.deepEqual(violations[0].details.data.expectedChange as any, { path: '/foo', type: 'put', value: 'hello world' })

  try {
    await db.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ChangeMismatchError')
    t.deepEqual(violation.details.data.expectedChange as any, { path: '/foo', type: 'put', value: 'hello world' })
  }

  await monitor.close()
  await db.close()
})

ava('verification failure: executor processed an op from a non-participant', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT},
    executorBehavior: ExecutorBehavior.TEST_WRONG_OP_MUTATIONS
  })

  const evilOplog = await OpLog.create(db.storage)
  db.oplogs.add(evilOplog)
  await db.setLocalOplog(evilOplog)

  const monitor = await db.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await db.call('put', {path: '/foo', value: 'hello world'})
  await db.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'NonParticipantError')

  try {
    await db.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'NonParticipantError')
  }

  await monitor.close()
  await db.close()
})
