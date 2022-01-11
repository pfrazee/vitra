import ava from 'ava'
import { StorageInMemory, Database, ContractParseError, ContractRuntimeError } from '../src/index.js'

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

const SIMPLE_CONTRACT_MODIFIED = `
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
    tx.put(op.path, op.value.toUpperCase())
  }
}
`

ava.only('can create test sandboxes of active contracts without affecting the active deployment', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  await db.call('put', {path: '/foo', value: 'hello world'})
  await db.executor?.sync()
  
  const sbxDb = await Database.createSandbox({from: db})

  const res1 = await sbxDb.call('get', {path: '/foo'})
  await sbxDb.call('put', {path: '/foo', value: 'hello sandbox'})
  await sbxDb.executor?.sync()

  const sbxDb2 = await Database.createSandbox({from: db, contract: {source: SIMPLE_CONTRACT_MODIFIED}})

  await sbxDb2.call('put', {path: '/foo', value: 'hello sandbox 2'})
  await sbxDb2.executor?.sync()

  const res2 = await db.call('get', {path: '/foo'})
  const res3 = await sbxDb.call('get', {path: '/foo'})
  const res4 = await sbxDb2.call('get', {path: '/foo'})
  t.is(res1.response?.value, 'hello world')
  t.is(res2.response?.value, 'hello world')
  t.is(res3.response?.value, 'hello sandbox')
  t.is(res4.response?.value, 'HELLO SANDBOX 2')

  await db.close()
})

ava('parsing errors in contract code', async t => {
  const PARSE_ERROR = `!@#$IASDFklj;14li3kjzs`
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: PARSE_ERROR}
  })
  let err: any
  db.on('error', _err => { err = _err })
  await db._startVM() // trigger vm start
  t.truthy(err instanceof ContractParseError)
  await db?.close()
})

ava('runtime errors in contract code', async t => {
  const RUNTIME_ERROR = `foo()`
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: RUNTIME_ERROR}
  })
  let err: any
  db.on('error', _err => { err = _err })
  await db._startVM() // trigger vm start
  t.truthy(err instanceof ContractRuntimeError)
  await db.close()
})

ava('runtime errors in a contract call', async t => {
  const RUNTIME_ERROR = `export function test () { foo() }`
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: RUNTIME_ERROR}
  })
  try {
    await db.call('test', {})
    t.fail('Should have thrown')
  } catch (e) {
    t.truthy(e instanceof ContractRuntimeError)
  }
  await db.close()
})

ava('runtime errors in apply()', async t => {
  const RUNTIME_ERROR = `
export function normalError (_, emit) { emit({op: 'NORMAL_ERROR'}) }
export function runtimeError (_, emit) { emit({op: 'RUNTIME_ERROR'}) }
export const apply = {
  NORMAL_ERROR () {
    throw new Error('Expected')
  },
  RUNTIME_ERROR () {
    foo()
  }
}
`
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: RUNTIME_ERROR}
  })

  let err: any
  db.on('error', _err => { err = _err })

  const tx1 = await db.call('normalError', {})
  await tx1.whenProcessed()
  const tx2 = await db.call('runtimeError', {})
  await tx2.whenProcessed()

  const tx1res = await tx1.fetchResults()
  const tx2res = await tx2.fetchResults()

  t.is(tx1res[0]?.error, 'Error: Expected')
  t.is(tx2res[0]?.error, 'ContractRuntimeError: The contract failed to execute with "ReferenceError: foo is not defined"')
  t.truthy(err instanceof ContractRuntimeError)

  await db.close()
})

ava('runtime errors in process()', async t => {
  const RUNTIME_ERROR = `
export function normalError (_, emit) { emit({op: 'NORMAL_ERROR'}) }
export function runtimeError (_, emit) { emit({op: 'RUNTIME_ERROR'}) }
export function process (op) {
  if (op.op === 'NORMAL_ERROR') {
    throw new Error('Expected')
  } else {
    foo()
  }
}
export const apply = {
  NORMAL_ERROR () {
    // do nothing
  },
  RUNTIME_ERROR () {
    // do nothing
  }
}
`
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: RUNTIME_ERROR}
  })

  let err: any
  db.on('error', _err => { err = _err })

  const tx1 = await db.call('normalError', {})
  await tx1.whenProcessed()
  const tx2 = await db.call('runtimeError', {})
  await tx2.whenProcessed()

  t.truthy(err instanceof ContractRuntimeError)

  await db.close()
})