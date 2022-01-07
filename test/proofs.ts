import ava from 'ava'
import { StorageInMemory, Contract, verifyInclusionProof } from '../src/index.js'

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

ava('inclusion proofs: op, transaction, and transaction-result', async t => {
  const contract = await Contract.create(new StorageInMemory(), {
    code: {source: SIMPLE_CONTRACT}
  })

  const tx = await contract.call('put', {path: '/foo', value: 'hello world'})
  t.is(tx.ops.length, 1)
  await tx.ops[0].verifyInclusion()
  const txOp0Proof = tx.ops[0].proof.serialize()
  await verifyInclusionProof(txOp0Proof, {contract})
  
  const txResults = await tx.fetchResults()
  t.is(txResults.length, 1)


  await contract.close()
})

ava.skip('failed op inclusion proof', async t => {
  // TODO
})

ava.skip('failed transaction-result inclusion proof', async t => {
  // TODO
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