import ava from 'ava'
import { StorageInMemory, Database, ContractParseError, ContractRuntimeError } from '../src/index.js'

ava.skip('can create test sandboxes of active contracts without affecting the active deployment', async t => {
  // TODO
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