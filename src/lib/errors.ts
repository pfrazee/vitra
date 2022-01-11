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

export class ContractParseError extends Error {
  name: string
  constructor (public parseErrorName: string, public parseErrorMessage: string) {
    super(`The contract failed to compile with "${parseErrorName}: ${parseErrorMessage}"`)
    this.name = this.constructor.name
  }
}

export class ContractRuntimeError extends Error {
  name: string
  constructor (public runtimeErrorName: string, public runtimeErrorMessage: string) {
    super(`The contract failed to execute with "${runtimeErrorName}: ${runtimeErrorMessage}"`)
    this.name = this.constructor.name
  }

  static isa (name: string) {
    return ['ReferenceError', 'InternalError', 'RangeError'].includes(name)
  }
}