declare module 'hypercore-crypto' {
  export declare interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }
  export declare interface MerkleTreeNode {
    index: number
    size: number
    hash: Buffer
  }
  export function keyPair (): KeyPair
  export function validateKeyPair (kp: KeyPair): boolean
  export function sign (message: Buffer, secretKey: Buffer): Buffer
  export function verify (message: Buffer, signature: Buffer, publicKey: Buffer): boolean
  export function data (data: Buffer): Buffer
  export function parent (a: Buffer, b: Buffer): Buffer
  export function tree (roots: MerkleTreeNode, out?: Buffer): Buffer
  export function randomBytes (n: number): Buffer
  export function discoveryKey (publicKey: Buffer): Buffer
  export function free (secureBuf: Buffer): void
}