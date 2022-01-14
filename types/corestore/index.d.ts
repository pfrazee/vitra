declare module 'corestore' {
  type EventEmitter = import('events').EventEmitter
  type Hypercore = import('hypercore')
  type NoiseSecretStream = import('@hyperswarm/secret-stream')

  declare class Corestore extends EventEmitter {
    constructor (opts: any)
    get (opts: any): Hypercore
    replicate (opts: any): NoiseSecretStream
    namespace (ns: string): Corestore
    ready (): Promise<void>
    close (): Promise<void>
  }

  export = Corestore
}