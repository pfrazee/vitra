import ava from 'ava'
import { StorageInMemory, Database } from '../src/index.js'

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
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: CONTRACT}
  })
  await db.call('succeed', {})
  await db.executor?.sync()
  t.deepEqual((await db.index.get('/success'))?.value, {foo: 'bar'})
  await db.close()
})

ava('can await call results (success)', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: CONTRACT}
  })
  const res1 = await db.call('succeed', {})
  await res1.whenProcessed()
  const res1Results = await res1.fetchResults()
  t.is(res1Results.length, 1)
  if (res1Results[0]) {
    t.truthy(res1Results[0].success)
    t.falsy(res1Results[0].error)
    t.is(typeof res1Results[0].seq, 'number')
    t.is(typeof res1Results[0].ts, 'number')
    t.deepEqual(res1Results[0].metadata, {foo: 'bar'})
    t.is(res1Results[0].numChanges, 1)
    t.is(res1Results[0].changes.length, 1)
    if (res1Results[0].changes[0]) {
      t.deepEqual(res1Results[0].changes[0], {
        type: 'put',
        seq: 5,
        path: '/success',
        value: { foo: 'bar' }
      })
    }
  }
  await db.close()
})

ava('can await call results (failure)', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: CONTRACT}
  })
  const res1 = await db.call('fail', {})
  await res1.whenProcessed()
  const res1Results = await res1.fetchResults()
  t.is(res1Results.length, 1)
  if (res1Results[0]) {
    t.falsy(res1Results[0].success)
    t.is(res1Results[0].error, 'Error: TX failed')
    t.is(typeof res1Results[0].seq, 'number')
    t.is(typeof res1Results[0].ts, 'number')
    t.deepEqual(res1Results[0].metadata, {foo: 'bar'})
    t.is(res1Results[0].numChanges, 0)
    t.is(res1Results[0].changes.length, 0)
  }
  await db.close()
})