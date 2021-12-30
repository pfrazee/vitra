// @ts-ignore no types available -prf
import assert from 'assert'
// @ts-ignore no types available -prf
import { AggregateError } from 'core-js-pure/actual/aggregate-error.js'
import {
  ItoAck,
  ItoIndexBatchEntry,
  CONTRACT_SOURCE_KEY,
  PARTICIPANT_KEY_PREFIX,
  Key,
  keyToStr
} from '../types.js'
import { ItoContract } from './contract.js'
import { ItoOpLog, ReadStream } from './log.js'

const OPLOG_WATCH_RETRY_TIMEOUT = 5e3

export class ItoContractExecutor {
  private _oplogReadStreams: Map<string, ReadStream> = new Map()
  constructor (public contract: ItoContract) {
  }

  // public api
  // =

  start () {
    if (!this.contract.isExecutor) {
      throw new Error('Not the executor')
    }
    for (const log of this.contract.oplogs) {
      this._watchOpLog(log)
    }
  }

  stop () {
    for (const readStream of this._oplogReadStreams.values()) {
      readStream.destroy()
    }
  }

  // private methods
  // =

  private _getLastExecutedSeq (oplog: ItoOpLog): number {
    throw new Error('TODO')
  }

  private _putLastExecutedSeq (oplog: ItoOpLog, seq: number) {
    throw new Error('TODO')
  }

  private _createAckKey (): string {
    throw new Error('TODO')
  }

  private _watchOpLog (log: ItoOpLog) {
    const keystr = keyToStr(log.pubkey)
    if (this._oplogReadStreams.has(keystr)) return

    const start = this._getLastExecutedSeq(log)
    const s = log.createLogReadStream({start, live: true})
    this._oplogReadStreams.set(keystr, s)

    s.on('data', (entry: {seq: number, value: any}) => this._executeOp(log, entry.seq, entry.value))
    s.on('error', (err: any) => {
      this.contract.emit('error', new AggregateError([err], `An error occurred while reading oplog ${keystr}`))
    })
    s.on('close', () => {
      this._oplogReadStreams.delete(keystr)
      if (!this.contract.closing && !this.contract.closed) {
        // try again
        setTimeout(() => {
          this._watchOpLog(log)
        }, OPLOG_WATCH_RETRY_TIMEOUT).unref()
      }
    })
  }

  private async _executeOp (log: ItoOpLog, seq: number, opValue: any) {
    const release = await this.contract.lock('_executeOp')
    try {
      assert(!!this.contract.vm, 'Contract VM not initialized')

      // enter restricted mode
      await this.contract.vm.restrict()

      // call process() if it exists
      let metadata = undefined
      try {
        const processRes = await this.contract.vm.handleAPICall('process', [opValue])
        metadata = processRes.result
      } catch (e) {
        console.debug('Failed to call process()', e)
      }

      // create ack object
      const ack: ItoAck = {
        success: undefined,
        error: undefined,
        origin: keyToStr(log.pubkey),
        seq,
        ts: Date.now(),
        metadata
      }

      // call apply()
      let applySuccess = undefined
      let batch: ItoIndexBatchEntry[] = []
      let applyError
      try {
        const applyRes = await this.contract.vm.handleAPICall('apply', [opValue, ack])
        batch = convertApplyActionsToBatch(applyRes)
        applySuccess = true
      } catch (e: any) {
        applyError = e
        applySuccess = false
      }

      // leave restricted mode
      await this.contract.vm.unrestrict()

      // write the result
      if (applySuccess) {
        ack.success = true
      } else {
        ack.success = false
        ack.error = applyError
        batch.length = 0
      }
      batch.unshift({
        action: 'put',
        key: this._createAckKey(),
        value: ack
      })
      await this.contract.index.dangerousBatch(batch)
      this._putLastExecutedSeq(log, seq)

      // react to config changes
      for (const batchEntry of batch) {
        if (batchEntry.key === CONTRACT_SOURCE_KEY) {
          await this._onContractCodeChange(batchEntry.value)
        } else if (batchEntry.key.startsWith(PARTICIPANT_KEY_PREFIX)) {
          const pubkey = batchEntry.key.slice(PARTICIPANT_KEY_PREFIX.length)
          if (batchEntry.action === 'put') {
            await this._onAddOplog(pubkey)
          } else if (batchEntry.action === 'delete') {
            await this._onRemoveOplog(pubkey)
          }
        }
      }
    } finally {
      release()
    }
  }

  _onContractCodeChange (code: string) {
    throw new Error('TODO')
  }

  _onAddOplog (pubkey: Key) {
    throw new Error('TODO')
  }

  _onRemoveOplog (pubkey: Key) {
    throw new Error('TODO')
  }
}

type ActionValue = {action: string, value?: any}
function convertApplyActionsToBatch (actions: Record<string, ActionValue>): ItoIndexBatchEntry[] {
  return Object.entries(actions)
    .map(([key, action]) => ({key, action: action.action, value: action.value}))
    .sort((a, b) => a.key.localeCompare(b.key))
}