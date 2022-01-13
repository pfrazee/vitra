import { keyToBuf, keyToStr } from '../types.js'

export interface ConfigValues {
  pubkey: Buffer
  monitor: boolean
}

export class Config {
  pubkey: Buffer
  monitor: boolean

  constructor (values: ConfigValues) {
    this.pubkey = values.pubkey
    this.monitor = values.monitor
  }

  toJSON () {
    return {
      vitraConfig: 1,
      pubkey: keyToStr(this.pubkey),
      monitor: this.monitor
    }
  }

  static fromJSON (obj: any): Config {
    const pubkey = keyToBuf(obj.pubkey)
    const monitor = typeof obj.monitor === 'boolean' ? obj.monitor : false
    return new Config({pubkey, monitor})
  }
}