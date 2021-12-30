// @ts-ignore no types available -prf
import { AggregateError } from 'core-js-pure/actual/aggregate-error.js'
import * as assert from 'assert'
import { EventEmitter } from 'events'
import {
  ItoContractCreateOpts,
  ItoIndexBatchEntry,
  CONTRACT_SOURCE_KEY,
  PARTICIPANT_KEY_PREFIX,
  ACK_KEY_PREFIX,
  Key,
  keyToStr,
  keyToBuf
} from '../types.js'
import { ItoStorage } from './storage.js'
import { ItoOperation } from './op.js'
import { ItoTransaction } from './tx.js'
import { ItoIndexLog, ItoOpLog } from './log.js'
import { ItoContractExecutor } from './executor.js'
import { ItoVM } from './vm.js'
import lock from './lock.js'

export class ItoContract extends EventEmitter {
  opening = false
  open = false
  closing = false
  closed = false

  storage: ItoStorage
  index: ItoIndexLog
  oplogs: ItoOpLog[] = [] 
  vm: ItoVM|undefined
  private _executor: ItoContractExecutor|undefined
  private _lockPrefix = ''

  constructor (storage: ItoStorage, index: ItoIndexLog) {
    super()
    this.storage = storage
    this.index = index
    this._lockPrefix = keyToStr(this.pubkey)
  }

  get pubkey (): Buffer {
    return this.index.pubkey
  }

  get isExecutor (): boolean {
    return this.index.writable
  }

  get myOplog (): ItoOpLog|undefined {
    return this.oplogs.find(oplog => oplog.writable)
  }

  get isParticipant (): boolean {
    return !!this.myOplog
  }

  lock (name: string): Promise<() => void> {
    return lock(`${this._lockPrefix}:${name}`)
  }

  // management
  // =

  static async create (storage: ItoStorage|string, opts: ItoContractCreateOpts): Promise<ItoContract> {
    if (typeof storage === 'string') storage = new ItoStorage(storage)
    assert.ok(storage instanceof ItoStorage, 'storage is required')
    assert.equal(typeof opts?.code?.source, 'string', 'opts.code.source is required')

    const index = await ItoIndexLog.create(storage)
    const contract = new ItoContract(storage, index)
    contract.opening = true
    contract.oplogs.push(await ItoOpLog.create(storage)) // executor oplog

    await contract._writeInitBlocks(opts?.code?.source)
    await contract._createVM()
    contract._executor = new ItoContractExecutor(contract)
    contract._executor.start()

    contract.opening = false
    contract.open = true
    return contract
  }

  static async load (storage: ItoStorage|string, pubkey: Key): Promise<ItoContract> {
    const _storage: ItoStorage = (typeof storage === 'string') ? new ItoStorage(storage) : storage
    assert.ok(_storage instanceof ItoStorage, '_storage is required')
    pubkey = keyToBuf(pubkey) // keyToBuf() will validate the key

    const indexCore = await _storage.getHypercore(pubkey)
    const index = new ItoIndexLog(indexCore)

    const contract = new ItoContract(_storage, index) 
    contract.opening = true

    const oplogPubkeys = await contract.index.listOplogs()
    const oplogCores = await Promise.all(oplogPubkeys.map(pubkey => _storage.getHypercore(pubkey)))
    contract.oplogs = oplogCores.map(core => new ItoOpLog(core))
    
    await contract._createVM()
    if (contract.isExecutor) {
      contract._executor = new ItoContractExecutor(contract)
      contract._executor.start()
    }
    
    contract.opening = false
    contract.open = true
    return contract
  }

  async destroy () {
    this.closing = true

    this._executor?.stop()
    this.vm?.destroy()
    await Promise.all([
      this.index.close(),
      ...this.oplogs.map(log => log.close())
    ])

    this.closing = false
    this.open = false
    this.closed = true
  }

  // networking
  // =

  swarm () {
    throw new Error('TODO')
  }
  
  unswarm () {
    throw new Error('TODO')
  }

  // transactions
  // =

  async call (methodName: string, params: any[]): Promise<ItoTransaction> {
    if (methodName === 'process' || methodName === 'apply') {
      throw new Error(`Cannot call "${methodName}" directly`)
    }
    if (this.vm) {
      const res = await this.vm.handleAPICall(methodName, params)
      let ops: ItoOperation[] = []
      if (res.ops?.length) {
        if (!this.myOplog) {
          throw new Error('Unable to execute transaction: not a writer')
        }
        ops = await this.myOplog.dangerousAppend(res.ops)
      }
      return new ItoTransaction(this, res.result, ops)  
    } else {
      throw new Error('Contract VM not instantiated')
    }
  }

  // monitoring
  // =

  async verify () {
    throw new Error('TODO')
  }

  async monitor () {
    throw new Error('TODO')
    /* TODO do we need to do this? may just need to tail the executor oplog and index
    for (const log of this.oplogs) {
      this._watchOpLog(log, async (log: ItoOpLog, seq: number, value: any) => {
        try {
          const proof = {seq, hash: EMPTY_BUFFER, signature: EMPTY_BUFFER}
          await this.verifyOp(new ItoOperation(log, proof, value))
        } catch (err: any) {
          this.emit('error', new AggregateError([err], `Verification failed for op ${seq} of oplog ${keyToStr(log.pubkey)}`))
        }
      })
    }*/
  }

  async verifyOp (op: ItoOperation) {
    await op.verifyInclusion()
    throw new Error('TODO')
  }

  // vm
  // =

  private async _readContractCode (): Promise<string> {
    const src = await this.index.get(CONTRACT_SOURCE_KEY)
    if (!src) throw new Error('No contract sourcecode found')
    if (Buffer.isBuffer(src)) return src.toString('utf8')
    if (typeof src === 'string') return src
    throw new Error(`Invalid contract sourcecode entry; must be a string or a buffer containing utf-8.`)
  }

  private async _createVM () {
    const source = await this._readContractCode()
    this.vm = new ItoVM(this, source)
    await this.vm
  }

  // execution
  // =

  private async _writeInitBlocks (source?: string) {
    assert.ok(this.index.length > 0, 'Cannot write init blocks: index log already has entries')
    assert.ok(typeof source === 'string', 'Contract source must be provided')
    assert.ok(this.oplogs.length > 0, 'Oplogs must be created before writing init blocks')
    const batch: ItoIndexBatchEntry[] = [
      {action: 'put', key: CONTRACT_SOURCE_KEY, value: source}
    ]
    for (const oplog of this.oplogs) {
      const pubkey = keyToStr(oplog.pubkey)
      batch.push({
        action: 'put',
        key: `${PARTICIPANT_KEY_PREFIX}${pubkey}`,
        value: {pubkey}
      })
    }
    batch.push({action: 'put', key: `${ACK_KEY_PREFIX}0`, value: {}})
    await this.index.dangerousBatch(batch)
  }
}
