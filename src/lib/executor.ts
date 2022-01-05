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

type ActionValue = {type: string, value?: any}

export class ItoContractExecutor extends EventEmitter {
  opening = false
  opened = false
  closing = false
  closed = false

  private _lastExecutedSeqs: Map<string, number> = new Map()
  private _oplogReadStreams: Map<string, ReadStream> = new Map()
  constructor (public contract: ItoContract) {
    super()
  }

  // public api
  // =

  open () {
    assert(!this.closing && !this.closed, 'Executor already closed')
    if (this.opened || this.opening) return
    this.opening = true
    if (!this.contract.isExecutor) {
      throw new Error('Not the executor')
    }
    for (const log of this.contract.oplogs) {
      this.watchOpLog(log)
    }
    this.opening = false
    this.opened = true
  }

  close () {
    assert(this.opened, 'Executor not opened')
    if (this.closing || this.closed) return
    this.closing = true
    for (const readStream of this._oplogReadStreams.values()) {
      readStream.destroy()
    }
    this.closing = false
    this.opened = false
    this.closed = true
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
          this.removeListener('op-executed', onEmit)
          resolve(undefined)
        }
      }
      this.on('op-executed', onEmit)
    })
  }

  watchOpLog (log: ItoOpLog) {
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
      if (!this.contract.closing && !this.contract.closed && this.contract.isOplogParticipant(log)) {
        // try again
        setTimeout(() => {
          this.watchOpLog(log)
        }, OPLOG_WATCH_RETRY_TIMEOUT).unref()
      }
    })
  }

  unwatchOpLog (log: ItoOpLog) {
    const keystr = keyToStr(log.pubkey)
    const stream = this._oplogReadStreams.get(keystr)
    if (stream) {
      stream.destroy()
      this._oplogReadStreams.delete(keystr)
    }
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

  private async _executeOp (log: ItoOpLog, seq: number, opValue: any) {
    const release = await this.contract.lock('_executeOp')
    try {
      assert(!!this.contract.vm, 'Contract VM not initialized')
      if (!this.contract.isOplogParticipant(log)) {
        console.error('Skipping op from non-participant')
        console.error('  Log:', log)
        console.error('  Op:', opValue)
        return
      }

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
        batch = (Object.entries(applyRes.actions as ActionValue[])
          .map(([key, action]): ItoIndexBatchEntry|undefined => {
            if (key.startsWith('/.sys/')) {
              if (action.type === 'addOplog') {
                return this.contract._createAddOplogBatchAction(action.value.pubkey)
              } else if (action.type === 'removeOplog') {
                return this.contract._createRemoveOplogBatchAction(action.value.pubkey)
              } else if (action.type === 'setContractSource') {
                return {type: 'put', key: CONTRACT_SOURCE_KEY, value: action.value.code}
              }
            }
            return {key, type: action.type, value: action.value}
          })
          .filter(Boolean) as ItoIndexBatchEntry[])
          .sort((a, b) => a.key.localeCompare(b.key))
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
          await this.contract._onContractCodeChange(batchEntry.value)
        } else if (batchEntry.key.startsWith(PARTICIPANT_KEY_PREFIX)) {
          await this.contract._onOplogChange(Number(batchEntry.key.slice(PARTICIPANT_KEY_PREFIX.length)), batchEntry.value)
        }
      }

      this.emit('op-executed', log, seq, opValue)
    } finally {
      release()
    }
  }
}
