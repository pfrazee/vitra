import { Resource } from '../util/resource.js'
import { DataDirectory } from './data-directory.js'
import { Config } from './config.js'
import { Database } from '../core/database.js'

export class Server extends Resource {
  constructor (public dir: DataDirectory, public db: Database) {
    super()
  }

  static async createNew (dir: DataDirectory, contractSource: string): Promise<Server> {
    const db = await Database.create(dir.coresPath, {contract: {source: contractSource}})
    const cfg = new Config({pubkey: db.pubkey})
    await dir.writeConfigFile(cfg)
    const server = new Server(dir, db)
    await server.open()
    return server
  }

  static async createFromExisting (dir: DataDirectory, pubkey: Buffer): Promise<Server> {
    const db = await Database.load(dir.coresPath, pubkey)
    const cfg = new Config({pubkey: db.pubkey})
    await dir.writeConfigFile(cfg)
    const server = new Server(dir, db)
    await server.open()
    return server
  }

  static async load (dir: DataDirectory): Promise<Server> {
    const cfg = await dir.readConfigFile()
    const db = await Database.load(dir.coresPath, cfg.pubkey)
    const server = new Server(dir, db)
    await server.open()
    return server
  }

  async _open () {

  }

  async _close () {
    await this.db.close()
  }
}