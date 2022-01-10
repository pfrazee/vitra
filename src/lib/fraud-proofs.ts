import assert from 'assert'
import util from 'util'
import { BlockInclusionProof } from './inclusion-proofs.js'

export class FraudProof extends Error {
  name: string
  constructor (message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class LogForkFraudProof extends FraudProof {
  constructor (public logPubkey: Buffer, public forkNumber: number, public blockSeq: number, public rootHashAtBlock: Buffer, public rootHashSignature: Buffer) {
    super('The log created a fork using the truncate() API, which is not allowed in the union protocol')
  }

  [util.inspect.custom] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  The log created a fork using the truncate() API, which is not allowed in the union protocol.\n' +
      indent + '  logPubkey: ' + opts.stylize(this.logPubkey.toString('hex'), 'string') + '\n' +
      indent + '  forkNumber: ' + opts.stylize(this.forkNumber, 'number') + '\n' +
      indent + '  blockSeq: ' + opts.stylize(this.blockSeq, 'number') + '\n' +
      indent + '  rootHashAtBlock: ' + opts.stylize(this.rootHashAtBlock.toString('hex'), 'string') + '\n' +
      indent + '  rootHashSignature: ' + opts.stylize(this.rootHashSignature.toString('hex'), 'string') + '\n' +
      indent + ')'
  }

  toJSON () {
    return {
      vitraLogForkFraudProof: 1,
      logPubkey: this.logPubkey.toString('hex'), 
      forkNumber: this.forkNumber,
      blockSeq: this.blockSeq, 
      rootHashAtBlock: this.rootHashAtBlock.toString('hex'), 
      rootHashSignature: this.rootHashSignature.toString('hex')
    }
  }

  static fromJSON (obj: any): LogForkFraudProof {
    assert(obj.vitraLogForkFraudProof >= 1, 'Invalid schema version')
    assert(typeof obj.logPubkey === 'string' && obj.logPubkey.length === 64, 'Invalid logPubkey')
    assert(typeof obj.forkNumber === 'number', 'Invalid forkNumber')
    assert(typeof obj.blockSeq === 'number', 'Invalid blockSeq')
    assert(typeof obj.rootHashAtBlock === 'string', 'Invalid rootHashAtBlock')
    assert(typeof obj.rootHashSignature === 'string', 'Invalid rootHashSignature')
    return new LogForkFraudProof(
      Buffer.from(obj.logPubkey, 'hex'),
      obj.forkNumber,
      obj.blockSeq,
      Buffer.from(obj.rootHashAtBlock, 'hex'),
      Buffer.from(obj.rootHashSignature, 'hex')
    )
  }
}

export class BlockRewriteFraudProof extends FraudProof {
  constructor (message: string, public givenInclusionProof: BlockInclusionProof, public violatingInclusionProof: BlockInclusionProof) {
    super(message || 'Conflicting inclusion proofs indicate that the log unpublished a message after publishing it')
  }

  [util.inspect.custom] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  Conflicting inclusion proofs indicate that the log unpublished a message after publishing it.',
      indent + '  description: ' + opts.stylize(this.message, 'string') + '\n' +
      indent + '  givenInclusionProof: ' + this.givenInclusionProof[util.inspect.custom](0, Object.assign({}, opts, {indentationLvl: (opts.indentationLvl||0) + 2})) + '\n' +
      indent + '  violatingInclusionProof: ' + this.violatingInclusionProof[util.inspect.custom](0, Object.assign({}, opts, {indentationLvl: (opts.indentationLvl||0) + 2})) + '\n' +
      indent + ')'
  }

  toJSON () {
    return {
      vitraBlockInclusionFraudProof: 1,
      description: this.message,
      givenInclusionProof: this.givenInclusionProof.toJSON(),
      violatingInclusionProof: this.violatingInclusionProof.toJSON(),
    }
  }

  static fromJSON (obj: any): BlockRewriteFraudProof {
    assert(obj.vitraBlockInclusionFraudProof >= 1, 'Invalid schema version')
    return new BlockRewriteFraudProof(
      obj.description && typeof obj.description === 'string' ? obj.description : '',
      BlockInclusionProof.fromJSON(obj.givenInclusionProof),
      BlockInclusionProof.fromJSON(obj.violatingInclusionProof)
    )
  }
}

export class ContractFraudProof extends FraudProof {
  constructor (public indexStateProof: BlockInclusionProof, public details: ContractFraudProofDetails) {
    super('The executor has violated the contract.')
  }

  [util.inspect.custom] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  The executor has violated the contract.\n' +
      indent + '  indexStateProof: ' + this.indexStateProof[util.inspect.custom](depth, Object.assign({}, opts, {indentationLvl: (opts.indentationLvl||0) + 2})) + '\n' +
      indent + '  details: ' + this.details[util.inspect.custom](depth, Object.assign({}, opts, {indentationLvl: (opts.indentationLvl||0) + 2})) + '\n' +
      indent + ')'
  }

  toJSON () {
    return {
      vitraContractFraudProof: 1,
      indexStateProof: this.indexStateProof.toJSON(),
      details: this.details
    }
  }

  static fromJSON (obj: any): ContractFraudProof {
    assert(obj.vitraContractFraudProof >= 1, 'Invalid schema version')
    assert(typeof obj.details?.description === 'string', 'Invalid details.description')
    return new ContractFraudProof(
      BlockInclusionProof.fromJSON(obj.indexStateProof),
      new ContractFraudProofDetails(obj.details.description, obj.details.details, obj.details.code)
    )
  }
}

export class ContractFraudProofDetails {
  code: string
  constructor (public description: string, public data?: any, code?: string) {
    this.code = code || this.constructor.name
  }

  [util.inspect.custom] (depth: number, opts: {indentationLvl: number, stylize: Function}) {
    let indent = ''
    if (opts.indentationLvl) {
      while (indent.length < opts.indentationLvl) indent += ' '
    }
    return this.constructor.name + '(\n' +
      indent + '  description: ' +  opts.stylize(this.description, 'string') + '\n' +
      indent + '  data: ' + util.inspect(this.data || {}) + '\n' +
      indent + ')'
  }
}