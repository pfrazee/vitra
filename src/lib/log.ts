import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { Key, keyToBuf, ItoOpLogEntry, ItoIndexLogListOpts, ItoIndexLogListEntry } from '../types.js'

export class ItoLog {
  pubkey: Buffer
  core: Hypercore|undefined

  constructor (pubkey: Key) {
    this.pubkey = keyToBuf(pubkey)
  }
}

export class ItoOpLog extends ItoLog {
  get length (): number {
    throw new Error('TODO')
  }

  async get (seq: number): Promise<ItoOpLogEntry[]> {
    throw new Error('TODO')
  }

  async __dangerousAppend (value: any): Promise<ItoOpLogEntry> {
    throw new Error('TODO')
  }
}

export class ItoIndexLog extends ItoLog {
  bee: Hyperbee|undefined

  async list (prefix = '/', opts?: ItoIndexLogListOpts): Promise<ItoIndexLogListEntry[]> {
    throw new Error('TODO')
  }

  async get (key: string): Promise<any> {
    throw new Error('TODO')
  }

  async __dangerousPut (key: string, value: any): Promise<void> {
    throw new Error('TODO')
  }

  async __dangerousDel (key: string): Promise<void> {
    throw new Error('TODO')
  }
}