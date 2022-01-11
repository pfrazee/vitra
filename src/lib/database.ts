import { Resource } from './util/resource.js'
import { ResourcesManager } from './util/resources-manager.js'
import { UsageManager } from './util/usage-manager.js'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import * as assert from 'assert'
import {
  DatabaseOpts,
  DatabaseCreateOpts,
  ExecutorBehavior,
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
import { beekeyToPath } from './util/hyper.js'
import { Storage } from './storage.js'
import { Operation, Transaction } from './transactions.js'
import { IndexLog, OpLog } from './log.js'
import { ContractExecutor } from './executor.js'
import { TestContractExecutor } from './testing/executor.js'
import { ContractMonitor } from './monitor.js'
import { VM } from './vm.js'
import lock from './util/lock.js'

export class Database extends Resource {
  storage: Storage
  index: IndexLog
  oplogs: ResourcesManager<OpLog> = new ResourcesManager()
  vm: VM|undefined
  vmManager = new UsageManager()
  executor: ContractExecutor|undefined

  private _lockPrefix = ''
  private _localOplogOverride: OpLog|undefined

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

  get localOplog (): OpLog|undefined {
    return this._localOplogOverride || this.oplogs.find(oplog => oplog.writable)
  }

  async setLocalOplog (log: OpLog|undefined) {
    if (log) assert.ok(log.writable, 'Oplog must be writable')
    this._localOplogOverride = log
    await this._restartVM()
  }

  get isParticipant (): boolean {
    return !!this.localOplog
  }

  isOplogParticipant (oplog: OpLog|Buffer): boolean {
    return Buffer.isBuffer(oplog) ? this.oplogs.has(l => l.pubkey.equals(oplog)) : this.oplogs.has(oplog)
  }

  getParticipant (pubkey: Buffer): OpLog|undefined {
    return this.oplogs.find(l => l.pubkey.equals(pubkey))
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

  static async create (storage: Storage|string, opts: DatabaseCreateOpts): Promise<Database> {
    if (typeof storage === 'string') storage = new Storage(storage)
    assert.ok(storage instanceof Storage, 'storage is required')
    assert.equal(typeof opts?.contract?.source, 'string', 'opts.code.source is required')

    const index = await IndexLog.create(storage)
    const contract = new Database(storage, index)
    contract.oplogs.add(await OpLog.create(storage, true)) // executor oplog
    await contract._writeInitBlocks(opts?.contract?.source)
    await contract.open(opts)

    return contract
  }

  static async load (storage: Storage|string, pubkey: Key, opts?: DatabaseOpts): Promise<Database> {
    const _storage: Storage = (typeof storage === 'string') ? new Storage(storage) : storage
    assert.ok(_storage instanceof Storage, '_storage is required')
    pubkey = keyToBuf(pubkey) // keyToBuf() will validate the key

    const indexCore = await _storage.getHypercore(pubkey)
    const index = new IndexLog(indexCore)
    const contract = new Database(_storage, index) 
    const oplogs = await contract.index.listOplogs()
    await Promise.all(oplogs.map(async (oplog) => {
      contract.oplogs.add(new OpLog(await _storage.getHypercore(oplog.pubkey), oplog.executor))
    }))
    await contract.open()
    
    return contract
  }

  async _open (opts?: DatabaseOpts|DatabaseCreateOpts) {
    if (this.isExecutor) {
      if (typeof opts?.executorBehavior === 'number') {
        if (opts.executorBehavior === ExecutorBehavior.DISABLED) {
          // don't instantiate
        } else {
          this.executor = new TestContractExecutor(this, opts.executorBehavior)
          await this.executor.open()
        }
      } else {
        this.executor = new ContractExecutor(this)
        await this.executor.open()
      }
    }
    if (this.executor) {
      // start the VM next tick so that error handlers can be registered
      process.nextTick(async () => {
        if (this.closing || this.closed) return
        try {
          await this._startVM()
        } catch (e) {
          this.emit('error', e)
        }
      })
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
    await this._startVM()
    return await this.vmManager.use<Transaction>(async () => {
      if (this.vm) {
        const res = await this.vm.contractCall(methodName, params)
        let ops: Operation[] = []
        if (res.ops?.length) {
          if (!this.localOplog) {
            throw new Error('Unable to execute transaction: not a writer')
          }
          ops = await this.localOplog.dangerousAppend(res.ops)
        }
        return new Transaction(this, res.result, ops)  
      } else {
        throw new Error('Contract VM not instantiated')
      }
    })
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

  async _startVM () {
    const release = await this.lock('_startVM')
    try {
      if (this.vm) return
      await this.vmManager.pause()
      const source = await this._readContractCode()
      this.vm = new VM(this, source)
      this.vm.on('error', (error: any) => this.emit('error', error))
      await this.vm.open()
      this.vmManager.unpause()
    } finally {
      release()
    }
  }

  private async _restartVM () {
    if (!this.vm) return
    await this.vmManager.pause()
    await this.vm.close()
    this.vm = undefined
    this.vmManager.unpause()
    await this._startVM()
  }

  async _onContractCodeChange (source: string) {
    await this.vmManager.pause()
    if (this.vm) await this.vm.close()
    this.vm = new VM(this, source)
    this.vm.on('error', (error: any) => this.emit('error', error))
    await this.vm.open()
    this.vmManager.unpause()
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
    // NOTE This function is called by the executor *and* the monitor and therefore
    //      it must be a pure function. Any outside state will cause validation to fail.
    //      (It might be a good idea to move this out of the contract class.)
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

  async _onOplogChange (entry: InputSchema): Promise<void> {
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
    const seq = op.proof.blockSeq
    const ack = (await this.index.get(genAckPath(pubkey, seq)))?.value
    return ack ? (ack as AckSchema) : undefined
  }

  async _fetchOpResults (op: Operation): Promise<OperationResults|undefined> {
    if (this.closing || this.closed) return
    const pubkey = op.oplog.pubkey
    const seq = op.proof.blockSeq
    const ackEntry = await this.index.get(genAckPath(pubkey, seq))
    if (ackEntry && ackEntry.seq) {
      const results: OperationResults = Object.assign(ackEntry.value, {changes: []})
      if (ackEntry.value.success) {
        for (let i = ackEntry.seq + 1; i <= ackEntry.seq + results.numChanges; i++) {
          const node = await this.index.bee.getBlock(i, {})
          const nodeObj = node.final()
          results.changes.push({
            type: node.isDeletion() ? 'del' : 'put',
            seq: nodeObj.seq,
            path: `/${beekeyToPath(nodeObj.key)}`,
            value: nodeObj.value
          })
        }
      }
      return results
    }
  }
}
