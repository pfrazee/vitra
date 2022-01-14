import { keyToBuf, keyToStr } from '../types.js'

export interface ConfigValues {
  pubkey: Buffer
  createdOplogPubkeys: Buffer[]
  monitor: boolean
}

export class Config {
  pubkey: Buffer
  createdOplogPubkeys: Buffer[]
  monitor: boolean

  constructor (values: ConfigValues) {
    this.pubkey = values.pubkey
    this.createdOplogPubkeys = values.createdOplogPubkeys
    this.monitor = values.monitor
  }

  toJSON () {
    return {
      vitraConfig: 1,
      pubkey: keyToStr(this.pubkey),
      createdOplogPubkeys: this.createdOplogPubkeys.map(buf => keyToStr(buf)),
      monitor: this.monitor
    }
  }

  static fromJSON (obj: any): Config {
    const pubkey = keyToBuf(obj.pubkey)
    const createdOplogPubkeys = Array.isArray(obj.createdOplogPubkeys) ? obj.createdOplogPubkeys.map((str: string) => keyToBuf(str)) : []
    const monitor = typeof obj.monitor === 'boolean' ? obj.monitor : false
    return new Config({pubkey, createdOplogPubkeys, monitor})
  }
}