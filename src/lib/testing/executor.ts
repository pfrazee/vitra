import { Database } from '../database.js'
import { ContractExecutor } from '../executor.js'
import { OpLog } from '../log.js'
import { IndexBatchEntry, keyToStr } from '../../types.js'
import { AckSchema, genAckPath } from '../../schemas.js'

export enum TestContractExecutorBehavior {
  PROCESS_OP_MULTIPLE_TIMES,
  SKIP_OPS,
  WRONG_OP_MUTATIONS
}

export class TestContractExecutor extends ContractExecutor {
  private _testingCounter = 0

  constructor (public db: Database, public behavior: TestContractExecutorBehavior) {
    super(db)
  }

  protected async _executeOp (log: OpLog, seq: number, opValue: any) {
    if (this.behavior === TestContractExecutorBehavior.PROCESS_OP_MULTIPLE_TIMES) {
      await super._executeOp(log, seq, opValue)
      await super._executeOp(log, seq, opValue)
    } else if (this.behavior === TestContractExecutorBehavior.SKIP_OPS) {
      if (++this._testingCounter % 2 === 0) {
        // skip
      } else {
        await super._executeOp(log, seq, opValue)
      }
    } else if (this.behavior === TestContractExecutorBehavior.WRONG_OP_MUTATIONS) {
      return this._executeOpWrongMutations(log, seq, opValue)
    } else {
      await super._executeOp(log, seq, opValue)
    }
  }

  async _executeOpWrongMutations (log: OpLog, seq: number, opValue: any) {
    const ack: AckSchema = {
      success: true,
      error: undefined,
      origin: keyToStr(log.pubkey),
      seq,
      ts: Date.now(),
      metadata: undefined,
      numChanges: 0
    }
    const batch: IndexBatchEntry[] = [
      {
        type: 'put',
        path: genAckPath(log.pubkey, seq),
        value: ack
      },
      {
        type: 'put',
        path: '/wrong',
        value: {bad: 'data'}
      }
    ]
    await this.db._executeApplyBatch(batch)
    this._putLastExecutedSeq(log, seq)
    this.emit('op-executed', log, seq, opValue)
  }
}