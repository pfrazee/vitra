import { ItoContract } from './contract.js'
import { ItoOperation } from './op.js'

export class ItoTransaction {
  constructor (public contract: ItoContract, public response: any, public ops: ItoOperation[]) {
  }

  async verifyInclusion () {
    await Promise.all(this.ops.map(op => op.verifyInclusion()))
  }

  async isApplied () {
    throw new Error('TODO')
  }

  async whenApplied (): Promise<void> {
    throw new Error('TODO')
  }
}
