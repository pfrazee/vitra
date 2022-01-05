export const CONTRACT_SOURCE_PATH = '/.sys/contract/source'
export const PARTICIPANT_PATH_PREFIX = '/.sys/inputs/'
export const genParticipantPath = (id: number) => `${PARTICIPANT_PATH_PREFIX}${id}`
export const ACK_PATH_PREFIX = '/.sys/acks/'
export const GENESIS_ACK_PATH = '/.sys/acks/genesis'
export const genAckPath = (id: number, seq: number) => `${ACK_PATH_PREFIX}${id}:${seq}`

export interface ItoSchemaInput {
  pubkey: Buffer
  active: boolean
}