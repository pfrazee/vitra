import ava from 'ava'
import { ItoStorageInMemory, ItoContract } from '../src/index.js'

const CONTRACT = `
export async function succeed (_, emit) {
  emit({op: 'SUCCEED'})
}

export async function fail (_, emit) {
  emit({op: 'FAIL'})
}

export function process (op) {
  return {foo: 'bar'}
}

export const apply = {
  SUCCEED (tx, op, ack) {
    tx.put('/success', ack.metadata)
  },
  FAIL (tx, op, ack) {
    throw new Error('TX failed')
  }
}
`

ava('process() metadata', async t => {
  const contract = await ItoContract.create(new ItoStorageInMemory(), {
    code: {source: CONTRACT}
  })
  await contract.call('succeed', {})
  await contract.executor?.sync()
  t.deepEqual((await contract.index.get('/success'))?.value, {foo: 'bar'})
  await contract.close()
})

ava('can await call results (success)', async t => {
  const contract = await ItoContract.create(new ItoStorageInMemory(), {
    code: {source: CONTRACT}
  })
  const res1 = await contract.call('succeed', {})
  await res1.whenProcessed()
  const res1Results = await res1.fetchResults()
  t.is(res1Results.length, 1)
  if (res1Results[0]) {
    t.truthy(res1Results[0].success)
    t.falsy(res1Results[0].error)
    t.is(typeof res1Results[0].seq, 'number')
    t.is(typeof res1Results[0].ts, 'number')
    t.deepEqual(res1Results[0].metadata, {foo: 'bar'})
    t.is(res1Results[0].numMutations, 1)
    t.is(res1Results[0].mutations.length, 1)
    if (res1Results[0].mutations[0]) {
      t.deepEqual(res1Results[0].mutations[0], {
        container: false,
        seq: 5,
        path: '/success',
        name: 'success',
        value: { foo: 'bar' }
      })
    }
  }
  await contract.close()
})

ava('can await call results (failure)', async t => {
  const contract = await ItoContract.create(new ItoStorageInMemory(), {
    code: {source: CONTRACT}
  })
  const res1 = await contract.call('fail', {})
  await res1.whenProcessed()
  const res1Results = await res1.fetchResults()
  t.is(res1Results.length, 1)
  if (res1Results[0]) {
    t.falsy(res1Results[0].success)
    t.is(res1Results[0].error, 'Error: TX failed')
    t.is(typeof res1Results[0].seq, 'number')
    t.is(typeof res1Results[0].ts, 'number')
    t.deepEqual(res1Results[0].metadata, {foo: 'bar'})
    t.is(res1Results[0].numMutations, 0)
    t.is(res1Results[0].mutations.length, 0)
  }
  await contract.close()
})