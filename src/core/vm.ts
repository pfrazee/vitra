import assert from 'assert'
import path from 'path'
import { fileURLToPath } from 'url'
import { Sandbox as ConfineSandbox } from 'confine-sandbox'
import { Database } from './database.js'
import { keyToStr, keyToBuf } from '../types.js'
import { Resource } from '../util/resource.js'
import { ContractParseError, ContractRuntimeError } from './errors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NODE_MODULES_PATH = path.join(__dirname, '..', '..', 'node_modules')

export class VM extends Resource {
  restricted = false
  private sandbox: ConfineSandbox|undefined
  private cid: number|undefined
  private indexCheckoutSeq: number|undefined

  constructor (public db: Database, public source: string) {
    super()
  }

  async _open () {
    this.sandbox = new ConfineSandbox({
      runtime: 'vitra-confine-runtime',
      globals: this._createVMGlobals(),
      nodeModulesPath: NODE_MODULES_PATH,
      pipeStdout: true,
      pipeStderr: true
    })
    this.sandbox.on('container-runtime-error', evt => {
      this.emit('error', new ContractRuntimeError(evt.error.name, evt.error.message))
    })
    await this.sandbox.init()
    try {
      const {cid} = await this.sandbox.execContainer({
        source: this.source,
        env: {
          indexPubkey: keyToStr(this.db.pubkey),
          oplogPubkey: this.db.localOplog ? keyToStr(this.db.localOplog.pubkey) : undefined
        }
      })
      this.cid = cid
    } catch (e: any) {
      if (e.details?.compileError) {
        this.emit('error', new ContractParseError(e.errorName, e.message))
      } else {
        throw e
      }
    }
  }

  async _close () {
    if (this.sandbox) {
      await this.sandbox.teardown()
    }
    this.sandbox = undefined
    this.cid = undefined
  }

  async contractCall (methodName: string, params: Record<string, any>): Promise<any> {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    try {
      return await this.sandbox.handleAPICall(this.cid, methodName, [params])
    } catch (e: any) {
      if (ContractRuntimeError.isa(e.errorName)) {
        throw new ContractRuntimeError(e.errorName, e.message)
      } else {
        throw e
      }
    }
  }

  async contractProcess (op: any): Promise<any> {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    try {
      return await this.sandbox.handleAPICall(this.cid, 'process', [op])
    } catch (e: any) {
      if (ContractRuntimeError.isa(e.errorName)) {
        throw new ContractRuntimeError(e.errorName, e.message)
      } else {
        throw e
      }
    }
  }

  async contractApply (op: any, ack: any): Promise<any> {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    try {
      return await this.sandbox.handleAPICall(this.cid, 'apply', [op, ack])
    } catch (e: any) {
      if (ContractRuntimeError.isa(e.errorName)) {
        throw new ContractRuntimeError(e.errorName, e.message)
      } else {
        throw e
      }
    }
  }

  async restrict () {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    if (this.restricted) return
    await this.sandbox.configContainer({cid: this.cid, opts: {restricted: true}})
    this.restricted = true
  }

  async unrestrict () {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    if (!this.restricted) return
    await this.sandbox.configContainer({cid: this.cid, opts: {restricted: false}})
    this.restricted = false
  }

  checkoutIndexAt (seq: number|undefined) {
    this.indexCheckoutSeq = seq
  }

  private _createVMGlobals (): any {
    return {
      console: {
        log: (...args: any[]) => this.emit('log', 'log', args),
        debug: (...args: any[]) => this.emit('log', 'debug', args),
        info: (...args: any[]) => this.emit('log', 'info', args),
        warn: (...args: any[]) => this.emit('log', 'warn', args),
        error: (...args: any[]) => this.emit('log', 'error', args)
      },
      __internal__: {
        contract: {
          indexList: async (_pubkey: string, prefix: string, opts?: any) => {
            return await this.db.index.list(prefix, opts, {checkout: this.indexCheckoutSeq})
          },
          indexGet: async (_pubkey: string, key: string) => {
            return await this.db.index.get(key, {checkout: this.indexCheckoutSeq})
          },
          oplogGetLength: (pubkey: string) => {
            const pubkeyBuf = keyToBuf(pubkey)
            const oplog = this.db.oplogs.find(item => item.pubkey.equals(pubkeyBuf))
            if (oplog) return oplog.length
            throw new Error(`OpLog is not a participant (key=${pubkey})`)
          },
          oplogGet: async (pubkey: string, seq: number) => {
            const pubkeyBuf = keyToBuf(pubkey)
            const oplog = this.db.oplogs.find(item => item.pubkey.equals(pubkeyBuf))
            if (oplog) return await oplog.get(seq)
            throw new Error(`OpLog is not a participant (key=${pubkey})`)
          }
        }
      }
    }
  }
}