import assert from 'assert'
import { Contract } from './contract.js'
import { OpLog } from './log.js'
import { BlockInclusionProof } from './proofs.js'

export class Operation {
  constructor (public oplog: OpLog, public proof: BlockInclusionProof, public value: any) {
  }

  async verifyInclusion () {
    await this.oplog.verifyBlockInclusionProof(this.proof)
  }
}

export class Transaction {
  constructor (public contract: Contract, public response: any, public ops: Operation[]) {
  }

  async verifyInclusion () {
    await Promise.all(this.ops.map(op => op.verifyInclusion()))
  }

  async isProcessed () {
    const acks = await this.fetchAcks()
    return acks.reduce((acc, ack) => acc && !!ack, true)
  }

  async whenProcessed (opts: {timeout?: number} = {}): Promise<void> {
    let isTimedOut = false
    if (opts.timeout) {
      setTimeout(() => { isTimedOut = true }, opts.timeout).unref()
    }
    let backoff = 5
    while (true) {
      if (isTimedOut) throw new Error('Timed out')
      if (await this.isProcessed()) return
      await new Promise(r => setTimeout(r, backoff))
      backoff *= 10
    }
  }

  async fetchAcks () {
    assert(this.contract, 'Contract not loaded')
    const c = this.contract as Contract
    return await Promise.all(this.ops.map(op => c._fetchOpAck(op)))
  }

  async fetchResults () {
    assert(this.contract, 'Contract not loaded')
    const c = this.contract as Contract
    return await Promise.all(this.ops.map(op => c._fetchOpResults(op)))
  }

  async toJSON (opts?: {includeValues: boolean}) {
    const results = opts?.includeValues ? await this.fetchResults() : await this.fetchAcks()
    const isProcessed = results.reduce((acc, ack) => acc && !!ack, true)
    return {
      itoTransaction: 1,
      contractPubkey: this.contract.pubkey.toString('hex'),
      isProcessed,
      response: opts?.includeValues ? this.response : undefined,
      operations: this.ops.map((op, i) => {
        let result = undefined
        if (results[i]) {
          const r = results[i] as any
          result = {success: r.success, error: r.error, processedAt: r.ts, changes: r.changes}
        }
        return {
          value: opts?.includeValues ? op.value : undefined,
          proof: op.proof.toJSON(),
          result
        }
      })
    }
  }

  static fromJSON (contract: Contract, obj: any): Transaction {
    assert(contract?.opened, 'Contract must be opened')
    assert(obj.itoTransaction >= 1, 'Invalid schema version')
    assert(typeof obj.contractPubkey === 'string' && obj.contractPubkey.length === 64, 'Invalid contractPubkey')
    assert(Array.isArray(obj.operations), 'Invalid operations')
    const ops = obj.operations.map((opObj: any, i: number) => {
      assert(opObj.proof && typeof opObj.proof === 'object', `Invalid operations[${i}].proof`)
      const proof = BlockInclusionProof.fromJSON(opObj.proof)
      const oplog = contract.getParticipant(proof.logPubkey)
      if (!oplog) throw new Error(`Contract oplog not found: ${proof.logPubkey.toString('hex')}`)
      return new Operation(oplog, proof, opObj.value)
    })
    return new Transaction(contract, obj.response, ops)
  }
}
