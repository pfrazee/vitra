declare module 'hypercore' {
  type EventEmitter = import('events').EventEmitter
  type NoiseSecretStream = import('@hyperswarm/secret-stream')

  declare interface HypercorePeer {
    key: Buffer
    discoveryKey: Buffer
  }

  declare interface HypercoreSeekResult {
    // TODO
  }

  declare interface HypercoreRangeOpts {
    linear?: boolean
    blocks?: Set<number>|number[]
    start?: number
    end?: number
  }
  
  declare interface HypercoreRangeResult {
    linear: boolean
    start: number
    end: number
    done: boolean
    contains ({index: number}): boolean
    downloaded (): Promise<boolean>
  }

  declare interface HypercoreExtensionHandlers {
    onmessage: Function
    onremotesupports: Function
  }

  declare interface HypercoreExtension {
    // TODO
  }

  declare class MerkleTreeNode {
    index: number
    size: number
    hash: Buffer
  }

  declare interface HypercoreCrypto {
    // this is a partial declaration of the interface
    sign (message: Buffer, secretKey: Buffer): Buffer
    verify (message: Buffer, signature: Buffer, publicKey: Buffer): boolean
    tree (peaks: MerkleTreeNode[]): Buffer
  }

  declare class MerkleTree {
    // this is a partial declaration of the interface
    crypto: HypercoreCrypto
    fork: number
    hash (): Buffer
    signedBy (key: Buffer): boolean
    get (seq: number, error = true): Promise<MerkleTreeNode>
    getRoots (seq: number): Promise<MerkleTreeNode[]>
  }

  declare class InnerHypercore {
    // this is a partial declaration of the interface
    tree: MerkleTree
  }

  declare interface HypercoreConstructorOpts {
    createIfMissing?: boolean
    overwrite?: boolean
    valueEncoding?: any
    encodeBatch?: (batch: any[]) => any[]
    keyPair?: {publicKey: Buffer, secretKey: Buffer}
    encryptionKey?: Buffer
  }

  declare class Hypercore extends EventEmitter {
    key: Buffer
    discoveryKey?: Buffer
    readable: boolean
    writable: boolean
    opened: boolean
    closed: boolean
    opening: Promise<void>
    closing: Promise<void>
    core?: InnerHypercore

    static createProtocolStream (isInitiator: boolean, opts?: any): NoiseSecretStream

    constructor (storage: any, key?: Buffer, opts?: HypercoreConstructorOpts)
    session (opts?: any): Hypercore
    close (): Promise<void>
    replicate (isInitiator: boolean, opts?: any): NoiseSecretStream
    get length (): number
    get byteLength (): number
    get fork (): number
    get peers (): HypercorePeer[]
    get encryptionKey (): Buffer|undefined
    get padding (): number
    ready(): Promise<void>
    setUserData (key: string, value: any): Promise<void>
    getUserData (key: string): Promise<any>
    update(): Promise<void>
    seek (bytes: number): Promise<HypercoreSeekResult>
    has (index: number): Promise<boolean>
    get (index: number, opts?: any): Promise<any>
    createReadStream (opts?: any): ReadStream
    createWriteStream (opts?: any): WriteStream
    download (range: HypercoreRangeOpts): HypercoreRangeResult
    truncate (newLength = 0, fork = -1): Promise<void>
    append (block: any): Promise<any>
    registerExtension (name: string, handlers: HypercoreExtensionHandlers): HypercoreExtension
    sign (signable: Buffer): Buffer
  }

  export = Hypercore
}