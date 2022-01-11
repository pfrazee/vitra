import { AckSchema } from './schemas.js'

export type Key = string|Buffer

export interface ContractCode {
  source: string
}

export enum ExecutorBehavior {
  DISABLED,
  TEST_PROCESS_OP_MULTIPLE_TIMES,
  TEST_SKIP_OPS,
  TEST_WRONG_OP_MUTATIONS
}

export interface DatabaseOpts {
  executorBehavior?: ExecutorBehavior
}

export interface DatabaseCreateOpts extends DatabaseOpts {
  contract: ContractCode
}

export interface IndexChange {
  type: 'put'|'del'
  seq: number
  path: string
  value: any
}

export interface OperationResults extends AckSchema {
  changes: IndexChange[]
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

export interface IndexHistoryOpts {
  live?: boolean
  reverse?: boolean
  gte?: number
  gt?: number
  lte?: number
  lt?: number
  limit?: number
}

export interface IndexHistoryEntry {
  type: string
  seq: number
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