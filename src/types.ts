export type Key = string|Buffer

export interface ContractCode {
  source: string
}

export interface ContractCreateOpts {
  code: ContractCode
}

export interface LogInclusionProof {
  seq: number
  hash: Buffer
  signature: Buffer
}

export interface Ack {
  success: boolean|undefined
  error: string|undefined
  origin: string
  seq: number
  ts: number
  metadata: any
  numMutations: number
}

export interface OperationResults extends Ack {
  mutations: any[]
}

export interface IndexBatchEntry {
  type: string
  path: string
  value?: any
}

export interface OpLogEntry {
  seq: number
  value: any
}

export interface IndexLogListOpts {
  reverse?: boolean
  offset?: number
  limit?: number
}

export interface IndexLogEntry {
  container: boolean
  seq: number|undefined
  path: string
  name: string
  value: any
}

export interface BaseApiCallRes {
  response: any
  ops: any[]
}

export type ApplyActions = Record<string, {type: string, value?: any}>

export function keyToBuf (key: Key) {
  if (Buffer.isBuffer(key)) {
    if (key.byteLength !== 32) {
      throw new Error(`Invalid key size (${key.byteLength}), must be 32 bytes`)
    }
    return key
  } else if (typeof key === 'string') {
    if (key.length !== 64) {
      throw new Error(`Invalid key size (${key.length}), must be a 64-character hex string`)
    }
    return Buffer.from(key, 'hex')
  }
  throw new Error(`Not a key: ${key}`)
}

export function keyToStr (key: Key) {
  if (Buffer.isBuffer(key)) {
    if (key.byteLength !== 32) {
      throw new Error(`Invalid key size (${key.byteLength}), must be 32 bytes`)
    }
    return key.toString('hex')
  } else if (typeof key === 'string') {
    if (key.length !== 64) {
      throw new Error(`Invalid key size (${key.length}), must be a 64-character hex string`)
    }
    return key
  }
  throw new Error(`Not a key: ${key}`)
}