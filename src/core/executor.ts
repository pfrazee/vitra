import { EventIterator } from 'event-iterator'
import { Resource } from '../util/resource.js'
// @ts-ignore no types available -prf
import assert from 'assert'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import * as msgpackr from 'msgpackr'
import { IndexBatchEntry, keyToStr } from '../types.js'
import { AckSchema, ACK_PATH_PREFIX, genAckPath } from '../schemas.js'
import { Database } from './database.js'
import { OpLog, ReadStream } from './log.js'
import { ContractRuntimeError } from './errors.js'

const OPLOG_WATCH_RETRY_TIMEOUT = 5e3

interface WatchEvent {
  event: 'added'|'removed'|'op-executed'
  oplog: OpLog
  seq?: number
  op?: any
}

export class ContractExecutor extends Resource {
  protected _oplogsWatcher: AsyncGenerator<[string, OpLog]>|undefined
  protected _lastExecutedSeqs: Map<string, number> = new Map()
  protected _oplogReadStreams: Map<string, ReadStream> = new Map()
  constructor (public db: Database) {
    super()
  }

  // public api
  // =

  [Symbol.for('nodejs.util.inspect.custom')] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  key: ' + opts.stylize(keyToStr(this.db.pubkey), 'string') + '\n' +
      indent + '  opened: ' + opts.stylize(this.opened, 'boolean') + '\n' +
      indent + ')'
  }

  async _open () {
    if (!this.db.isExecutor) {
      throw new Error('Not the executor')
    }
    for (const log of this.db.oplogs) {
      this.watchOpLog(log)
    }
    ;(async () => {
      this._oplogsWatcher = this.db.oplogs.watch(false)
      for await (const [evt, log] of this._oplogsWatcher) {
        if (evt === 'added') this.watchOpLog(log)
        if (evt === 'removed') this.unwatchOpLog(log)
      }
    })()
  }

  async _close () {
    this._oplogsWatcher?.return(true)
    for (const readStream of this._oplogReadStreams.values()) {
      readStream.destroy()
    }
  }

  watch (): AsyncIterable<WatchEvent> {
    return new EventIterator<WatchEvent>(({push}) => {
      const onAdd = (oplog: OpLog) => push({event: 'added', oplog})
      const onRemove = (oplog: OpLog) => push({event: 'removed', oplog})
      const onOpExecuted = (oplog: OpLog, seq: number, op: any) => push({event: 'op-executed', oplog, seq, op})
      this.db.oplogs.on('added', onAdd)
      this.db.oplogs.on('removed', onRemove)
      this.on('op-executed', onOpExecuted)
      return () => {
        this.db.oplogs.removeListener('added', onAdd)
        this.db.oplogs.removeListener('removed', onRemove)
        this.removeListener('op-executed', onOpExecuted)
      }
    })
  }

  async sync () {
    await Promise.all(this.db.oplogs.map(oplog => oplog.core.update()))
    const state = this._captureLogSeqs()
    if (this._hasExecutedAllSeqs(state)) return
    for await (const evt of this.watch()) {
      const keystr = keyToStr(evt.oplog.pubkey)
      if (evt.event === 'removed') {
        state.delete(keystr)
      }
      if (this._hasExecutedAllSeqs(state)) return
    }
  }

  async watchOpLog (log: OpLog) {
    if (this.closing || this.closed) return
    const keystr = keyToStr(log.pubkey)
    const release = await this.db.lock(`watchOpLog:${keystr}`)
    try {
      if (this._oplogReadStreams.has(keystr)) return
      if (!this.db.isOplogParticipant(log)) return

      await this._readLastExecutedSeq(log)
      const start = this._getLastExecutedSeq(log)
      const s = log.createLogReadStream({start, live: true})
      this._oplogReadStreams.set(keystr, s)

      s.on('data', (entry: {seq: number, value: any}) => this._executeOp(log, entry.seq, msgpackr.unpack(entry.value)))
      s.on('error', (err: any) => {
        this.db.emit('error', new AggregateError([err], `An error occurred while reading oplog ${keystr}`))
      })
      s.on('close', () => {
        this._oplogReadStreams.delete(keystr)
        if (!this.db.closing && !this.db.closed && this.db.isOplogParticipant(log)) {
          // try again
          setTimeout(() => {
            this.watchOpLog(log)
          }, OPLOG_WATCH_RETRY_TIMEOUT).unref()
        }
      })
    } catch (e) {
      if (this.closing || this.closed) return // ignore
      throw e
    } finally {
      release()
    }
  }

  unwatchOpLog (log: OpLog) {
    const keystr = keyToStr(log.pubkey)
    this._lastExecutedSeqs.delete(keystr)
    const stream = this._oplogReadStreams.get(keystr)
    if (stream) {
      stream.destroy()
      this._oplogReadStreams.delete(keystr)
    }
  }

  // protected methods
  // =

  protected async _readLastExecutedSeq (oplog: OpLog) {
    let seq = -1
    const keystr = keyToStr(oplog.pubkey)
    const entries = await this.db.index.list(`${ACK_PATH_PREFIX}${keystr}`)
    for (const entry of entries) {
      seq = Math.max(Number(entry.name), seq)
    }
    if (seq !== -1) this._putLastExecutedSeq(oplog, seq)
  }

  protected _getLastExecutedSeq (oplog: OpLog, fallback = 0): number {
    const seq = this._lastExecutedSeqs.get(keyToStr(oplog.pubkey))
    return typeof seq === 'number' ? seq : fallback
  }

  protected _putLastExecutedSeq (oplog: OpLog, seq: number) {
    this._lastExecutedSeqs.set(keyToStr(oplog.pubkey), seq)
  }

  protected _captureLogSeqs (): Map<string, number> {
    const seqs = new Map()
    for (const log of this.db.oplogs) seqs.set(keyToStr(log.pubkey), log.length - 1)
    return seqs
  }

  protected _hasExecutedAllSeqs (seqs: Map<string, number>): boolean {
    for (const [pubkey, seq] of seqs.entries()) {
      const executedSeq = this._lastExecutedSeqs.has(pubkey) ? (this._lastExecutedSeqs.get(pubkey) || 0) : -1
      if (executedSeq < seq) return false
    }
    return true
  }

  protected async _executeOp (log: OpLog, seq: number, opValue: any) {
    const assertStillOpen = () => {
      if (this.db.closing || this.db.closed) throw new DatabaseClosedError()
    }

    const last = this._getLastExecutedSeq(log, -1)
    if (last >= seq) return

    const release = await this.db.lock('_executeOp')
    try {
      assertStillOpen()
      if (!this.db.isOplogParticipant(log)) {
        console.error('Skipping op from non-participant')
        console.error('  Log:', log)
        console.error('  Op:', opValue)
        return
      }
      
      // create ack object
      const ack: AckSchema = {
        success: undefined,
        error: undefined,
        origin: keyToStr(log.pubkey),
        seq,
        ts: Date.now(),
        metadata: undefined,
        numChanges: 0
      }
      let applySuccess = undefined
      let batch: IndexBatchEntry[] = []
      let applyError: any

      await this.db._startVM()
      await this.db.vmManager.use<void>(async () => {
        assert(!!this.db.vm, 'Contract VM not initialized')

        // enter restricted mode
        await this.db.vm.restrict()
        assertStillOpen()

        // call process() if it exists
        let metadata = undefined
        try {
          const processRes = await this.db.vm.contractProcess(opValue)
          metadata = processRes.result
        } catch (e: any) {
          if (!e.toString().includes('Method not found: process') && e instanceof ContractRuntimeError) {
            this.db.emit('error', e)
          }
        }
        ack.metadata = metadata
        assertStillOpen()

        // call apply()
        try {
          const applyRes = await this.db.vm.contractApply(opValue, ack)
          batch = this.db._mapApplyActionsToBatch(applyRes.actions)
          applySuccess = true
        } catch (e: any) {
          if (e instanceof ContractRuntimeError) {
            this.db.emit('error', e)
          }
          applyError = e
          applySuccess = false
        }
        assertStillOpen()

        // leave restricted mode
        await this.db.vm.unrestrict()
        assertStillOpen()
      })

      // write the result
      if (applySuccess) {
        ack.success = true
        ack.numChanges = batch.length
      } else {
        ack.success = false
        ack.error = applyError.toString()
        batch.length = 0
      }
      batch.unshift({
        type: 'put',
        path: genAckPath(log.pubkey, seq),
        value: ack
      })
      await this.db._executeApplyBatch(batch)
      this._putLastExecutedSeq(log, seq)

      this.emit('op-executed', log, seq, opValue)
    } catch (e: any) {
      if (e instanceof DatabaseClosedError) {
        // ignore, just need to abort handling
      } else {
        throw e
      }
    } finally {
      release()
    }
  }
}

class DatabaseClosedError extends Error {}