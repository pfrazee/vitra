import ava from 'ava'
import { StorageInMemory, Database, IndexHistoryEntry } from '../src/index.js'

const CONTRACT_V1 = `
import assert from 'assert'
import { index } from 'contract'

export async function get ({path}) {
  return await index.get(path)
}

export function put ({path, value}, emit) {
  emit({op: 'PUT', path, value})
}

export function setSource ({code}, emit) {
  emit({op: 'SET_SOURCE', code})
}

export const apply = {
  PUT (tx, op) {
    tx.put(op.path, op.value)
  },
  SET_SOURCE (tx, op) {
    tx.setContractSource({code: op.code})
  }
}
`

const CONTRACT_V2 = `
import assert from 'assert'
import { index } from 'contract'

export async function getValue ({path}) {
  return await index.get(path)
}

export function putValue ({path, value}, emit) {
  emit({op: 'PUT', path, value})
}

export const apply = {
  PUT (tx, op) {
    tx.put(op.path, op.value)
  }
}
`

ava('change contract source during execution', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: CONTRACT_V1}
  })

  // execution

  const res1 = await db.call('get', {path: '/foo'})
  const res2 = await db.call('put', {path: '/foo', value: 'hello world'})
  await res2.whenProcessed()
  const res3 = await db.call('get', {path: '/foo'})
  t.falsy(res1.response)
  t.deepEqual(res2.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world' })
  t.is(res3.response.value, 'hello world')

  const res4 = await db.call('setSource', {code: CONTRACT_V2})
  await res4.whenProcessed()
  const res4Results = await res4.fetchResults()
  t.is(res4Results[0]?.changes[0]?.path, '/.sys/contract/source')
  t.is(res4Results[0]?.changes[0]?.value, CONTRACT_V2)

  const res5 = await db.call('putValue', {path: '/foo', value: 'hello world!'})
  await res5.whenProcessed()
  const res6 = await db.call('getValue', {path: '/foo'})
  t.deepEqual(res5.ops[0].value, { op: 'PUT', path: '/foo', value: 'hello world!' })
  t.is(res6.response.value, 'hello world!')

  // verification

  await db.verify()

  await db.close()
})