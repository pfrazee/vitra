import { ItoOpLog } from './log.js'
import { ItoLogInclusionProof, ItoAck } from '../types.js'

export class ItoOperation {
  constructor (public oplog: ItoOpLog, public proof: ItoLogInclusionProof, public value: any) {
  }

  async verifyInclusion () {
    await this.oplog.verifyBlockInclusionProof(this.proof)
  }
}