import EventEmitter from 'events'
// @ts-ignore no types available -prf
import assert from 'assert'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import * as msgpackr from 'msgpackr'
import {
  ItoAck,
  ItoIndexBatchEntry,
  CONTRACT_SOURCE_KEY,
  PARTICIPANT_KEY_PREFIX,
  ACK_KEY_PREFIX,
  Key,
  keyToStr
} from '../types.js'
import { ItoContract } from './contract.js'
import { ItoOpLog, ReadStream } from './log.js'

const OPLOG_WATCH_RETRY_TIMEOUT = 5e3

export class ItoContractExecutor extends EventEmitter {
  private _lastExecutedSeqs: Map<string, number> = new Map()
  private _oplogReadStreams: Map<string, ReadStream> = new Map()
  constructor (public contract: ItoContract) {
    super()
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

  async sync () {
    await Promise.all(this.contract.oplogs.map(oplog => oplog.core.update()))
    const remaining: Map<string, number> = new Map()
    for (const oplog of this.contract.oplogs) {
      const current = this._getLastExecutedSeq(oplog, -1)
      const target = oplog.length - 1
      if (current < target) {
        remaining.set(keyToStr(oplog.pubkey), target)
      }
    }
    if (remaining.size === 0) {
      return
    }
    return new Promise(resolve => {
      const onEmit = (log: ItoOpLog, seq: number) => {
        const keystr = keyToStr(log.pubkey)
        const target = remaining.get(keystr)
        if (typeof target !== 'undefined' && target <= seq) {
          remaining.delete(keystr)
        }
        if (remaining.size === 0) {
          this.removeListener('executed-op', onEmit)
          resolve(undefined)
        }
      }
      this.on('executed-op', onEmit)
    })
  }

  // private methods
  // =

  private _getLastExecutedSeq (oplog: ItoOpLog, fallback = 0): number {
    // TODO
    console.debug('TODO: _getLastExecutedSeq()')
    return this._lastExecutedSeqs.get(keyToStr(oplog.pubkey)) || fallback
  }

  private _putLastExecutedSeq (oplog: ItoOpLog, seq: number) {
    // TODO
    console.debug('TODO: _putLastExecutedSeq()')
    this._lastExecutedSeqs.set(keyToStr(oplog.pubkey), seq)
  }

  private _createAckKey (): string {
    // TODO
    console.debug('TODO: _createAckKey()')
    return `${ACK_KEY_PREFIX}${Date.now()}`
  }

  private _watchOpLog (log: ItoOpLog) {
    const keystr = keyToStr(log.pubkey)
    if (this._oplogReadStreams.has(keystr)) return

    const start = this._getLastExecutedSeq(log)
    const s = log.createLogReadStream({start, live: true})
    this._oplogReadStreams.set(keystr, s)

    s.on('data', (entry: {seq: number, value: any}) => this._executeOp(log, entry.seq, msgpackr.unpack(entry.value)))
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
        const processRes = await this.contract.vm.contractProcess(opValue)
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
        const applyRes = await this.contract.vm.contractApply(opValue, ack)
        batch = convertApplyActionsToBatch(applyRes.actions)
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
        type: 'put',
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
          if (batchEntry.type === 'put') {
            await this._onAddOplog(pubkey)
          } else if (batchEntry.type === 'delete') {
            await this._onRemoveOplog(pubkey)
          }
        }
      }

      this.emit('executed-op', log, seq, opValue)
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

type ActionValue = {type: string, value?: any}
function convertApplyActionsToBatch (actions: Record<string, ActionValue>): ItoIndexBatchEntry[] {
  return Object.entries(actions)
    .map(([key, action]) => ({key, type: action.type, value: action.value}))
    .sort((a, b) => a.key.localeCompare(b.key))
}