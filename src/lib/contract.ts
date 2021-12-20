import { EventEmitter } from 'events'
import { Sandbox as ConfineSandbox } from 'confine-sandbox'
import { Key, keyToBuf, CONTRACT_SOURCE_KEY } from '../types.js'
import { ItoOperation } from './op.js'
import { ItoTransaction } from './tx.js'
import { ItoIndexLog, ItoOpLog } from './log.js'

export class ItoContract extends EventEmitter {
  pubkey: Buffer
  index: ItoIndexLog|undefined
  oplogs: ItoOpLog[]|undefined 
  vm: ConfineSandbox|undefined

  constructor (pubkey: Key) {
    super()
    this.pubkey = keyToBuf(pubkey)
  }

  get isExecutor (): boolean {
    throw new Error('TODO')
  }

  get isParticipant (): boolean {
    throw new Error('TODO')
  }

  // management
  // =

  static async create (): Promise<ItoContract> {
    throw new Error('TODO')

    const contract = new ItoContract('')

    // load VM
    await contract._createVM()

    // create index
    // TODO

    // create oplogs
    // TODO

    // write init blocks
    // TODO

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
    throw new Error('TODO')
  }

  // monitoring
  // =

  async verify () {
    throw new Error('TODO')
  }

  async monitor () {
    throw new Error('TODO')
  }

  async verifyOp (op: ItoOperation) {
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
    return {
      console: {
        log: (...args: any[]) => this.emit('contract:log', 'log', args),
        debug: (...args: any[]) => this.emit('contract:log', 'debug', args),
        info: (...args: any[]) => this.emit('contract:log', 'info', args),
        warn: (...args: any[]) => this.emit('contract:log', 'warn', args),
        error: (...args: any[]) => this.emit('contract:log', 'error', args)
      }
    }
  }

  private async _createVM () {
    const source = await this._readContractCode()
    this.vm = new ConfineSandbox({
      runtime: 'ito-confine-runtime',
      globals: this._createVMGlobals()
    })
    await this.vm.execContainer({
      sourcePath: '/ito-vm-virtual-path/index.js',
      source
    })
  }

  // execution
  // =

  private _startExecutor () {
    if (!this.isExecutor) {
      throw new Error('Not the executor')
    }
    throw new Error('TODO')
  }
}

