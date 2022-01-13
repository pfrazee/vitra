import { promises as fsp } from 'fs'
import { join } from 'path'
import { Config } from './config.js'
import { FraudProof } from '../core/fraud-proofs.js'
import { Transaction } from '../core/transactions.js'
import EventEmitter from 'events'

export interface DataDirectoryInfo {
  exists: boolean
  config?: Config
}

export class DataDirectory {
  constructor (public path: string) {
  }

  get configFilePath () {
    return join(this.path, 'vitra.json')
  }

  get socketFilePath () {
    return join(this.path, `server.sock`)
  }

  get coresPath () {
    return join(this.path, 'cores')
  }

  get transactionsPath () {
    return join(this.path, 'tx')
  }

  transactionFilePath (tx: Transaction|string) {
    return join(this.transactionsPath, `${tx instanceof Transaction ? tx.txId : tx}.json`)
  }

  get fraudsPath () {
    return join(this.path, 'fraud')
  }

  fraudFilePath (fraudId: string) {
    return join(this.fraudsPath, `${fraudId}.json`)
  }

  async info (): Promise<DataDirectoryInfo> {
    const st = await fsp.stat(this.path).catch(e => undefined)
    if (!st?.isDirectory()) {
      return {
        exists: false
      }
    }
    const config = await this.readConfigFile().catch(e => undefined)
    return {
      exists: !!config,
      config
    }
  }

  async destroy () {
    await fsp.rm(this.path, {recursive: true})
  }

  async readConfigFile (): Promise<Config> {
    const obj = JSON.parse(await fsp.readFile(this.configFilePath, 'utf-8'))
    return Config.fromJSON(obj)
  }

  async writeConfigFile (cfg: Config) {
    await fsp.writeFile(this.configFilePath, JSON.stringify(cfg.toJSON(), null, 2), 'utf-8')
  }

  async trackTransaction (tx: Transaction) {
    if (!await this.writeTransaction(tx)) {
      await tx.whenProcessed()
      await this.writeTransaction(tx)
    }
  }

  async writeTransaction (tx: Transaction): Promise<boolean> {
    const filepath = this.transactionFilePath(tx)
    const obj = await tx.toJSON({includeValues: true})
    await fsp.mkdir(this.transactionsPath, {recursive: true}).catch(_ => undefined)
    await fsp.writeFile(filepath, JSON.stringify(obj, null, 2))
    return obj.isProcessed
  }

  async listTrackedTxIds (): Promise<string[]> {
    const names = await fsp.readdir(this.transactionsPath).catch(_ => [])
    return names.filter(name => name.endsWith('.json')).map(name => name.slice(0, name.length - 5))
  }

  async readTrackedTx (txId: string): Promise<any> {
    try {
      return JSON.parse(await fsp.readFile(this.transactionFilePath(txId), 'utf-8'))
    } catch (e) {
      return undefined
    }
  }

  async watchFraudsFolder () {
    await fsp.mkdir(this.fraudsPath, {recursive: true}).catch(_ => undefined)
    return new FraudFolderWatcher(this.fraudsPath)
  }

  async writeFraud (fraudId: string, fraud: FraudProof) {
    const filepath = this.fraudFilePath(fraudId)
    const obj = fraud.toJSON()
    await fsp.mkdir(this.fraudsPath, {recursive: true}).catch(_ => undefined)
    await fsp.writeFile(filepath, JSON.stringify(obj, null, 2))
  }

  async listTrackedFraudIds (): Promise<string[]> {
    const names = await fsp.readdir(this.fraudsPath).catch(_ => [])
    return names.filter(name => name.endsWith('.json')).map(name => name.slice(0, name.length - 5))
  }

  async readTrackedFraud (fraudId: string): Promise<any> {
    try {
      return JSON.parse(await fsp.readFile(this.fraudFilePath(fraudId), 'utf-8'))
    } catch (e) {
      return undefined
    }
  }
}

export class FraudFolderWatcher extends EventEmitter {
  private watchAbort: AbortController

  constructor (public path: string) {
    super()
    this.watchAbort = new AbortController()
    const watcher = fsp.watch(path, {persistent: false, signal: this.watchAbort.signal})
    this.readAndEmit()
    ;(async () => {
      try {
        for await (const event of watcher) {
          this.readAndEmit()
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') this.emit('error', e)
      }
    })()
  }

  private async readAndEmit () {
    const names = await fsp.readdir(this.path).catch(_ => [])
    if (names.length > 0) {
      this.emit('frauds', names.filter(name => name.endsWith('.json')).map(name => name.slice(0, name.length - 5)))
    }
  }

  async close () {
    this.watchAbort.abort()
  }
}