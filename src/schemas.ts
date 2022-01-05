import { Key, keyToStr } from './types.js'

export const CONTRACT_SOURCE_PATH = '/.sys/contract/source'
export const PARTICIPANT_PATH_PREFIX = '/.sys/inputs/'
export const genParticipantPath = (pubkey: Key) => `${PARTICIPANT_PATH_PREFIX}${keyToStr(pubkey)}`
export const ACK_PATH_PREFIX = '/.sys/acks/'
export const GENESIS_ACK_PATH = '/.sys/acks/genesis'
export const genAckPath = (pubkey: Key, seq: number) => `${ACK_PATH_PREFIX}${keyToStr(pubkey)}/${String(seq).padStart(15, '0')}`

export interface ItoSchemaInput {
  pubkey: Buffer
  executor: boolean
  active: boolean
}