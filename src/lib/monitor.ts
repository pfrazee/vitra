import assert from 'assert'
import { Resource } from './util/resource.js'
import { AwaitLock } from './util/lock.js'
import { Contract } from './contract.js'
import { OpLog } from './log.js'
import { VM } from './vm.js'
import { IndexHistoryEntry, OpLogEntry, IndexBatchEntry, Key, keyToStr, keyToBuf } from '../types.js'
import {
  CONTRACT_SOURCE_PATH,
  PARTICIPANT_PATH_PREFIX,
  ACK_PATH_PREFIX,
  GENESIS_ACK_PATH,
  InputSchema,
  AckSchema
} from '../schemas.js'
import _isEqual from 'lodash.isequal'

enum MonitorState {
  VALIDATING_GENESIS_SOURCE,
  VALIDATING_GENESIS_INPUTS,
  AWAITING_TX,
  VALIDATING_TX
}
type Constructor = new (...args: any[]) => Object;

interface QueuedEffect {
  effect: 'set-vm'|'add-input'|'remove-input'
  value: any
}

export class ContractMonitor extends Resource {
  expectedSeq = 1
  expectedChanges: IndexBatchEntry[] = []
  state: MonitorState = MonitorState.VALIDATING_GENESIS_SOURCE
  inputs: Set<string> = new Set()
  vm: VM|undefined
  verifying = false

  private _oplogs: Map<string, OpLog> = new Map()
  private _oplogProcessedSeqs: Map<string, number> = new Map()
  private _loadOplogLock = new AwaitLock()
  private _historyGenerator: AsyncGenerator<IndexHistoryEntry>|undefined
  private _queuedEffects: QueuedEffect[] = []

  constructor (public contract: Contract) {
    super()
  }

  get verifiedLength () {
    return this.expectedSeq - 1
  }

  async _close () {
    for (const oplog of this._oplogs.values()) {
      await oplog.close()
    }
    this.vm?.close()
    this._historyGenerator?.return(undefined)
    this.verifying = false
  }

  async verify () {
    assert(!this.verifying, 'Monitor already running verification')
    this.reset()
    this.verifying = true
    for await (const entry of this.contract.index.history()) {
      await this.validate(entry)
    }
    this.verifying = false
  }

  watch () {
    assert(!this.verifying, 'Monitor already running verification')
    this.reset()
    this.verifying = true
    ;(async () => {
      this._historyGenerator = this.contract.index.history({live: true})
      for await (const entry of this._historyGenerator) {
        try {
          await this.validate(entry)
        } catch (e) {
          this.emit('violation', e)
        }
      }
    })()
  }
  
  private reset () {
    this.expectedSeq = 1
    this.expectedChanges.length = 0
    this.state = MonitorState.VALIDATING_GENESIS_SOURCE
    this.inputs = new Set()
    this._queuedEffects.length = 0
    this._oplogProcessedSeqs = new Map()
  }

  private async transition (state: MonitorState) {
    this.state = state
    if (state === MonitorState.AWAITING_TX) {
      await this.applyQueuedEffects()
    }
  }

  private async validate (entry: IndexHistoryEntry) {
    this.assert(entry.seq === this.expectedSeq, UnexpectedSeqError, entry, this.expectedSeq)
    switch (this.state) {
      case MonitorState.VALIDATING_GENESIS_SOURCE: {
        this.assert(entry.path === CONTRACT_SOURCE_PATH, UnexpectedPathError, entry, CONTRACT_SOURCE_PATH)
        this.validateContractSourceChange(entry)
        await this.transition(MonitorState.VALIDATING_GENESIS_INPUTS)
        break
      }
      case MonitorState.VALIDATING_GENESIS_INPUTS: {
        if (entry.path.startsWith(PARTICIPANT_PATH_PREFIX)) {
          this.validateInputChange(entry)
        } else if (entry.path === GENESIS_ACK_PATH) {
          await this.transition(MonitorState.AWAITING_TX)
          this.assert(this.inputs.size > 0, NoGenesisInputsDeclaredError)
        } else {
          throw new UnexpectedPathError(entry, `${GENESIS_ACK_PATH} or a child of ${PARTICIPANT_PATH_PREFIX}`)
        }
        break
      }
      case MonitorState.AWAITING_TX: {
        this.assert(entry.path.startsWith(ACK_PATH_PREFIX), ChangeNotProducedByMonitorError, entry)
        this.validateAck(entry)

        const ackValue = entry.value as AckSchema
        const op = await this.fetchOp(ackValue.origin, ackValue.seq)
        this.assert(!!op, CannotFetchOpError, entry)

        const replayRes = await this.replayOp(ackValue, (op as OpLogEntry).value)
        if ('error' in replayRes) {
          this.assert(ackValue.success === false, MonitorApplyFailedError, entry, replayRes.errorMessage)
        } else {
          this.expectedChanges = (replayRes as IndexBatchEntry[])
        }

        await this.transition(MonitorState.VALIDATING_TX)
        break
      }
      case MonitorState.VALIDATING_TX: {
        const expectedChange = this.expectedChanges.shift()
        this.assert(!entry.path.startsWith(ACK_PATH_PREFIX), ChangeNotProducedByExecutorError, entry, expectedChange)
        this.validateChange(entry, expectedChange as IndexBatchEntry)
        if (this.expectedChanges.length === 0){
          await this.transition(MonitorState.AWAITING_TX)
        }
        break
      }
    }
    this.expectedSeq++
    this.emit('validated', entry)
  }

  private validateAck (entry: IndexHistoryEntry) {
    this.assert(entry.value && typeof entry.value === 'object', UnexpectedValueError, entry, 'value to be an object')
    const ackValue = entry.value as AckSchema
    this.assert(typeof ackValue.success === 'boolean', UnexpectedValueError, entry, '.success to be a boolean')
    this.assert(typeof ackValue.origin === 'string' && ackValue.origin.length === 64, UnexpectedValueError, entry, '.origin to be a 64-character utf-8 string')
    this.assert(typeof ackValue.seq === 'number', UnexpectedValueError, entry, '.seq to be a number')
    this.assert(typeof ackValue.ts === 'number', UnexpectedValueError, entry, '.ts to be a number')
    this.assert(this.inputs.has(ackValue.origin), NonParticipantError, entry, ackValue.origin)
    this.assert(this.getNextOplogSeqToProcess(ackValue.origin) === ackValue.seq, ProcessedOutOfOrderError, entry, ackValue.origin, this.getNextOplogSeqToProcess(ackValue.origin), ackValue.seq)
    this.setOplogSeqProcessed(ackValue.origin, ackValue.seq)
    if (ackValue.success) {
      this.assert(typeof ackValue.numChanges === 'number', UnexpectedValueError, entry, '.numChanges to be a number')
    } else {
      this.assert(typeof ackValue.error === 'string' || typeof ackValue.error === 'undefined', UnexpectedValueError, entry, '.error to be a string or undefined')
    }
  }

  getNextOplogSeqToProcess (pubkey: string) {
    let lastProcessed = this._oplogProcessedSeqs.get(pubkey)
    if (typeof lastProcessed === 'undefined') lastProcessed = -1
    return lastProcessed + 1
  }

  setOplogSeqProcessed (pubkey: string, seq: number) {
    this._oplogProcessedSeqs.set(pubkey, seq)
  }

  private validateChange (entry: IndexHistoryEntry, change: IndexBatchEntry) {
    this.assert(entry.type === change.type, ChangeMismatchError, entry, change, 'Change type is different.')
    this.assert(entry.path === change.path, ChangeMismatchError, entry, change, 'Change path is different.')
    this.assert(_isEqual(entry.value, change.value), ChangeMismatchError, entry, change, 'Change value is different.')
    if (entry.path === CONTRACT_SOURCE_PATH) this.validateContractSourceChange(entry)
    if (entry.path.startsWith(PARTICIPANT_PATH_PREFIX)) this.validateInputChange(entry)
  }

  private validateContractSourceChange (entry: IndexHistoryEntry) {
    this.assert(typeof entry.value === 'string' && entry.value.length, UnexpectedValueError, entry, 'a utf-8 string')
    this._queuedEffects.push({effect: 'set-vm', value: entry.value})
  }

  private validateInputChange (entry: IndexHistoryEntry) {
    this.assert(entry.value && typeof entry.value === 'object', UnexpectedValueError, entry, 'value to be an object')
    const inputValue = entry.value as InputSchema
    this.assert(Buffer.isBuffer(inputValue.pubkey), UnexpectedValueError, entry, '.pubkey to be a buffer')
    this.assert(inputValue.pubkey?.byteLength === 32, UnexpectedValueError, entry, '.pubkey to be a buffer of 32 bytes')
    this.assert(typeof inputValue.executor === 'boolean', UnexpectedValueError, entry, '.executor to be a boolean')
    this.assert(typeof inputValue.active === 'boolean', UnexpectedValueError, entry, '.active to be a boolean')
    if (inputValue.active) {
      this._queuedEffects.push({effect: 'add-input', value: keyToStr(inputValue.pubkey)})
    } else {
      this._queuedEffects.push({effect: 'remove-input', value: keyToStr(inputValue.pubkey)})
    }
  }

  private async applyQueuedEffects () {
    for (const effect of this._queuedEffects) {
      switch (effect.effect) {
        case 'set-vm': {
          if (this.vm) {
            await this.vm.close()
          }
          this.vm = new VM(this.contract, effect.value)
          await this.vm.open()
          await this.vm.restrict()
          break
        }
        case 'add-input':
          this.inputs.add(effect.value)
          break
        case 'remove-input':
          this.inputs.delete(effect.value)
          break
      }
    }
    this._queuedEffects.length = 0
  }

  private async replayOp (ack: AckSchema, opValue: any): Promise<IndexBatchEntry[]|{error: boolean, errorMessage: string}> {
    const release = await this.contract.lock('replayOp')
    try {
      assert(!!this.vm, 'Contract VM not initialized')
      let applySuccess = undefined
      let applyError = undefined
      let batch: IndexBatchEntry[] = []
      try {
        const applyRes = await this.vm.contractApply(opValue, ack)
        batch = this.contract._mapApplyActionsToBatch(applyRes.actions)
        applySuccess = true
      } catch (e: any) {
        applySuccess = false
        applyError = e
      }
      if (!applySuccess) {
        return {error: true, errorMessage: applyError.toString()}
      }
      return batch
    } finally {
      release()
    }
  }

  private async fetchOplog (pubkey: Key): Promise<OpLog> {
    await this._loadOplogLock.acquireAsync()
    try {
      const pubkeyBuf = keyToBuf(pubkey)
      const pubkeyStr = keyToStr(pubkey)
      let log = this.contract.oplogs.find(log => log.pubkey.equals(pubkeyBuf))
      if (log) return log
      
      log = this._oplogs.get(pubkeyStr)
      if (log) return log
      
      log = new OpLog(await this.contract.storage.getHypercore(pubkeyBuf), false)
      this._oplogs.set(pubkeyStr, log)
      return log
    } finally {
      this._loadOplogLock.release()
    }
  }

  private async fetchOp (pubkey: Key, seq: number): Promise<OpLogEntry|undefined> {
    const log = await this.fetchOplog(pubkey)
    return await log.get(seq)
  }

  private assert (cond: any, cons: Constructor, ...args: any[]) {
    if (!cond) {
      throw new cons(...args)
    }
  }
}

export class BaseError extends Error {
  name: string;
  data: any;

  constructor (message: string, data?: any) {
    super(message)
    this.name = this.constructor.name
    this.data = data
  }
}

export class UnexpectedSeqError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedSeq: number) {
    super(`Unexpected message seq. Expected ${expectedSeq}, received ${entry.seq}`, {entry, expectedSeq})
  }
}

export class UnexpectedPathError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedPath: string) {
    super(`Unexpected message path. Expected ${expectedPath}, received ${entry.path}`, {entry, expectedPath})
  }
}

export class UnexpectedValueError extends BaseError {
  constructor (entry: IndexHistoryEntry, description: string) {
    super(`Unexpected message value. Expected ${description}`, {entry})
  }
}

export class MonitorApplyFailedError extends BaseError {
  constructor (entry: IndexHistoryEntry, errorMessage: string) {
    super(`The monitor expected the operation to fail but the executor successfully processed it. ${errorMessage}`, {entry, errorMessage})
  }
}

export class ChangeNotProducedByMonitorError extends BaseError {
  constructor (entry: IndexHistoryEntry) {
    super(`The executor produced a change which the monitor did not expect.`, {entry})
  }
}

export class ChangeNotProducedByExecutorError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedChange: IndexBatchEntry) {
    super(`The executor did not produce a change which the monitor expected.`, {entry, expectedChange})
  }
}

export class ChangeMismatchError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedChange: IndexBatchEntry, description: string) {
    super(`The executor produced a change which is different than the change expected by the monitor. ${description}`, {entry, expectedChange})
  }
}

export class ProcessedOutOfOrderError extends BaseError {
  constructor (entry: IndexHistoryEntry, oplogPubkey: string, expectedSeq: number, executedSeq: number) {
    super(`The executor processed an operation out of order. Expected to process ${expectedSeq} but actually processed ${executedSeq} for oplog ${oplogPubkey}`, {entry, oplogPubkey, expectedSeq, executedSeq})
  }
}

export class NonParticipantError extends BaseError {
  constructor (entry: IndexHistoryEntry, oplogPubkey: string) {
    super(`The executor processed an operation from an oplog which is not a declared participant, oplog = ${oplogPubkey}`, {entry, oplogPubkey})
  }
}

export class NoGenesisInputsDeclaredError extends BaseError {
  constructor () {
    super(`No input oplogs declared in genesis sequence`)
  }
}

export class CannotFetchOpError extends BaseError {
  constructor (entry: IndexHistoryEntry) {
    super(`Failed to fetch op from ${entry.value.origin} at seq ${entry.value.seq}`, {entry})
  }
}
