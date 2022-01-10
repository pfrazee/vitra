import ava from 'ava'
import { StorageInMemory, Database, verifyInclusionProof, Transaction } from '../src/index.js'

const SIMPLE_CONTRACT = `
import assert from 'assert'
import { index } from 'contract'

export function put ({path, value}, emit) {
  emit({op: 'PUT', path, value})
  return {done: true}
}

export const apply = {
  PUT (tx, op, ack) {
    assert(typeof op.path === 'string' && op.path.length > 0)
    tx.put(op.path, op.value)
  }
}
`

ava('op inclusion proof: valid, successful transaction', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  const tx = await db.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {database: db})
  
  await tx.whenProcessed()
  
  const txObj = await tx.toJSON({includeValues: true})
  t.is(txObj.isProcessed, true)
  t.is(txObj.operations[0]?.result?.success, true)
  t.is(txObj.operations[0]?.result?.changes?.length, 1)
  const txClone = Transaction.fromJSON(db, txObj)
  await txClone.verifyInclusion()

  await db.close()
})

ava('op inclusion proof: valid, unsuccessful transaction', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  const tx = await db.call('put', {value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {database: db})
  
  await tx.whenProcessed()
  
  const txObj = await tx.toJSON({includeValues: true})
  t.is(txObj.isProcessed, true)
  t.is(txObj.operations[0]?.result?.success, false)
  t.is(txObj.operations[0]?.result?.changes?.length, 0)
  const txClone = Transaction.fromJSON(db, txObj)
  await txClone.verifyInclusion()

  await db.close()
})

ava('fraud proof: oplog forked away an operation after publishing', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  const tx = await db.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {database: db})
  await tx.whenProcessed()
  
  // use truncate() to remove the operation
  await db.myOplog?.core.truncate(0)

  try {
    await tx.ops[0].verifyInclusion()
    t.fail('Fraud not detected')
  } catch (e: any) {
    t.is(e.name, 'LogForkFraudProof')
    const obj: any = e.toJSON()
    t.is(obj.logPubkey, db.myOplog?.pubkey.toString('hex'))
    t.is(obj.forkNumber, 1)
    t.is(obj.blockSeq, 0)
    t.truthy(typeof obj.rootHashAtBlock, 'string')
    t.truthy(typeof obj.rootHashSignature, 'string')
  }

  await db.close()
})

ava('failed validation: oplog removed operation and cannot verify', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  const tx = await db.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {database: db})
  await tx.whenProcessed()
  
  // mutate the log without using truncate() by replacing it with a log from separate, unsynced storage
  const storage2 = new StorageInMemory()
  // @ts-ignore keyPairs will exist on contract.storage
  storage2.keyPairs = db.storage.keyPairs
  const newCore = await storage2.getHypercore(db.myOplog?.pubkey as Buffer)
  // @ts-ignore at(0) will exist
  db.oplogs.at(0).core = newCore

  try {
    await tx.ops[0].verifyInclusion()
    t.fail('Fraud not detected')
  } catch (e: any) {
    t.is(e.name, 'BlocksNotAvailableError')
  }

  await db.close()
})

ava('fraud proof: oplog removed operation after publishing without forking', async t => {
  const db = await Database.create(new StorageInMemory(), {
    contract: {source: SIMPLE_CONTRACT}
  })

  const tx = await db.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {database: db})
  await tx.whenProcessed()
  
  // mutate the log without using truncate() by replacing it with a log from separate, unsynced storage
  const storage2 = new StorageInMemory()
  // @ts-ignore keyPairs will exist on contract.storage
  storage2.keyPairs = db.storage.keyPairs
  const newCore = await storage2.getHypercore(db.myOplog?.pubkey as Buffer)
  // @ts-ignore at(0) will exist
  db.oplogs.at(0).core = newCore
  await db.call('put', {path: '/foo', value: 'hello world!'})

  try {
    await tx.ops[0].verifyInclusion()
    t.fail('Fraud not detected')
  } catch (e: any) {
    t.is(e.name, 'BlockRewriteFraudProof')
    const obj: any = e.toJSON()
    t.is(obj.givenInclusionProof.logPubkey, obj.violatingInclusionProof.logPubkey)
    t.is(obj.givenInclusionProof.blockSeq, obj.violatingInclusionProof.blockSeq)
    t.notDeepEqual(obj.givenInclusionProof.rootHashAtBlock, obj.violatingInclusionProof.rootHashAtBlock)
    t.notDeepEqual(obj.givenInclusionProof.rootHashSignature, obj.violatingInclusionProof.rootHashSignature)
  }

  await db.close()
})