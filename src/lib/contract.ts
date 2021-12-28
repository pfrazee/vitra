import * as assert from 'assert'
import { EventEmitter } from 'events'
import { Sandbox as ConfineSandbox } from 'confine-sandbox'
import {
  ItoContractCreateOpts,
  ItoContractCode,
  ItoIndexBatchEntry,
  CONTRACT_SOURCE_KEY,
  PARTICIPANT_KEY_PREFIX,
  ACK_KEY_PREFIX,
  keyToStr
} from '../types.js'
import { ItoStorage } from './storage.js'
import { ItoOperation } from './op.js'
import { ItoTransaction } from './tx.js'
import { ItoIndexLog, ItoOpLog } from './log.js'
import { ItoContractExecutor } from './executor.js'
import lock from './lock.js'

export class ItoContract extends EventEmitter {
  opening = false
  open = false
  closing = false
  closed = false

  storage: ItoStorage
  index: ItoIndexLog
  oplogs: ItoOpLog[] = [] 
  code: ItoContractCode|undefined
  vm: ConfineSandbox|undefined
  private _executor: ItoContractExecutor|undefined
  private _cid: number|undefined
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

  static async create (storage: ItoStorage, opts: ItoContractCreateOpts): Promise<ItoContract> {
    assert.ok(storage instanceof ItoStorage, 'storage is required')
    assert.equal(typeof opts?.code?.source, 'string', 'opts.code.source is required')

    const index = await ItoIndexLog.create(storage)
    const contract = new ItoContract(storage, index)
    contract.opening = true
    contract.oplogs.push(await ItoOpLog.create(storage)) // executor oplog
    contract.code = opts.code

    await contract._writeInitBlocks()
    await contract._createVM()
    contract._executor = new ItoContractExecutor(contract)
    contract._executor.start()

    contract.opening = false
    contract.open = true
    return contract
  }

  async init () {
    this.opening = true
    throw new Error('TODO')

    // load index
    // TODO

    // sync index
    // TODO

    // load oplogs
    // TODO
    
    // load VM
    await this._createVM()

    if (this.isExecutor) {
      this._executor = new ItoContractExecutor(this)
      this._executor.start()
    }

    this.opening = false
    this.open = true
  }

  async destroy () {
    this.closing = true
    throw new Error('TODO')

    this._executor?.stop()

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
    if (this.vm && this._cid) {
      const res = await this.vm.handleAPICall(this._cid, methodName, params)
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

  private _createVMGlobals (): any {
    throw new Error('TODO')
    return {
      console: {
        log: (...args: any[]) => this.emit('contract:log', 'log', args),
        debug: (...args: any[]) => this.emit('contract:log', 'debug', args),
        info: (...args: any[]) => this.emit('contract:log', 'info', args),
        warn: (...args: any[]) => this.emit('contract:log', 'warn', args),
        error: (...args: any[]) => this.emit('contract:log', 'error', args)
      },
      __internal__: {
        contractIndex: {
          list: Function
          get: Function
          listOplogs: Function
        },
        contractOplog: {
          getLength: Function
          get: Function
          append: Function
        }
      }
    }
  }

  private async _createVM () {
    const source = await this._readContractCode()
    this.vm = new ConfineSandbox({
      runtime: 'ito-confine-runtime',
      globals: this._createVMGlobals()
    })
    const {cid} = await this.vm.execContainer({
      source,
      env: {
        indexPubkey: keyToStr(this.pubkey),
        oplogPubkey: this.myOplog ? keyToStr(this.myOplog.pubkey) : undefined
      }
    })
    this._cid = cid
  }

  // execution
  // =

  private async _writeInitBlocks () {
    assert.ok(this.index.length > 0, 'Cannot write init blocks: index log already has entries')
    assert.ok(typeof this.code?.source === 'string', 'Contract source must be provided')
    assert.ok(this.oplogs.length > 0, 'Oplogs must be created before writing init blocks')
    const batch: ItoIndexBatchEntry[] = [
      {action: 'put', key: CONTRACT_SOURCE_KEY, value: this.code?.source}
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
