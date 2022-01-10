import assert from 'assert'
import { Database } from './database.js'
import { OpLog } from './log.js'
import { BlockInclusionProof } from './inclusion-proofs.js'

export class Operation {
  constructor (public oplog: OpLog, public proof: BlockInclusionProof, public value: any) {
  }

  async verifyInclusion () {
    await this.oplog.verifyBlockInclusionProof(this.proof)
  }
}

export class Transaction {
  constructor (public db: Database, public response: any, public ops: Operation[]) {
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
    assert(this.db, 'DB not loaded')
    const c = this.db as Database
    return await Promise.all(this.ops.map(op => c._fetchOpAck(op)))
  }

  async fetchResults () {
    assert(this.db, 'DB not loaded')
    const c = this.db as Database
    return await Promise.all(this.ops.map(op => c._fetchOpResults(op)))
  }

  async toJSON (opts?: {includeValues: boolean}) {
    const results = opts?.includeValues ? await this.fetchResults() : await this.fetchAcks()
    const isProcessed = results.reduce((acc, ack) => acc && !!ack, true)
    return {
      vitraTransaction: 1,
      databasePubkey: this.db.pubkey.toString('hex'),
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

  static fromJSON (db: Database, obj: any): Transaction {
    assert(db?.opened, 'DB must be opened')
    assert(obj.vitraTransaction >= 1, 'Invalid schema version')
    assert(typeof obj.databasePubkey === 'string' && obj.databasePubkey.length === 64, 'Invalid databasePubkey')
    assert(Array.isArray(obj.operations), 'Invalid operations')
    const ops = obj.operations.map((opObj: any, i: number) => {
      assert(opObj.proof && typeof opObj.proof === 'object', `Invalid operations[${i}].proof`)
      const proof = BlockInclusionProof.fromJSON(opObj.proof)
      const oplog = db.getParticipant(proof.logPubkey)
      if (!oplog) throw new Error(`Database oplog not found: ${proof.logPubkey.toString('hex')}`)
      return new Operation(oplog, proof, opObj.value)
    })
    return new Transaction(db, obj.response, ops)
  }
}
