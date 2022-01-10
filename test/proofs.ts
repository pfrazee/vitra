import ava from 'ava'
import { StorageInMemory, Contract, verifyInclusionProof, Transaction } from '../src/index.js'

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
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {contract})
  
  await tx.whenProcessed()
  
  const txObj = await tx.toJSON({includeValues: true})
  t.is(txObj.isProcessed, true)
  t.is(txObj.operations[0]?.result?.success, true)
  t.is(txObj.operations[0]?.result?.changes?.length, 1)
  const txClone = Transaction.fromJSON(contract, txObj)
  await txClone.verifyInclusion()

  await contract.close()
})

ava('op inclusion proof: valid, unsuccessful transaction', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {contract})
  
  await tx.whenProcessed()
  
  const txObj = await tx.toJSON({includeValues: true})
  t.is(txObj.isProcessed, true)
  t.is(txObj.operations[0]?.result?.success, false)
  t.is(txObj.operations[0]?.result?.changes?.length, 0)
  const txClone = Transaction.fromJSON(contract, txObj)
  await txClone.verifyInclusion()

  await contract.close()
})

ava('fraud proof: oplog forked away an operation after publishing', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {contract})
  await tx.whenProcessed()
  
  // use truncate() to remove the operation
  await contract.myOplog?.core.truncate(0)

  try {
    await tx.ops[0].verifyInclusion()
    t.fail('Fraud not detected')
  } catch (e: any) {
    t.is(e.name, 'LogForkFraudProof')
    const obj: any = e.toJSON()
    t.is(obj.logPubkey, contract.myOplog?.pubkey.toString('hex'))
    t.is(obj.forkNumber, 1)
    t.is(obj.blockSeq, 0)
    t.truthy(typeof obj.rootHashAtBlock, 'string')
    t.truthy(typeof obj.rootHashSignature, 'string')
  }

  await contract.close()
})

ava('failed validation: oplog removed operation and cannot verify', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {contract})
  await tx.whenProcessed()
  
  // mutate the log without using truncate() by replacing it with a log from separate, unsynced storage
  const storage2 = new StorageInMemory()
  // @ts-ignore keyPairs will exist on contract.storage
  storage2.keyPairs = contract.storage.keyPairs
  const newCore = await storage2.getHypercore(contract.myOplog?.pubkey as Buffer)
  // @ts-ignore at(0) will exist
  contract.oplogs.at(0).core = newCore

  try {
    await tx.ops[0].verifyInclusion()
    t.fail('Fraud not detected')
  } catch (e: any) {
    t.is(e.name, 'BlocksNotAvailableError')
  }

  await contract.close()
})

ava('fraud proof: oplog removed operation after publishing without forking', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {path: '/foo', value: 'hello world'})
  
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.toJSON()
  await verifyInclusionProof(txOp0Proof, {contract})
  await tx.whenProcessed()
  
  // mutate the log without using truncate() by replacing it with a log from separate, unsynced storage
  const storage2 = new StorageInMemory()
  // @ts-ignore keyPairs will exist on contract.storage
  storage2.keyPairs = contract.storage.keyPairs
  const newCore = await storage2.getHypercore(contract.myOplog?.pubkey as Buffer)
  // @ts-ignore at(0) will exist
  contract.oplogs.at(0).core = newCore
  await contract.call('put', {path: '/foo', value: 'hello world!'})

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

  await contract.close()
})