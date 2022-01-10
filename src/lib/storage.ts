import path from 'path'
import { promises as fsp } from 'fs'
import Hypercore from 'hypercore'
import crypto, { KeyPair } from 'hypercore-crypto'
// @ts-ignore types not available -prf
import ram from 'random-access-memory'
import { Key, keyToStr, keyToBuf } from '../types.js'

interface StoredKeyPair {
  publicKey: Buffer
  secretKey: Buffer|undefined
}

export class Storage {
  constructor (public basePath: string) {
    this.basePath = path.resolve(basePath)
  }

  async getHypercore (key: Key): Promise<Hypercore> {
    const corePath = this._getPath(key)
    const keyPair = await this._readKeyPair(corePath)
    const c = new Hypercore(corePath, keyPair.publicKey, {
      keyPair: keyPair.secretKey ? (keyPair as KeyPair) : undefined
    })
    await c.ready()
    return c
  }

  async createHypercore (): Promise<Hypercore> {
    const keyPair = crypto.keyPair()
    const corePath = this._getPath(keyPair.publicKey)
    const c = new Hypercore(corePath, keyPair.publicKey, {keyPair})
    await c.ready()
    await this._writeKeyPair(corePath, keyPair)
    return c
  }

  private _getPath (key: Key): string {
    return path.join(this.basePath, keyToStr(key))
  }

  private async _readKeyPair (corePath: string): Promise<StoredKeyPair> {
    const str = await fsp.readFile(path.join(corePath, 'keypair.json'), 'utf8')
    const obj = JSON.parse(str)
    return {
      publicKey: keyToBuf(obj.publicKey),
      secretKey: obj.secretKey ? Buffer.from(obj.secretKey, 'hex') : undefined
    }
  }

  private async _writeKeyPair (corePath: string, keyPair: StoredKeyPair): Promise<void> {
    const obj = {
      publicKey: keyToStr(keyPair.publicKey),
      secretKey: keyPair.secretKey ? keyPair.secretKey.toString('hex') : undefined
    }
    const str = JSON.stringify(obj)
    await fsp.writeFile(path.join(corePath, 'keypair.json'), str, 'utf8')
  }
}

export class StorageInMemory extends Storage {
  private loadedCores: Map<string, Hypercore> = new Map()
  keyPairs: Map<string, StoredKeyPair> = new Map()

  constructor () {
    super('')
  }

  async getHypercore (key: Key): Promise<Hypercore> {
    const keyStr = keyToStr(key)

    const existingCore = this.loadedCores.get(keyStr)
    if (existingCore) {
      return existingCore.session()
    }
    
    const keyPair = this.keyPairs.get(keyStr)
    const c = new Hypercore(ram, keyToBuf(key), {
      keyPair: keyPair?.secretKey ? (keyPair as KeyPair) : undefined
    })
    this.loadedCores.set(keyStr, c)
    await c.ready()
    return c
  }

  async createHypercore (): Promise<Hypercore> {
    const keyPair = crypto.keyPair()
    const c = new Hypercore(ram, keyPair.publicKey, {keyPair})
    this.loadedCores.set(keyToStr(keyPair.publicKey), c)
    this.keyPairs.set(keyToStr(keyPair.publicKey), keyPair)
    await c.ready()
    return c
  }
}