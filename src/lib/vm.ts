import EventEmitter from 'events'
import assert from 'assert'
import { Sandbox as ConfineSandbox } from 'confine-sandbox'
import { ItoContract } from './contract.js'
import { keyToStr } from '../types.js'

export class ItoVM extends EventEmitter {
  restricted = false
  private sandbox: ConfineSandbox|undefined
  private cid: number|undefined

  constructor (public contract: ItoContract, public source: string) {
    super()
  }

  async init () {
    this.sandbox = new ConfineSandbox({
      runtime: 'ito-confine-runtime',
      globals: this._createVMGlobals()
    })
    const {cid} = await this.sandbox.execContainer({
      source: this.source,
      env: {
        indexPubkey: keyToStr(this.contract.pubkey),
        oplogPubkey: this.contract.myOplog ? keyToStr(this.contract.myOplog.pubkey) : undefined
      }
    })
    this.cid = cid
  }

  async destroy () {
    if (this.sandbox) {
      if (this.cid) {
        await this.sandbox.killContainer({cid: this.cid})
      }
      await this.sandbox.teardown()
    }
    this.sandbox = undefined
    this.cid = undefined
  }

  async handleAPICall (methodName: string, params: any[]): Promise<any> {
    assert(!!this.sandbox, 'Contract VM not initialized')
    assert(!!this.cid, 'Contract VM not initialized')
    return await this.sandbox.handleAPICall(this.cid, methodName, params)
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
          indexList: this.contract.index.list.bind(this),
          indexGet: this.contract.index.get.bind(this),
          oplogGetLength: () => this.contract.myOplog?.core.length,
          oplogGet: this.contract.myOplog?.get.bind(this)
        }
      }
    }
  }
}