import Hypercore from 'hypercore'
import { Key, keyToBuf } from '../types.js'

export class ItoStorage {
  async getHypercore (key: Key): Promise<Hypercore> {
    key = keyToBuf(key)
    throw new Error('TODO')
  }

  async createHypercore (): Promise<Hypercore> {
    throw new Error('TODO')
  }
}