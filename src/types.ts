export const CONTRACT_SOURCE_KEY = '/.sys/contract/source'

export type Key = string|Buffer

export interface ItoOpLogEntry {
  seq: number
  value: any
}

export interface ItoIndexLogListOpts {
  reverse?: boolean
  limit?: number
}

export interface ItoIndexLogListEntry {
  seq: number
  key: string
  value: any
}

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