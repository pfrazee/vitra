import ava from 'ava'
import { StorageInMemory, Database, OpLog } from '../src/index.js'

const CONTRACT = `
import assert from 'assert'
import { index } from 'contract'

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
  
  // TODO check read from fresh
  // const contract2 = await Contract.load(storage1, contractPubkey)
  // t.is(contract2.oplogs.length, 11)
  // for (let i = 0; i < 10; i++) {
  //   t.truthy(!!contract2.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  // }

  await db.close()
})

ava('remove oplogs', async t => {
  const storage1 = new StorageInMemory()
  const storage2 = new StorageInMemory()
  const db = await Database.create(storage1, {
    contract: {source: CONTRACT}
  })
  const dbPubkey = db.pubkey
  db.setMyOplog(db.executorOplog)

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
  
  // TODO check read from fresh
  // const contract2 = await Contract.load(storage1, contractPubkey)
  // t.is(contract2.oplogs.length, 2)
  // t.truthy(!!contract2.oplogs.find(o => o.pubkey.equals(oplogCores[9].key)))

  await db.close()
})

ava.skip('execute ops on added oplogs', async t => {
  // TODO
})

ava.skip('dont execute ops on removed oplogs', async t => {
  // TODO
})