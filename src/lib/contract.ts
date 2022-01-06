import { Resource } from './util/resource.js'
import { ResourcesManager } from './util/resources-manager.js'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import * as assert from 'assert'
import {
  ContractCreateOpts,
  IndexBatchEntry,
  OperationResults,
  ApplyActions,
  Key,
  keyToStr,
  keyToBuf
} from '../types.js'
import { 
  CONTRACT_SOURCE_PATH,
  genParticipantPath,
  PARTICIPANT_PATH_PREFIX,
  GENESIS_ACK_PATH,
  genAckPath,
  InputSchema,
  AckSchema
} from '../schemas.js'
import { parseHyperbeeMessage } from './util/hyper.js'
import { Storage } from './storage.js'
import { Operation, Transaction } from './transactions.js'
import { IndexLog, OpLog } from './log.js'
import { ContractExecutor } from './executor.js'
import { ContractMonitor } from './monitor.js'
import { VM } from './vm.js'
import lock from './util/lock.js'

export class Contract extends Resource {
  storage: Storage
  index: IndexLog
  oplogs: ResourcesManager<OpLog> = new ResourcesManager()
  vm: VM|undefined
  executor: ContractExecutor|undefined

  private _lockPrefix = ''
  private _myOplog: OpLog|undefined

  constructor (storage: Storage, index: IndexLog) {
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

  get executorOplog (): OpLog|undefined {
    return this.oplogs.find(oplog => oplog.isExecutor)
  }

  get myOplog (): OpLog|undefined {
    return this._myOplog || this.oplogs.find(oplog => oplog.writable)
  }

  setMyOplog (log: OpLog|undefined) {
    if (log) assert.ok(log.writable, 'Oplog must be writable')
    this._myOplog = log
  }

  get isParticipant (): boolean {
    return !!this.myOplog
  }

  isOplogParticipant (oplog: OpLog): boolean {
    return this.oplogs.has(oplog)
  }

  lock (name: string): Promise<() => void> {
    return lock(`${this._lockPrefix}:${name}`)
  }

  [Symbol.for('nodejs.util.inspect.custom')] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  key: ' + opts.stylize(keyToStr(this.pubkey), 'string') + '\n' +
      indent + '  opened: ' + opts.stylize(this.opened, 'boolean') + '\n' +
      indent + '  isExecutor: ' + opts.stylize(this.isExecutor, 'boolean') + '\n' +
      indent + '  isParticipant: ' + opts.stylize(this.isParticipant, 'boolean') + '\n' +
      indent + ')'
  }

  // management
  // =

  static async create (storage: Storage|string, opts: ContractCreateOpts): Promise<Contract> {
    if (typeof storage === 'string') storage = new Storage(storage)
    assert.ok(storage instanceof Storage, 'storage is required')
    assert.equal(typeof opts?.code?.source, 'string', 'opts.code.source is required')

    const index = await IndexLog.create(storage)
    const contract = new Contract(storage, index)
    contract.oplogs.add(await OpLog.create(storage, true)) // executor oplog
    await contract._writeInitBlocks(opts?.code?.source)
    await contract.open()

    return contract
  }

  static async load (storage: Storage|string, pubkey: Key): Promise<Contract> {
    const _storage: Storage = (typeof storage === 'string') ? new Storage(storage) : storage
    assert.ok(_storage instanceof Storage, '_storage is required')
    pubkey = keyToBuf(pubkey) // keyToBuf() will validate the key

    const indexCore = await _storage.getHypercore(pubkey)
    const index = new IndexLog(indexCore)
    const contract = new Contract(_storage, index) 
    const oplogs = await contract.index.listOplogs()
    await Promise.all(oplogs.map(async (oplog) => {
      contract.oplogs.add(new OpLog(await _storage.getHypercore(oplog.pubkey), oplog.executor))
    }))
    await contract.open()
    
    return contract
  }

  async _open () {
    if (this.isExecutor) {
      this.executor = new ContractExecutor(this)
      await this.executor.open()
    }
  }

  async _close () {
    this.executor?.close()
    this.vm?.close()
    await Promise.all([
      this.index.close(),
      this.oplogs.removeAll()
    ])
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

  async call (methodName: string, params: Record<string, any>): Promise<Transaction> {
    if (methodName === 'process' || methodName === 'apply') {
      throw new Error(`Cannot call "${methodName}" directly`)
    }
    await this._createVMIfNeeded()
    if (this.vm) {
      const res = await this.vm.contractCall(methodName, params)
      let ops: Operation[] = []
      if (res.ops?.length) {
        if (!this.myOplog) {
          throw new Error('Unable to execute transaction: not a writer')
        }
        ops = await this.myOplog.dangerousAppend(res.ops)
      }
      return new Transaction(this, res.result, ops)  
    } else {
      throw new Error('Contract VM not instantiated')
    }
  }

  // monitoring
  // =

  async verify () {
    const monitor = new ContractMonitor(this)
    await monitor.open()
    const results = await monitor.verify()
    await monitor.close()
    return results
  }

  async monitor (): Promise<ContractMonitor> {
    const monitor = new ContractMonitor(this)
    await monitor.open()
    monitor.watch()
    return monitor
  }

  // vm
  // =

  private async _readContractCode (): Promise<string> {
    const src = await this.index.get(CONTRACT_SOURCE_PATH)
    if (!src) throw new Error('No contract sourcecode found')
    if (Buffer.isBuffer(src.value)) return src.value.toString('utf8')
    if (typeof src.value === 'string') return src.value
    throw new Error(`Invalid contract sourcecode entry; must be a string or a buffer containing utf-8.`)
  }

  async _createVMIfNeeded () {
    if (this.vm) return
    const source = await this._readContractCode()
    this.vm = new VM(this, source)
    this.vm.on('error', (evt: {error: string}) => {
      this.emit('error', new AggregateError([new Error(evt.error)], 'The contract experienced a runtime error'))
      this.close()
    })
    await this.vm.open()
  }

  // execution
  // =

  private async _writeInitBlocks (source?: string) {
    assert.ok(this.index.length === 0, 'Cannot write init blocks: index log already has entries')
    assert.ok(typeof source === 'string', 'Contract source must be provided')
    assert.ok(this.oplogs.length > 0, 'Oplogs must be created before writing init blocks')
    const batch: IndexBatchEntry[] = [
      {type: 'put', path: CONTRACT_SOURCE_PATH, value: source}
    ]
    for (const oplog of this.oplogs) {
      const pubkey = keyToBuf(oplog.pubkey)
      batch.push({
        type: 'put',
        path: genParticipantPath(oplog.pubkey),
        value: {pubkey, active: true, executor: oplog.isExecutor}
      })
    }
    batch.push({type: 'put', path: GENESIS_ACK_PATH, value: {}})
    await this.index.dangerousBatch(batch)
  }

  _mapApplyActionsToBatch (actions: ApplyActions): IndexBatchEntry[] {
    // NOTE this function is called by the executor *and* the monitor and therefore
    //      it must be a pure function. Any outside state will cause validation to fail.
    // -prf
    return Object.entries(actions)
      .map(([path, action]): IndexBatchEntry => {
        if (path.startsWith('/.sys/')) {
          if (action.type === 'addOplog') {
            const pubkeyBuf = keyToBuf(action.value.pubkey)
            return {type: 'put', path: genParticipantPath(action.value.pubkey), value: {pubkey: pubkeyBuf, active: true, executor: false}}
          } else if (action.type === 'removeOplog') {
            const pubkeyBuf = keyToBuf(action.value.pubkey)
            return {type: 'put', path: genParticipantPath(action.value.pubkey), value: {pubkey: pubkeyBuf, active: false, executor: false}}
          } else if (action.type === 'setContractSource') {
            return {type: 'put', path: CONTRACT_SOURCE_PATH, value: action.value.code}
          }
        }
        return {path, type: action.type, value: action.value}
      })
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  async _executeApplyBatch (batch: IndexBatchEntry[]): Promise<void> {
    if (this.closing || this.closed) return

    // complete writes
    await this.index.dangerousBatch(batch)

    // react to config changes
    for (const batchEntry of batch) {
      if (batchEntry.path === CONTRACT_SOURCE_PATH) {
        await this._onContractCodeChange(batchEntry.value)
      } else if (batchEntry.path.startsWith(PARTICIPANT_PATH_PREFIX)) {
        await this._onOplogChange(batchEntry.value)
      }
    }
  }

  async _onContractCodeChange (code: string) {
    throw new Error('TODO')
  }

  async _onOplogChange (entry: InputSchema): Promise<void> {
    // console.log('_onOplogChange', entry)
    const pubkeyBuf = entry.pubkey
    const oplogIndex = this.oplogs.findIndex(oplog => oplog.pubkey.equals(pubkeyBuf))
    if (oplogIndex === -1 && entry.active) {
      await this.oplogs.add(new OpLog(await this.storage.getHypercore(pubkeyBuf), false))
    } else if (oplogIndex !== -1 && !entry.active) {
      await this.oplogs.removeAt(oplogIndex)
    }
  }

  // helpers
  // =

  async _fetchOpAck (op: Operation): Promise<AckSchema|undefined> {
    if (this.closing || this.closed) return
    const pubkey = op.oplog.pubkey
    const seq = op.proof.seq
    const ack = (await this.index.get(genAckPath(pubkey, seq)))?.value
    return ack ? (ack as AckSchema) : undefined
  }

  async _fetchOpMutations (op: Operation): Promise<OperationResults|undefined> {
    if (this.closing || this.closed) return
    const pubkey = op.oplog.pubkey
    const seq = op.proof.seq
    const ackEntry = await this.index.get(genAckPath(pubkey, seq))
    if (ackEntry && ackEntry.seq) {
      const results: OperationResults = Object.assign(ackEntry.value, {mutations: []})
      if (ackEntry.value.success) {
        for (let i = ackEntry.seq + 1; i <= ackEntry.seq + results.numMutations; i++) {
          results.mutations.push(parseHyperbeeMessage(i, await this.index.core.get(i)))
        }
      }
      return results
    }
  }
}
