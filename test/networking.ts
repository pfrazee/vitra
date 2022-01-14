import ava from 'ava'
import { StorageInMemory, Database } from '../src/index.js'

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

ava('can load and read over the network', async t => {
  const db1 = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })
  await db1.swarm({local: true})
  const tx1 = await db1.call('put', {path: '/foo', value: 'hello world'})
  await tx1.whenProcessed()

  const db2 = await Database.load(new StorageInMemory(), db1.pubkey)
  await db2.swarm({local: true})
  await db2.whenConnected()

  const tx2 = await db2.call('get', {path: '/foo'})
  t.is(tx2.response.value, 'hello world')

  await db1.close()
  await db2.close()
})
