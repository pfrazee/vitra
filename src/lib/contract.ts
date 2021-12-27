import * as assert from 'assert'
import { EventEmitter } from 'events'
import { Sandbox as ConfineSandbox } from 'confine-sandbox'
// @ts-ignore no types available -prf
import { AggregateError } from 'core-js-pure/actual/aggregate-error.js'
import { ItoContractCreateOpts, ItoContractCode, ItoAck, ItoIndexBatchEntry, CONTRACT_SOURCE_KEY, keyToStr } from '../types.js'
import { ItoStorage } from './storage.js'
import { ItoOperation } from './op.js'
import { ItoTransaction } from './tx.js'
import { ItoIndexLog, ItoOpLog } from './log.js'

export class ItoContract extends EventEmitter {
  storage: ItoStorage
  index: ItoIndexLog
  oplogs: ItoOpLog[] = [] 
  code: ItoContractCode|undefined
  vm: ConfineSandbox|undefined
  private _cid: number|undefined
  private _oplogReadStreams: Map<string, Readable> = new Map()

  constructor (storage: ItoStorage, index: ItoIndexLog) {
    super()
    this.storage = storage
    this.index = index
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

  // management
  // =

  static async create (storage: ItoStorage, opts: ItoContractCreateOpts): Promise<ItoContract> {
    assert.ok(storage instanceof ItoStorage, 'storage is required')
    assert.equal(typeof opts?.code?.source, 'string', 'opts.code.source is required')

    const index = await ItoIndexLog.create(storage)
    const contract = new ItoContract(storage, index)
    contract.oplogs.push(await ItoOpLog.create(storage)) // executor oplog
    contract.code = opts.code

    await contract._writeInitBlocks()
    await contract._createVM()
    contract._startExecutor()

    return contract
  }

  async init () {
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
      this._startExecutor()
    }
  }

  async destroy () {
    throw new Error('TODO')
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
        ops = await this.myOplog.__dangerousAppend(res.ops)
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
    const src = await this.index?.get(CONTRACT_SOURCE_KEY)
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

  private _startExecutor () {
    if (!this.isExecutor) {
      throw new Error('Not the executor')
    }
    for (const log of this.oplogs) {
      const start = 0 // TODO get last processed
      this._watchOpLog(log, start)
    }
  }

  private async _writeInitBlocks () {
    if (this.index.length > 0) {
      throw new Error('Cannot write init blocks: index log already has entries')
    }
    throw new Error('TODO')
  }

  private _watchOpLog (log: ItoOpLog, start: number) {
    const keystr = keyToStr(log.pubkey)
    if (this._oplogReadStreams.has(keystr)) return

    const s = log.createLogReadStream({start, live: true})
    this._oplogReadStreams.set(keystr, s)

    s.on('data', (entry: {seq: number, value: any}) => this._executeOp(log, entry.seq, entry.value))
    s.on('error', (err: any) => {
      // TODO how do we handle this? probably need to attempt restart or kill the executor?
      this.emit('error', new AggregateError([err], `An error occurred while reading oplog ${keystr}`))
    })
    s.on('close', () => this._oplogReadStreams.delete(keystr))
  }

  private async _executeOp (log: ItoOpLog, seq: number, opValue: any) {
    throw new Error('TODO')

    if (!this.vm || !this._cid) throw new Error('Contract VM not initialized')

    // enter restricted mode
    await this.vm.configContainer({cid: this._cid, opts: {restricted: true}})

    // call process() if it exists
    let metadata = undefined
    try {
      const processRes = await this.vm.handleAPICall(this._cid, 'process', [opValue])
      metadata = processRes.result
    } catch (e) {
      console.debug('Failed to call process()', e)
    }

    // create ack object
    const ack: ItoAck = {
      success: undefined,
      error: undefined,
      oplog: keyToStr(log.pubkey),
      seq,
      ts: Date.now(),
      metadata
    }

    // call apply()
    let applySuccess = undefined
    let batch: ItoIndexBatchEntry[] = []
    let applyError
    try {
      const applyRes = await this.vm.handleAPICall(this._cid, 'apply', [opValue, ack])
      batch = applyActionsToBatch(applyRes)
      applySuccess = true
    } catch (e: any) {
      applyError = e
      applySuccess = false
    }

    // enter unrestricted mode
    await this.vm.configContainer({cid: this._cid, opts: {restricted: false}})

    if (applySuccess) {
      ack.success = true
    } else {
      ack.success = false
      ack.error = applyError
      batch.length = 0
    }

    batch.unshift({
      action: 'put',
      key: createAckKey(), // TODO
      value: ack
    })

    await this.index.__dangerousBatch(batch)

    // update last handled op for pubkey
    // TODO
  }
}

type ActionValue = {action: string, value?: any}
function applyActionsToBatch (actions: Record<string, ActionValue>): ItoIndexBatchEntry[] {
  return Object.entries(actions)
    .map(([key, action]) => ({key, action: action.action, value: action.value}))
    .sort((a, b) => a.key.localeCompare(b.key))
}