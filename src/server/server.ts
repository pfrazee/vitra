import { Resource } from '../util/resource.js'
import { DataDirectory } from './data-directory.js'
import { Config } from './config.js'
import { Database } from '../core/database.js'
import { ContractMonitor } from '../core/monitor.js'
import { FraudProof } from '../core/fraud-proofs.js'

export class Server extends Resource {
  monitor: ContractMonitor|undefined

  constructor (public cfg: Config, public dir: DataDirectory, public db: Database) {
    super()
  }

  static async createNew (dir: DataDirectory, contractSource: string): Promise<Server> {
    const db = await Database.create(dir.coresPath, {contract: {source: contractSource}})
    const cfg = new Config({pubkey: db.pubkey, monitor: false})
    await dir.writeConfigFile(cfg)
    const server = new Server(cfg, dir, db)
    await server.open()
    return server
  }

  static async createFromExisting (dir: DataDirectory, pubkey: Buffer): Promise<Server> {
    const db = await Database.load(dir.coresPath, pubkey)
    const cfg = new Config({pubkey: db.pubkey, monitor: false})
    await dir.writeConfigFile(cfg)
    const server = new Server(cfg, dir, db)
    await server.open()
    return server
  }

  static async load (dir: DataDirectory): Promise<Server> {
    const cfg = await dir.readConfigFile()
    const db = await Database.load(dir.coresPath, cfg.pubkey)
    const server = new Server(cfg, dir, db)
    await server.open()
    return server
  }

  static async createTestSandbox (dir: DataDirectory, contractSource: string): Promise<Server> {
    const db = await Database.createSandbox({contract: {source: contractSource}})
    const cfg = new Config({pubkey: db.pubkey, monitor: false})
    await dir.writeConfigFile(cfg)
    const server = new Server(cfg, dir, db)
    await server.open()
    return server
  }

  async _open () {
    if (this.cfg.monitor) {
      await this.startMonitor()
    }
  }

  async _close () {
    await this.db.close()
  }

  async startMonitor () {
    if (this.monitor) return
    this.monitor = await this.db.monitor()
    this.monitor.on('violation', e => {
      if (e instanceof FraudProof) {
        this.dir.writeFraud(String(Date.now()), e)
      } else {
        console.error(`An error occurred during monitoring:`)
        console.error(e)
      }
    })
    if (!this.cfg.monitor) {
      this.cfg.monitor = true
      await this.dir.writeConfigFile(this.cfg)
    }
  }

  async stopMonitor () {
    if (this.monitor) {
      await this.monitor.close()
      this.monitor = undefined
      this.cfg.monitor = false
      await this.dir.writeConfigFile(this.cfg)
    }
  }
}