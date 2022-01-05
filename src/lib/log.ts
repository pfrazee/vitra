import assert from 'assert'
import EventEmitter from 'events'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import * as msgpackr from 'msgpackr'
import { Readable } from 'streamx'
import { ItoOperation } from './op.js'
import {
  ItoOpLogEntry,
  ItoIndexLogListOpts,
  ItoIndexLogEntry,
  ItoLogInclusionProof,
  ItoIndexBatchEntry,
  Key,
  keyToStr
} from '../types.js'
import {
  PARTICIPANT_PATH_PREFIX,
} from '../schemas.js'
import { beeShallowList, pathToBeekey } from './hyper.js'
import { ItoStorage } from './storage.js'
// @ts-ignore no types available -prf
import * as c from 'compact-encoding'


export class ItoLog extends EventEmitter {
  core: Hypercore

  constructor (core: Hypercore) {
    super()
    this.core = core
  }

  [Symbol.for('nodejs.util.inspect.custom')] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  key: ' + opts.stylize(keyToStr(this.pubkey), 'string') + '\n' +
      indent + '  opened: ' + opts.stylize(this.core.opened, 'boolean') + '\n' +
      indent + ')'
  }

  get pubkey () {
    return this.core.key
  }

  get length () {
    return this.core.length
  }

  get writable () {
    return this.core.writable
  }

  close () {
    this.core.close()
  }

  async syncLatest () {
    throw new Error('TODO')
  }

  async getBlockInclusionProof (seq: number): Promise<ItoLogInclusionProof> {
    if (!this.core?.core?.tree) throw new Error('Hypercore not initialized')
    const tree = this.core.core.tree
    if (tree.fork !== 0) throw new Error('Tree has been truncated (forked) and is no longer usable')

    const roots = await tree.getRoots(seq)
    const hash = tree.crypto.tree(roots)
    const signableHash = signable(hash, seq + 1, 0)
    const signature = this.core.sign(signableHash)
    return {seq, hash, signature}
  }

  async verifyBlockInclusionProof (proof: ItoLogInclusionProof): Promise<void> {
    if (!this.core?.core?.tree) throw new Error('Hypercore not initialized')
    const tree = this.core.core.tree

    const roots = await tree.getRoots(proof.seq)
    const hash = tree.crypto.tree(roots)

    if (Buffer.compare(proof.hash, hash) !== 0) {
      throw new Error('Invalid checksum')
    }

    const signableHash = signable(proof.hash, proof.seq + 1, 0)
    if (tree.crypto.verify(signableHash, proof.signature, this.pubkey)) {
      throw new Error('Invalid signature')
    }
  }

  createLogReadStream (opts: {start?: number, end?: number, snapshot?: boolean, live?: boolean} = {}) {
    return new ReadStream(this, opts)
  }
}

export class ItoOpLog extends ItoLog {
  constructor (core: Hypercore, public id: number) {
    super(core)
  }

  static async create (storage: ItoStorage, id: number): Promise<ItoOpLog> {
    const core = await storage.createHypercore()
    return new ItoOpLog(core, id)
  }

  async get (seq: number): Promise<ItoOpLogEntry> {
    const value = await this.core.get(seq)
    return {
      seq,
      value: msgpackr.unpack(value)
    }
  }

  async dangerousAppend (values: any[]): Promise<ItoOperation[]> {
    const ops = []
    const baseSeq = await this.core.append(values.map(v => msgpackr.pack(v)))
    for (let i = 0; i < values.length; i++) {
      const seq = baseSeq + i
      const value = values[i]
      const proof = await this.getBlockInclusionProof(seq)
      ops.push(new ItoOperation(this, proof, value))
    }
    return ops
  }
}

export class ItoIndexLog extends ItoLog {
  bee: Hyperbee

  constructor (core: Hypercore) {
    super(core)
    this.bee = new Hyperbee(this.core, {
      keyEncoding: 'utf-8',
      valueEncoding: {
        encode: (v: any) => msgpackr.pack(v),
        encodingLength: (v: any) => msgpackr.pack(v).length,
        decode: (v: any) => msgpackr.unpack(v)
      }
    })
  }

  static async create (storage: ItoStorage): Promise<ItoIndexLog> {
    const core = await storage.createHypercore()
    return new ItoIndexLog(core)
  }

  async list (prefix = '/', opts?: ItoIndexLogListOpts): Promise<ItoIndexLogEntry[]> {
    let arr = await beeShallowList(this.bee, prefix.split('/').filter(Boolean))
    if (opts?.reverse) arr.reverse()
    if (opts?.offset && opts?.limit) {
      arr = arr.slice(opts.offset, opts.offset + opts.limit)
    } else if (opts?.offset) {
      arr = arr.slice(opts.offset)
    } else if (opts?.limit) {
      arr = arr.slice(0, opts.limit)
    }
    return arr
  }

  async get (path: string): Promise<ItoIndexLogEntry|undefined> {
    const entry = await this.bee.get(pathToBeekey(path))
    if (!entry) return undefined
    const pathSegs = entry.key.split(`\x00`).filter(Boolean)
    return {
      seq: entry.seq,
      container: false,
      name: pathSegs[pathSegs.length - 1],
      path: `/${pathSegs.join('/')}`,
      value: entry.value
    }
  }

  async dangerousBatch (batch: ItoIndexBatchEntry[]) {
    if (!this.bee) throw new Error('Hyperbee not initialized')
    const b = this.bee.batch()
    for (const entry of batch) {
      assert(typeof entry.path === 'string' && entry.path.length, 'Invalid batch entry path')
      assert(entry.path !== '/', 'Invalid batch entry path (cannot write to /)')
      const key = pathToBeekey(entry.path)
      if (entry.type === 'put') {
        await b.put(key, entry.value)
      } else if (entry.type === 'delete') {
        await b.del(key)
      } else {
        throw new Error(`Invalid batch entry type: "${entry.type}"`)
      }
    }
    await b.flush()
  }

  async listOplogs (): Promise<{id: number, pubkey: Key}[]> {
    const entries = await this.list(PARTICIPANT_PATH_PREFIX)
    const oplogs = []
    for (const entry of entries) {
      try {
        if (!entry.value.active) continue
        const id = Number(entry.name)
        if (isNaN(id)) throw new Error(`Invalid ID: ${id}`)
        oplogs.push({
          id,
          pubkey: entry.value.pubkey
        })
      } catch (e: any) {
        this.emit('warning', new AggregateError([e], `Invalid entry under ${PARTICIPANT_PATH_PREFIX}, name=${entry.name}`))
      }
    }
    return oplogs
  }
}

export class ReadStream extends Readable {
  start: number
  end: number
  snapshot: boolean
  live: boolean
  constructor (public log: ItoLog, opts: {start?: number, end?: number, snapshot?: boolean, live?: boolean} = {}) {
    super()
    this.start = opts.start || 0
    this.end = typeof opts.end === 'number' ? opts.end : -1
    this.snapshot = !opts.live && opts.snapshot !== false
    this.live = !!opts.live
  }

  _open (cb: any) {
    this._openP().then(cb, cb)
  }

  _read (cb: any) {
    this._readP().then(cb, cb)
  }

  async _openP () {
    if (this.end === -1) await this.log.core.update()
    else await this.log.core.ready()
    if (this.snapshot && this.end === -1) this.end = this.log.core.length
  }

  async _readP () {
    const end = this.live ? -1 : (this.end === -1 ? this.log.core.length : this.end)
    if (end >= 0 && this.start >= end) {
      this.push(null)
      return
    }

    const nextSeq = this.start++
    const nextValue = await this.log.core.get(nextSeq)
    this.push({seq: nextSeq, value: nextValue})
  }
}

function signable (hash: Buffer, length: number, fork: number): Buffer {
  const state = { start: 0, end: 48, buffer: Buffer.alloc(48) }
  c.raw.encode(state, hash)
  c.uint64.encode(state, length)
  c.uint64.encode(state, fork)
  return state.buffer
}

