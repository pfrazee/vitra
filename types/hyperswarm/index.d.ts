declare module 'hyperswarm' {
  type EventEmitter = import('events').EventEmitter

  declare class PeerDiscovery {
    // TODO
  }

  declare class PeerInfo {
    publicKey: Buffer
    relayAddresses: any[]
    reconnecting: boolean
    proven: boolean
    banned: boolean
    tried: boolean
    queued: boolean
    topics: string[]
    attempts: number
    priority: number
    server: boolean
  }

  declare class Hyperswarm extends EventEmitter {
    peers: Map<string, PeerInfo>

    constructor (opts?: any)
    join (topic: Buffer): PeerDiscovery
    leave (topic: Buffer): Promise<void>
    flush (): Promise<void>
    destroy (): Promise<void>
    on(evt: string, handler: Function)
  }

  export = Hyperswarm
}