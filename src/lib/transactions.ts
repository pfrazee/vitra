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
    const acks = await Promise.all(this.ops.map(op => this.contract._fetchOpAck(op)))
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

  async fetchResults () {
    return await Promise.all(this.ops.map(op => this.contract._fetchOpResults(op)))
  }
}
