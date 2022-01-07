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

ava.skip('op inclusion proof: invalid, oplog removed operation after publishing', async t => {
})

ava.skip('fraud proof: oplog broke append-only', async t => {
  // TODO
})

ava.skip('fraud proof: index broke append-only', async t => {
  // TODO
})

ava.skip('fraud proof: executor broke contract', async t => {
  // TODO
})