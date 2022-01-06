import ava from 'ava'
import { StorageInMemory, Contract, IndexHistoryEntry } from '../src/index.js'

const SIMPLE_CONTRACT = `
import assert from 'assert'
import { index } from 'contract'

export async function get ({path}) {
  assert(typeof path === 'string' && path.length > 0)
  return await index.get(path)
}

export function put ({path, value}, emit) {
  assert(typeof path === 'string' && path.length > 0)
  emit({op: 'PUT', path, value})
}

export const apply = {
  PUT (tx, op, ack) {
    assert(typeof op.path === 'string' && op.path.length > 0)
    tx.put(op.path, op.value)
  }
}
`

ava('simple full contract run', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  t.truthy(contract.opened)
  t.falsy(contract.opening)
  t.falsy(contract.closing)
  t.falsy(contract.closed)
  t.truthy(contract.pubkey)
  t.truthy(contract.isExecutor)
  t.truthy(contract.isParticipant)
  t.truthy(contract.myOplog)

  const res1 = await contract.call('get', {path: '/foo'})
  const res2 = await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.executor?.sync()
  const res3 = await contract.call('get', {path: '/foo'})
  t.falsy(res1.response)
  t.deepEqual(res2.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world' })
  t.is(res3.response.value, 'hello world')
  await contract.close()
})

ava('successfully runs loaded version', async t => {
  const storage = new StorageInMemory()
  const contract = await Contract.create(storage, {
    code: {source: SIMPLE_CONTRACT}
  })
  const pubkey = contract.pubkey
  await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.call('put', {path: '/bar', value: 'hello world'})
  await contract.executor?.sync()

  const contract2 = await Contract.load(storage, pubkey)
  const res = await contract2.call('get', {path: '/foo'})
  t.is(res.response.value, 'hello world')
  await contract.call('put', {path: '/foo', value: 'hello world!!'})
  await contract.executor?.sync()
  const res2 = await contract2.call('get', {path: '/foo'})
  t.is(res2.response.value, 'hello world!!')

  await contract.close()
  await contract2.close()
})

ava('simple contract run with verification', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const res1 = await contract.call('get', {path: '/foo'})
  const res2 = await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.executor?.sync()
  const res3 = await contract.call('put', {path: '/foo', value: 'hello world!'})
  await contract.executor?.sync()
  const res4 = await contract.call('get', {path: '/foo'})
  t.falsy(res1.response)
  t.deepEqual(res2.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world' })
  t.deepEqual(res3.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world!' })
  t.is(res4.response.value, 'hello world!')

  await contract.verify()

  await contract.close()
})

ava('simple contract run with active monitoring', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const monitor = await contract.monitor()
  const validationEvents: IndexHistoryEntry[] = []
  const whenValidated = new Promise(resolve => {
    monitor.on('validated', (evt: IndexHistoryEntry) => {
      validationEvents.push(evt)
      if (monitor.verifiedLength === 5) resolve(undefined)
    })
  })

  const res1 = await contract.call('get', {path: '/foo'})
  const res2 = await contract.call('put', {path: '/foo', value: 'hello world'})
  await contract.executor?.sync()
  const res3 = await contract.call('get', {path: '/foo'})
  t.falsy(res1.response)
  t.deepEqual(res2.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world' })
  t.is(res3.response.value, 'hello world')

  await whenValidated
  t.is(validationEvents[0].type, 'put')
  t.is(validationEvents[1].type, 'put')
  t.is(validationEvents[2].type, 'put')
  t.is(validationEvents[2].path, '/.sys/acks/genesis')
  t.is(validationEvents[3].type, 'put')
  t.is(validationEvents[4].type, 'put')
  t.is(validationEvents[4].path, '/foo')

  await monitor.close()
  await contract.close()
})