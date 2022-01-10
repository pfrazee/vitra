import ava from 'ava'
import { StorageInMemory, Contract, OpLog, ContractFraudProof, TestContractExecutorBehavior } from '../src/index.js'

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
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT},
    executorTestingBehavior: TestContractExecutorBehavior.PROCESS_OP_MULTIPLE_TIMES
  })

  const monitor = await contract.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ProcessedOutOfOrderError')
  t.is(violations[0].details.data.expectedSeq as number, 1)
  t.is(violations[0].details.data.executedSeq as number, 0)

  try {
    await contract.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ProcessedOutOfOrderError')
    t.is(violation.details.data.expectedSeq as number, 1)
    t.is(violation.details.data.executedSeq as number, 0)
  }

  await monitor.close()
  await contract.close()
})

ava('verification failure: executor skipped an operation', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT},
    executorTestingBehavior: TestContractExecutorBehavior.SKIP_OPS
  })

  const monitor = await contract.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.call('put', {path: '/bar', value: 'hello world!'})
  await contract.call('put', {path: '/baz', value: 'hello world!!'})
  await contract.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ProcessedOutOfOrderError')
  t.is(violations[0].details.data.expectedSeq as number, 1)
  t.is(violations[0].details.data.executedSeq as number, 2)

  try {
    await contract.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ProcessedOutOfOrderError')
    t.is(violation.details.data.expectedSeq as number, 1)
    t.is(violation.details.data.executedSeq as number, 2)
  }

  await monitor.close()
  await contract.close()
})

ava('verification failure: executor op-changes do not match contract', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT},
    executorTestingBehavior: TestContractExecutorBehavior.WRONG_OP_MUTATIONS
  })

  const monitor = await contract.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.call('put', {path: '/bar', value: 'hello world!'})
  await contract.call('put', {path: '/baz', value: 'hello world!!'})
  await contract.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'ChangeMismatchError')
  t.deepEqual(violations[0].details.data.expectedChange as any, { path: '/foo', type: 'put', value: 'hello world' })

  try {
    await contract.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'ChangeMismatchError')
    t.deepEqual(violation.details.data.expectedChange as any, { path: '/foo', type: 'put', value: 'hello world' })
  }

  await monitor.close()
  await contract.close()
})

ava('verification failure: executor processed an op from a non-participant', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT},
    executorTestingBehavior: TestContractExecutorBehavior.WRONG_OP_MUTATIONS
  })

  const evilOplog = await OpLog.create(contract.storage, false)
  contract.oplogs.add(evilOplog)
  contract.setMyOplog(evilOplog)

  const monitor = await contract.monitor()
  const violations: ContractFraudProof[] = []
  const whenViolated = new Promise(resolve => {
    monitor.on('violation', (evt: ContractFraudProof) => {
      violations.push(evt)
      resolve(undefined)
    })
  })

  await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.executor?.sync()

  await whenViolated
  t.is(violations.length, 1)
  t.is(violations[0].details.code, 'NonParticipantError')

  try {
    await contract.verify()
  } catch (violation: any) {
    t.is(violation.details.code, 'NonParticipantError')
  }

  await monitor.close()
  await contract.close()
})
