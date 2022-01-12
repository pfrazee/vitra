import { keyToBuf, keyToStr } from '../types.js'

export interface ConfigValues {
  pubkey: Buffer
}

export class Config {
  pubkey: Buffer

  constructor (values: ConfigValues) {
    this.pubkey = values.pubkey
  }

  toJSON () {
    return {
      vitraConfig: 1,
      pubkey: keyToStr(this.pubkey)
    }
  }

  static fromJSON (obj: any): Config {
    const pubkey = keyToBuf(obj.pubkey)
    return new Config({pubkey})
  }
}