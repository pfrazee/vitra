import ava from 'ava'
import { ItoStorageInMemory, ItoContract, ItoOpLog } from '../src/index.js'

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
  const storage1 = new ItoStorageInMemory()
  const storage2 = new ItoStorageInMemory()
  const contract = await ItoContract.create(storage1, {
    code: {source: CONTRACT}
  })
  const contractPubkey = contract.pubkey

  const oplogCores: any[] = []
  for (let i = 0; i < 10; i++) {
    oplogCores.push(await storage2.createHypercore())
  }

  await contract.call('addOplog', {pubkey: oplogCores[0].key.toString('hex')})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 2)
  t.is(contract.oplogs[1].pubkey.toString('hex'), oplogCores[0].key.toString('hex'))

  await contract.call('addOplog', {pubkey: oplogCores[1].key.toString('hex')})
  await contract.call('addOplog', {pubkey: oplogCores[2].key.toString('hex')})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 4)
  t.is(contract.oplogs[2].pubkey.toString('hex'), oplogCores[1].key.toString('hex'))
  t.is(contract.oplogs[3].pubkey.toString('hex'), oplogCores[2].key.toString('hex'))

  await contract.call('addOplogs', {pubkeys: oplogCores.slice(3).map(core => core.key.toString('hex'))})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 11)
  for (let i = 3; i < 10; i++) {
    t.truthy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }
  
  const contract2 = await ItoContract.load(storage1, contractPubkey)
  t.is(contract2.oplogs.length, 11)
  for (let i = 0; i < 10; i++) {
    t.truthy(!!contract2.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await contract.close()
  await contract2.close()
})

ava('remove oplogs', async t => {
  const storage1 = new ItoStorageInMemory()
  const storage2 = new ItoStorageInMemory()
  const contract = await ItoContract.create(storage1, {
    code: {source: CONTRACT}
  })
  const contractPubkey = contract.pubkey

  const oplogCores: any[] = []
  for (let i = 0; i < 10; i++) {
    oplogCores.push(await storage2.createHypercore())
  }

  await contract.call('addOplogs', {pubkeys: oplogCores.slice(0, 5).map(core => core.key.toString('hex'))})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 6)
  for (let i = 0; i < 5; i++) {
    t.truthy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await contract.call('removeOplog', {pubkey: oplogCores[0].key.toString('hex')})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 5)
  t.falsy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[0].key)))

  await contract.call('removeOplog', {pubkey: oplogCores[1].key.toString('hex')})
  await contract.call('removeOplog', {pubkey: oplogCores[2].key.toString('hex')})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 3)
  t.falsy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[1].key)))
  t.falsy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[2].key)))

  await contract.call('addOplogs', {pubkeys: oplogCores.slice(5).map(core => core.key.toString('hex'))})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 8)
  for (let i = 3; i < 10; i++) {
    t.truthy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }

  await contract.call('removeOplogs', {pubkeys: oplogCores.slice(0, 9).map(core => core.key.toString('hex'))})
  await contract.executor?.sync()
  t.is(contract.oplogs.length, 2)
  for (let i = 0; i < 9; i++) {
    t.falsy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[i].key)))
  }
  t.truthy(!!contract.oplogs.find(o => o.pubkey.equals(oplogCores[9].key)))
  
  const contract2 = await ItoContract.load(storage1, contractPubkey)
  t.is(contract2.oplogs.length, 2)
  t.truthy(!!contract2.oplogs.find(o => o.pubkey.equals(oplogCores[9].key)))

  await contract.close()
  await contract2.close()
})

ava.skip('execute ops on added oplogs', async t => {
  throw new Error('TODO')
})

ava.skip('dont execute ops on removed oplogs', async t => {
  throw new Error('TODO')
})