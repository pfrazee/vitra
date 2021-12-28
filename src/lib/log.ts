import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { Readable } from 'streamx'
import { ItoOperation } from './op.js'
import { ItoOpLogEntry, ItoIndexLogListOpts, ItoIndexLogListEntry, ItoLogInclusionProof, ItoIndexBatchEntry } from '../types.js'
import { ItoStorage } from './storage.js'
// @ts-ignore no types available -prf
import * as c from 'compact-encoding'

export class ItoLog {
  core: Hypercore

  constructor (core: Hypercore) {
    this.core = core
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
  static async create (storage: ItoStorage): Promise<ItoOpLog> {
    const core = await storage.createHypercore()
    return new ItoOpLog(core)
  }

  get length (): number {
    throw new Error('TODO')
  }

  async get (seq: number): Promise<ItoOpLogEntry> {
    throw new Error('TODO')
  }

  async dangerousAppend (values: any[]): Promise<ItoOperation[]> {
    const ops = []
    const baseSeq = await this.core.append(values)
    for (let i = 0; i < values.length; i++) {
      const seq = baseSeq + i
      const value = values[i]
      const proof = await this.getBlockInclusionProof(seq)
      ops.push(new ItoOperation(this, value, proof))
    }
    return ops
  }
}

export class ItoIndexLog extends ItoLog {
  bee: Hyperbee|undefined

  constructor (core: Hypercore) {
    super(core)
    this.bee = new Hyperbee(this.core)
  }

  static async create (storage: ItoStorage): Promise<ItoIndexLog> {
    const core = await storage.createHypercore()
    return new ItoIndexLog(core)
  }

  async list (prefix = '/', opts?: ItoIndexLogListOpts): Promise<ItoIndexLogListEntry[]> {
    throw new Error('TODO')
  }

  async get (key: string): Promise<any> {
    throw new Error('TODO')
  }

  async dangerousBatch (batch: ItoIndexBatchEntry[]) {
    if (!this.bee) throw new Error('Hyperbee not initialized')
    const b = this.bee.batch()
    for (const entry of batch) {
      if (entry.action === 'put') {
        await b.put(entry.key, entry.value)
      } else {
        await b.del(entry.key)
      }
    }
    await b.flush()
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
