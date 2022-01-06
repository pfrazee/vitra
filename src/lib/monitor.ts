import assert from 'assert'
import { Resource } from './util/resource.js'
import { AwaitLock } from './util/lock.js'
import { Contract } from './contract.js'
import { OpLog } from './log.js'
import { IndexHistoryEntry, OpLogEntry, IndexBatchEntry, Key, keyToStr, keyToBuf } from '../types.js'
import {
  CONTRACT_SOURCE_PATH,
  PARTICIPANT_PATH_PREFIX,
  ACK_PATH_PREFIX,
  genAckPath,
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

export class ContractMonitor extends Resource {
  expectedSeq = 1
  expectedMutations: IndexBatchEntry[] = []
  state: MonitorState = MonitorState.VALIDATING_GENESIS_SOURCE
  inputs: Set<string> = new Set()

  private _oplogs: Map<string, OpLog> = new Map()
  private _loadOplogLock = new AwaitLock()
  private _historyGenerator: AsyncGenerator<IndexHistoryEntry>|undefined

  constructor (public contract: Contract) {
    super()
    // TODO: need to use a separate VM from the contract
  }

  async _close () {
    for (const oplog of this._oplogs.values()) {
      await oplog.close()
    }
    this._historyGenerator?.return(undefined)
  }

  async verify () {
    for await (const entry of this.contract.index.history()) {
      await this.validate(entry)
    }
  }

  watch () {
    ;(async () => {
      this._historyGenerator = this.contract.index.history({live: true})
      for await (const entry of this.contract.index.history()) {
        await this.validate(entry)
      }
    })()
  }

  private async validate (entry: IndexHistoryEntry) {
    this.assert(entry.seq === this.expectedSeq, UnexpectedSeqError, entry, this.expectedSeq)
    if (this.state === MonitorState.VALIDATING_GENESIS_SOURCE) {
      this.assert(entry.path === CONTRACT_SOURCE_PATH, UnexpectedPathError, entry, CONTRACT_SOURCE_PATH)
      this.validateContractSourceMutation(entry)
      this.state = MonitorState.VALIDATING_GENESIS_INPUTS
    } else if (this.state === MonitorState.VALIDATING_GENESIS_INPUTS) {
      if (entry.path === GENESIS_ACK_PATH) {
        this.assert(this.inputs.size > 0, NoGenesisInputsDeclaredError)
        this.state = MonitorState.AWAITING_TX
      } else if (entry.path.startsWith(PARTICIPANT_PATH_PREFIX)) {
        this.validateInputMutation(entry)
      } else {
        throw new UnexpectedPathError(entry, `${GENESIS_ACK_PATH} or a child of ${PARTICIPANT_PATH_PREFIX}`)
      }
    } else if (this.state === MonitorState.AWAITING_TX) {
      this.assert(entry.path.startsWith(ACK_PATH_PREFIX), AckExpectedError, entry)
      this.validateAck(entry)
      const ackValue = entry.value as AckSchema
      const op = await this.fetchOp(ackValue.origin, ackValue.seq)
      this.assert(!!op, CannotFetchOpError, entry)
      const replayRes = await this.replayOp(ackValue, (op as OpLogEntry).value)
      if ('error' in replayRes) {
        this.assert(ackValue.success === false, MonitorApplyFailedError, entry, replayRes.errorMessage)
      } else {
        this.expectedMutations = (replayRes as IndexBatchEntry[])
      }
      this.state = MonitorState.VALIDATING_TX
    } else if (this.state === MonitorState.VALIDATING_TX) {
      const expectedMutation = this.expectedMutations.shift()
      this.assert(!entry.path.startsWith(ACK_PATH_PREFIX), MutationExpectedError, entry, expectedMutation)
      this.validateMutation(entry, expectedMutation as IndexBatchEntry)
      if (this.expectedMutations.length === 0){
        this.state = MonitorState.AWAITING_TX
      }
    }
    this.emit('validated', entry)
    this.expectedSeq++
  }

  private validateAck (entry: IndexHistoryEntry) {
    this.assert(entry.value && typeof entry.value === 'object', UnexpectedValueError, entry, 'value to be an object')
    const ackValue = entry.value as AckSchema
    this.assert(typeof ackValue.success === 'boolean', UnexpectedValueError, entry, '.success to be a boolean')
    this.assert(typeof ackValue.origin === 'string' && ackValue.origin.length === 64, UnexpectedValueError, entry, '.origin to be a 64-character utf-8 string')
    this.assert(typeof ackValue.seq === 'number', UnexpectedValueError, entry, '.seq to be a number')
    this.assert(typeof ackValue.ts === 'number', UnexpectedValueError, entry, '.ts to be a number')
    if (ackValue.success) {
      this.assert(typeof ackValue.numMutations === 'number', UnexpectedValueError, entry, '.numMutations to be a number')
    } else {
      this.assert(typeof ackValue.error === 'string' || typeof ackValue.error === 'undefined', UnexpectedValueError, entry, '.error to be a string or undefined')
    }
  }

  private validateMutation (entry: IndexHistoryEntry, mutation: IndexBatchEntry) {
    this.assert(entry.type === mutation.type, MutationMismatchError, entry, mutation, 'Mutation type is different.')
    this.assert(entry.path === mutation.path, MutationMismatchError, entry, mutation, 'Mutation path is different.')
    this.assert(_isEqual(entry.value, mutation.value), MutationMismatchError, entry, mutation, 'Mutation value is different.')
    if (entry.path === CONTRACT_SOURCE_PATH) this.validateContractSourceMutation(entry)
    if (entry.path.startsWith(PARTICIPANT_PATH_PREFIX)) this.validateInputMutation(entry)
  }

  private validateContractSourceMutation (entry: IndexHistoryEntry) {
    this.assert(typeof entry.value === 'string' && entry.value.length, UnexpectedValueError, entry, 'a utf-8 string')
    // TODO: load VM
  }

  private validateInputMutation (entry: IndexHistoryEntry) {
    this.assert(entry.value && typeof entry.value === 'object', UnexpectedValueError, entry, 'value to be an object')
    const inputValue = entry.value as InputSchema
    this.assert(Buffer.isBuffer(inputValue.pubkey), UnexpectedValueError, entry, '.pubkey to be a buffer')
    this.assert(inputValue.pubkey?.byteLength === 32, UnexpectedValueError, entry, '.pubkey to be a buffer of 32 bytes')
    this.assert(typeof inputValue.executor === 'boolean', UnexpectedValueError, entry, '.executor to be a boolean')
    this.assert(typeof inputValue.active === 'boolean', UnexpectedValueError, entry, '.active to be a boolean')
    // TODO: side-effects should be queued to apply after tx is validated
    if (inputValue.active) {
      this.inputs.add(keyToStr(inputValue.pubkey))
    } else {
      this.inputs.delete(keyToStr(inputValue.pubkey))
    }
  }

  private async replayOp (ack: AckSchema, opValue: any): Promise<IndexBatchEntry[]|{error: boolean, errorMessage: string}> {
    const assertStillOpen = () => assert(!this.contract.closing && !this.contract.closed, 'Contract closed')
    const release = await this.contract.lock('replayOp')
    try {
      assert(!!this.contract.vm, 'Contract VM not initialized')
      assertStillOpen()

      // enter restricted mode
      await this.contract.vm.restrict()
      assertStillOpen()

      // call apply()
      let applySuccess = undefined
      let applyError = undefined
      let batch: IndexBatchEntry[] = []
      try {
        const applyRes = await this.contract.vm.contractApply(opValue, ack)
        batch = this.contract._mapApplyActionsToBatch(applyRes.actions)
        applySuccess = true
      } catch (e: any) {
        applySuccess = false
        applyError = e
      }
      assertStillOpen()

      // leave restricted mode
      await this.contract.vm.unrestrict()
      assertStillOpen()

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

export class AckExpectedError extends BaseError {
  constructor (entry: IndexHistoryEntry) {
    super(`The executor produced a mutation which was not produced by the monitor.`, {entry})
  }
}

export class MonitorApplyFailedError extends BaseError {
  constructor (entry: IndexHistoryEntry, errorMessage: string) {
    super(`The monitor errored while applying the operation while the executor did not. ${errorMessage}`, {entry, errorMessage})
  }
}

export class MutationExpectedError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedMutation: IndexBatchEntry) {
    super(`The monitor produced a mutation which was not produced by the executor.`, {entry, expectedMutation})
  }
}

export class MutationMismatchError extends BaseError {
  constructor (entry: IndexHistoryEntry, expectedMutation: IndexBatchEntry, description: string) {
    super(`The monitor produce a mutation differed from the mutation produced by the executor. ${description}`, {entry, expectedMutation})
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
