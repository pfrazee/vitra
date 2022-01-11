import ava from 'ava'
import { StorageInMemory, Database, ExecutorBehavior, OpLog } from '../src/index.js'

const CONTRACT = `
import assert from 'assert'
import { index } from 'contract'

export function get ({key}, emit) {
  assert(typeof key === 'string' && key.length > 0)
  return index.get(key)
}

export function put ({key, value}, emit) {
  assert(typeof key === 'string' && key.length > 0)
  emit({op: 'PUT', key, value})
}

export function addOplog ({pubkey}, emit) {
  assert(typeof pubkey === 'string' && pubkey.length === 64)
  emit({op: 'ADD_OPLOG', pubkey})
}

export function addOplogs ({pubkeys}, emit) {
  assert(Array.isArray(pubkeys))
  for (const pubkey of pubkeys) {
    assert(typeof pubkey === 'string' && pubkey.length === 64)
  }
  emit({op: 'ADD_OPLOGS', pubkeys})
}

export function removeOplog ({pubkey}, emit) {
  assert(typeof pubkey === 'string' && pubkey.length === 64)
  emit({op: 'REMOVE_OPLOG', pubkey})
}

export function removeOplogs ({pubkeys}, emit) {
  assert(Array.isArray(pubkeys))
  for (const pubkey of pubkeys) {
    assert(typeof pubkey === 'string' && pubkey.length === 64)
  }
  emit({op: 'REMOVE_OPLOGS', pubkeys})
}

export const apply = {
  PUT (tx, op) {
    tx.put(op.key, op.value)
  },
  ADD_OPLOG (tx, op) {
    tx.addOplog({pubkey: op.pubkey})
  },
  ADD_OPLOGS (tx, op) {
    for (const pubkey of op.pubkeys) {
      tx.addOplog({pubkey})
    }
  },
  REMOVE_OPLOG (tx, op) {
    tx.removeOplog({pubkey: op.pubkey})
  },
  REMOVE_OPLOGS (tx, op) {
    for (const pubkey of op.pubkeys) {
      tx.removeOplog({pubkey})
    }
  }
}
`

ava('add oplogs', async t => {
  const storage1 = new StorageInMemory()
  const storage2 = new StorageInMemory()
  const db = await Database.create(storage1, {
    contract: {source: CONTRACT}
  })
  const dbPubkey = db.pubkey

  const oplogCores: any[] = []
  for (let i = 0; i < 10; i++) {
    oplogCores.push(await storage2.createHypercore())
  }

  await db.call('addOplog', {pubkey: oplogCores[0].key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 2)
  t.is(db.oplogs.at(1)?.pubkey.toString('hex'), oplogCores[0].key.toString('hex'))

  await db.call('addOplog', {pubkey: oplogCores[1].key.toString('hex')})
  await db.call('addOplog', {pubkey: oplogCores[2].key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 4)
  t.is(db.oplogs.at(2)?.pubkey.toString('hex'), oplogCores[1].key.toString('hex'))
  t.is(db.oplogs.at(3)?.pubkey.toString('hex'), oplogCores[2].key.toString('hex'))

  await db.call('addOplogs', {pubkeys: oplogCores.slice(3).map(core => core.key.toString('hex'))})
  await db.executor?.sync()
  t.is(db.oplogs.length, 11)
  for (let i = 3; i < 10; i++) {
    t.truthy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }
  
  // check read from fresh
  const db2 = await Database.load(storage1, dbPubkey, {executorBehavior: ExecutorBehavior.DISABLED})
  t.is(db2.oplogs.length, 11)
  for (let i = 0; i < 10; i++) {
    t.truthy(!!db2.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await db.close()
})

ava('remove oplogs', async t => {
  const storage1 = new StorageInMemory()
  const storage2 = new StorageInMemory()
  const db = await Database.create(storage1, {
    contract: {source: CONTRACT}
  })
  const dbPubkey = db.pubkey

  const oplogCores: any[] = []
  for (let i = 0; i < 10; i++) {
    oplogCores.push(await storage2.createHypercore())
  }

  await db.call('addOplogs', {pubkeys: oplogCores.slice(0, 5).map(core => core.key.toString('hex'))})
  await db.executor?.sync()
  t.is(db.oplogs.length, 6)
  for (let i = 0; i < 5; i++) {
    t.truthy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await db.call('removeOplog', {pubkey: oplogCores[0].key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 5)
  t.falsy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[0].key)))

  await db.call('removeOplog', {pubkey: oplogCores[1].key.toString('hex')})
  await db.call('removeOplog', {pubkey: oplogCores[2].key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 3)
  t.falsy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[1].key)))
  t.falsy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[2].key)))

  await db.call('addOplogs', {pubkeys: oplogCores.slice(5).map(core => core.key.toString('hex'))})
  await db.executor?.sync()
  t.is(db.oplogs.length, 8)
  for (let i = 3; i < 10; i++) {
    t.truthy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await db.call('removeOplogs', {pubkeys: oplogCores.slice(0, 9).map(core => core.key.toString('hex'))})
  await db.executor?.sync()
  t.is(db.oplogs.length, 2)
  for (let i = 0; i < 9; i++) {
    t.falsy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }
  t.truthy(!!db.oplogs.find(o => o.pubkey.equals(oplogCores[9].key)))
  
  // check read from fresh
  const db2 = await Database.load(storage1, dbPubkey, {executorBehavior: ExecutorBehavior.DISABLED})
  t.is(db2.oplogs.length, 2)
  t.truthy(!!db2.oplogs.find(o => o.pubkey.equals(oplogCores[9].key)))

  await db.close()
})

ava('execute ops on added oplogs', async t => {
  const storage = new StorageInMemory()
  const db = await Database.create(storage, {
    contract: {source: CONTRACT}
  })

  const secondOplogCore = await storage.createHypercore()
  await db.call('addOplog', {pubkey: secondOplogCore.key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 2)
  t.is(db.oplogs.at(1)?.pubkey.toString('hex'), secondOplogCore.key.toString('hex'))

  // execute transactions on the second oplog

  await db.setLocalOplog(db.oplogs.at(1))
  
  const tx = await db.call('put', {key: 'foo', value: 'bar'})
  await tx.whenProcessed()
  const tx2 = await db.call('get', {key: 'foo'})
  t.is(tx2.response.value, 'bar')

  const tx3 = await db.call('put', {key: 'foo', value: 'baz'})
  await tx3.whenProcessed()
  const tx4 = await db.call('get', {key: 'foo'})
  t.is(tx4.response.value, 'baz')

  t.is(db.oplogs.at(0)?.length, 1)
  t.is(db.oplogs.at(1)?.length, 2)

  await db.close()
})

ava('dont execute ops on removed oplogs', async t => {
  const storage = new StorageInMemory()
  const db = await Database.create(storage, {
    contract: {source: CONTRACT}
  })

  const secondOplogCore = await storage.createHypercore()
  await db.call('addOplog', {pubkey: secondOplogCore.key.toString('hex')})
  await db.executor?.sync()
  t.is(db.oplogs.length, 2)
  t.is(db.oplogs.at(1)?.pubkey.toString('hex'), secondOplogCore.key.toString('hex'))
  const secondOplogPubkey = db.oplogs.at(1)?.pubkey

  // execute transactions on the second oplog

  await db.setLocalOplog(db.oplogs.at(1))
  
  const tx = await db.call('put', {key: 'foo', value: 'bar'})
  await tx.whenProcessed()
  const tx2 = await db.call('get', {key: 'foo'})
  t.is(tx2.response.value, 'bar')

  // remove the second oplog

  await db.setLocalOplog(db.oplogs.at(0))

  const tx3 = await db.call('removeOplog', {pubkey: db.oplogs.at(1)?.pubkey.toString('hex')})
  await tx3.whenProcessed()

  // try to execute another transaction (and fail)

  const secondOplog = new OpLog(await storage.getHypercore(secondOplogPubkey as Buffer), false)
  await db.setLocalOplog(secondOplog)

  await db.call('put', {key: 'foo', value: 'baz'})
  await db.executor?.sync()
  const tx4 = await db.call('get', {key: 'foo'})

  // not mutated...
  t.is(tx4.response.value, 'bar')
  // ...despite existence of second op
  t.is(secondOplog.length, 2)

  await db.close()
})