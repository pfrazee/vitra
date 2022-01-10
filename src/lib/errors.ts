export class InvalidBlockInclusionProofError extends Error {
  name: string
  constructor (message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class BlocksNotAvailableError extends Error {
  name: string
  constructor (public logPubkey: Buffer, public neededSeq: number, public availableSeq: number) {
    super(`Not enough blocks have been synced to verify inclusion. Needed: ${neededSeq}. Available: ${availableSeq}. Log: ${logPubkey.toString('hex')}`)
    this.name = this.constructor.name
  }
}