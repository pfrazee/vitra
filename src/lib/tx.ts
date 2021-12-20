import { ItoOperation } from './op.js'

export class ItoTransaction {
  public ops: ItoOperation[] = []

  async proveInclusion () {
    throw new Error('TODO')
  }

  async isApplied () {
    throw new Error('TODO')
  }

  async getResult (opIdx: number): Promise<ItoTransactionResult> {
    throw new Error('TODO')
  }

  async getResults (): Promise<ItoTransactionResult[]> {
    throw new Error('TODO')
  }
}

export class ItoTransactionResult {
  async proveInclusion () {
    throw new Error('TODO')
  }
}