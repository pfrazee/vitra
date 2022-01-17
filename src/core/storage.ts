import path from 'path'
import { Resource } from '../util/resource.js'
import Hypercore from 'hypercore'
import Corestore from 'corestore'
// @ts-ignore types not available -prf
import raf from 'random-access-file'
// @ts-ignore types not available -prf
import ram from 'random-access-memory'
import { Key } from '../types.js'

interface StoredKeyPair {
  publicKey: Buffer
  secretKey: Buffer|undefined
}

export class Storage extends Resource {
  corestore: Corestore
  constructor (public basePath: string) {
    super()
    this.basePath = path.resolve(basePath)
    this.corestore = new Corestore(this._getCorestoreOpts())
  }

  protected _getCorestoreOpts (): any {
    // return this.basePath
    return (name: string) => {
      return raf(name, { directory: this.basePath })
    }
  }

  async _open () {
    // await this.corestore.ready()
  }

  async _close () {
    await this.corestore.close()
  }

  async getHypercore (key: Key|string): Promise<Hypercore> {
    let c
    if (typeof key === 'string') {
      c = this.corestore.get({name: key})
    } else {
      c = this.corestore.get(key)
    }
    await c.ready()
    return c
  }

  async createHypercore (): Promise<Hypercore> {
    return await this.getHypercore(genName())
  }
}

export class StorageInMemory extends Storage {
  constructor () {
    super('')
  }

  protected _getCorestoreOpts (): any {
    return ram
  }
}

let lastNameName = 0
function genName () {
  let num = Date.now()
  while (num <= lastNameName) {
    num++
  }
  lastNameName = num
  return String(num)
}