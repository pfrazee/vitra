import assert from 'assert'
import EventEmitter from 'events'
// @ts-ignore no types available -prf
import AggregateError from 'core-js-pure/actual/aggregate-error.js'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import * as msgpackr from 'msgpackr'
import { Readable } from 'streamx'
import { Operation } from './transactions.js'
import { BlockInclusionProof } from './inclusion-proofs.js'
import { BlockRewriteFraudProof, LogForkFraudProof } from './fraud-proofs.js'
import { InvalidBlockInclusionProofError, BlocksNotAvailableError } from './errors.js'
import {
  OpLogEntry,
  IndexLogListOpts,
  IndexLogEntry,
  IndexBatchEntry,
  IndexHistoryOpts,
  IndexHistoryEntry,
  Key,
  keyToStr
} from '../types.js'
import {
  PARTICIPANT_PATH_PREFIX,
} from '../schemas.js'
import { beeShallowList, pathToBeekey, beekeyToPath } from './util/hyper.js'
import { Storage } from './storage.js'
// @ts-ignore no types available -prf
import * as c from 'compact-encoding'
// @ts-ignore no types available -prf
import * as toIterable from 'stream-to-it'

export class Log extends EventEmitter {
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

  async open () {
  }

  async close () {
    // TODO
    // return this.core.close()
  }

  equals (log: Log) {
    return this.pubkey.equals(log.pubkey)
  }

  get latestProof () {
    if (!this.core?.core?.tree) throw new Error('Hypercore not initialized')
    const tree = this.core.core.tree
    const seq = this.core.length
    const hash = tree.crypto.tree(tree.roots)
    return new BlockInclusionProof(this.pubkey, seq, hash, tree.signature)
  }

  async syncLatest () {
    throw new Error('TODO')
  }

  async generateBlockInclusionProof (seq: number): Promise<BlockInclusionProof> {
    if (!this.core?.core?.tree) throw new Error('Hypercore not initialized')
    const tree = this.core.core.tree
    
    const roots = await tree.getRoots(seq + 1)
    const hash = tree.crypto.tree(roots)
    const signableHash = signable(hash, seq + 1, 0)
    const signature = this.core.sign(signableHash)
    if (tree.fork !== 0) {
      throw new LogForkFraudProof(this.pubkey, tree.fork, seq, hash, signature)
    }
    return new BlockInclusionProof(this.pubkey, seq, hash, signature)
  }

  async verifyBlockInclusionProof (proof: BlockInclusionProof): Promise<void> {
    if (!this.core?.core?.tree) throw new Error('Hypercore not initialized')
    const tree = this.core.core.tree

    if (tree.fork !== 0) {
      const seq = this.core.length
      const hash = tree.crypto.tree(tree.roots)
      throw new LogForkFraudProof(this.pubkey, tree.fork, seq, hash, tree.signature)
    }

    if ((this.core.length - 1) < proof.blockSeq) {
      throw new BlocksNotAvailableError(this.pubkey, proof.blockSeq, this.core.length)
    }

    const roots = await tree.getRoots(proof.blockSeq + 1)
    const hash = tree.crypto.tree(roots)

    const signableHash = signable(proof.rootHashAtBlock, proof.blockSeq + 1, 0)
    if (!tree.crypto.verify(signableHash, proof.rootHashSignature, this.pubkey)) {
      throw new InvalidBlockInclusionProofError('Invalid signature')
    }

    if (Buffer.compare(proof.rootHashAtBlock, hash) !== 0) {
      const violatingProof = await this.generateBlockInclusionProof(proof.blockSeq)
      throw new BlockRewriteFraudProof('Checksums do not match', proof, violatingProof)
    }
  }

  createLogReadStream (opts: {start?: number, end?: number, snapshot?: boolean, live?: boolean} = {}) {
    return new ReadStream(this, opts)
  }
}

export class OpLog extends Log {
  constructor (core: Hypercore, public isExecutor: boolean) {
    super(core)
  }

  [Symbol.for('nodejs.util.inspect.custom')] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  key: ' + opts.stylize(keyToStr(this.pubkey), 'string') + '\n' +
      indent + '  opened: ' + opts.stylize(this.core.opened, 'boolean') + '\n' +
      indent + '  executor: ' + opts.stylize(this.isExecutor, 'boolean') + '\n' +
      indent + ')'
  }

  static async create (storage: Storage, isExecutor: boolean): Promise<OpLog> {
    const core = await storage.createHypercore()
    return new OpLog(core, isExecutor)
  }

  async get (seq: number): Promise<OpLogEntry> {
    const value = await this.core.get(seq)
    return {
      seq,
      value: msgpackr.unpack(value)
    }
  }

  async dangerousAppend (values: any[]): Promise<Operation[]> {
    const ops = []
    const baseSeq = await this.core.append(values.map(v => msgpackr.pack(v)))
    for (let i = 0; i < values.length; i++) {
      const seq = baseSeq + i
      const value = values[i]
      const proof = await this.generateBlockInclusionProof(seq)
      ops.push(new Operation(this, proof, value))
    }
    return ops
  }
}

export class IndexLog extends Log {
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

  static async create (storage: Storage): Promise<IndexLog> {
    const core = await storage.createHypercore()
    return new IndexLog(core)
  }

  async list (prefix = '/', opts?: IndexLogListOpts): Promise<IndexLogEntry[]> {
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

  async get (path: string): Promise<IndexLogEntry|undefined> {
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

  async dangerousBatch (batch: IndexBatchEntry[]) {
    if (!this.bee) throw new Error('Hyperbee not initialized')
    const b = this.bee.batch()
    for (const entry of batch) {
      assert(typeof entry.path === 'string' && entry.path.length, 'Invalid batch entry path')
      assert(entry.path !== '/', 'Invalid batch entry path (cannot write to /)')
      const key = pathToBeekey(entry.path)
      if (entry.type === 'put') {
        await b.put(key, entry.value)
      } else if (entry.type === 'del') {
        await b.del(key)
      } else {
        throw new Error(`Invalid batch entry type: "${entry.type}"`)
      }
    }
    await b.flush()
  }

  async listOplogs (): Promise<{pubkey: Key, executor: boolean}[]> {
    const entries = await this.list(PARTICIPANT_PATH_PREFIX)
    const oplogs = []
    for (const entry of entries) {
      try {
        if (!entry.value.active) continue
        oplogs.push({
          pubkey: entry.value.pubkey,
          executor: entry.value.executor
        })
      } catch (e: any) {
        this.emit('warning', new AggregateError([e], `Invalid entry under ${PARTICIPANT_PATH_PREFIX}, name=${entry.name}`))
      }
    }
    return oplogs
  }

  async* history (opts?: IndexHistoryOpts): AsyncGenerator<IndexHistoryEntry> {
    for await (const entry of toIterable.source(this.bee.createHistoryStream(opts))) {
      const path = `/${beekeyToPath(entry.key)}`
      yield {
        type: entry.type,
        seq: entry.seq,
        path,
        name: path.split('/').filter(Boolean).pop() || '',
        value: entry.value
      }
    }
  }
}

export class ReadStream extends Readable {
  start: number
  end: number
  snapshot: boolean
  live: boolean
  constructor (public log: Log, opts: {start?: number, end?: number, snapshot?: boolean, live?: boolean} = {}) {
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
    try {
      const nextValue = await this.log.core.get(nextSeq)
      this.push({seq: nextSeq, value: nextValue})
    } catch (e) {
      this.push(null)
    }
  }
}

function signable (hash: Buffer, length: number, fork: number): Buffer {
  const state = { start: 0, end: 48, buffer: Buffer.alloc(48) }
  c.raw.encode(state, hash)
  c.uint64.encode(state, length)
  c.uint64.encode(state, fork)
  return state.buffer
}

