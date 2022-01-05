import EventEmitter from 'events'
// @ts-ignore no types available -prf
import assert from 'assert'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import * as msgpackr from 'msgpackr'
import {
  ItoAck,
  ItoIndexBatchEntry,
  keyToStr
} from '../types.js'
import {
  CONTRACT_SOURCE_PATH,
  PARTICIPANT_PATH_PREFIX,
  ACK_PATH_PREFIX,
  genAckPath
} from '../schemas.js'
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

  async open () {
    assert(!this.closing && !this.closed, 'Executor already closed')
    if (this.opened || this.opening) return
    this.opening = true
    if (!this.contract.isExecutor) {
      throw new Error('Not the executor')
    }
    for (const log of this.contract.oplogs) {
      await this.watchOpLog(log)
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
      const current = await this._getLastExecutedSeq(oplog, -1)
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

  async watchOpLog (log: ItoOpLog) {
    const keystr = keyToStr(log.pubkey)
    const release = await this.contract.lock(`watchOpLog:${keystr}`)
    try {
      if (this._oplogReadStreams.has(keystr)) return

      await this._readLastExecutedSeq(log)
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
    } finally {
      release()
    }
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

  private async _readLastExecutedSeq (oplog: ItoOpLog) {
    let seq = -1
    const entries = await this.contract.index.list(ACK_PATH_PREFIX)
    for (const entry of entries) {
      if (entry.name.startsWith(`${oplog.id}:`)) {
        seq = Math.max(Number(entry.name.split(':')[1]), seq)
      }
    }
    if (seq !== -1) this._putLastExecutedSeq(oplog, seq)
  }

  private _getLastExecutedSeq (oplog: ItoOpLog, fallback = 0): number {
    return this._lastExecutedSeqs.get(keyToStr(oplog.pubkey)) || fallback
  }

  private _putLastExecutedSeq (oplog: ItoOpLog, seq: number) {
    this._lastExecutedSeqs.set(keyToStr(oplog.pubkey), seq)
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
      } catch (e: any) {
        if (!e.toString().includes('Method not found: process')) {
          console.debug('Failed to call process()', e)
        }
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
          .map(([path, action]): ItoIndexBatchEntry|undefined => {
            if (path.startsWith('/.sys/')) {
              if (action.type === 'addOplog') {
                return this.contract._createAddOplogBatchAction(action.value.pubkey)
              } else if (action.type === 'removeOplog') {
                return this.contract._createRemoveOplogBatchAction(action.value.pubkey)
              } else if (action.type === 'setContractSource') {
                return {type: 'put', path: CONTRACT_SOURCE_PATH, value: action.value.code}
              }
            }
            return {path, type: action.type, value: action.value}
          })
          .filter(Boolean) as ItoIndexBatchEntry[])
          .sort((a, b) => a.path.localeCompare(b.path))
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
        path: genAckPath(log.id, seq),
        value: ack
      })
      await this.contract.index.dangerousBatch(batch)
      this._putLastExecutedSeq(log, seq)

      // react to config changes
      for (const batchEntry of batch) {
        if (batchEntry.path === CONTRACT_SOURCE_PATH) {
          await this.contract._onContractCodeChange(batchEntry.value)
        } else if (batchEntry.path.startsWith(PARTICIPANT_PATH_PREFIX)) {
          await this.contract._onOplogChange(Number(batchEntry.path.slice(PARTICIPANT_PATH_PREFIX.length)), batchEntry.value)
        }
      }

      this.emit('op-executed', log, seq, opValue)
    } finally {
      release()
    }
  }
}
