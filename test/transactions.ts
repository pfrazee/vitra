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
  t.deepEqual((await contract.index.get('/success')).value, {foo: 'bar'})
  await contract.close()
})

ava.skip('can await call results (success)', async t => {
  const contract = await ItoContract.create(new ItoStorageInMemory(), {
    code: {source: CONTRACT}
  })
  const res1 = await contract.call('succeed', {})
  await res1.whenApplied()
  // TODO
  await contract.close()
})

ava.skip('can await call results (failure)', async t => {
  const contract = await ItoContract.create(new ItoStorageInMemory(), {
    code: {source: CONTRACT}
  })
  const res1 = await contract.call('fail', {})
  await res1.whenApplied()
  // TODO
  await contract.close()
})