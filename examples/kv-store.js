/**
 * Key/Value store with admin
 *
 * This contract is a simple key/value store with an appointed "admin" who can add or remove participants.
 */

import assert from 'assert'
import { index, isWriter } from 'contract'

// database api
// =

export function get ({key}) {
  assert(typeof key === 'string', 'Key must be a string')
  if (!key.startsWith('/')) key = `/${key}`
  return index.get(`/values${key}`)
}

export function list ({prefix}) {
  assert(typeof prefix === 'string', 'Prefix must be a string')
  if (!prefix.startsWith('/')) prefix = `/${prefix}`
  return index.list(`/values${prefix}`)
}

export function put ({key, value}, emit) {
  assert(isWriter, 'Must be a writer')
  assert(typeof key === 'string', 'Key must be a string')
  assert(typeof value !== 'undefined', 'Value cannot be undefined')
  emit({op: 'PUT', key, value})
}

export function del ({key}, emit) {
  assert(isWriter, 'Must be a writer')
  assert(typeof key === 'string', 'Key must be a string')
  emit({op: 'DEL', key, value})
}

export function getAdmin () {
  return index.get('/admin')
}

export function setAdmin ({pubkey}, emit) {
  assert(isWriter, 'Must be a writer')
  assert(typeof pubkey === 'string', 'Pubkey must be a string')
  assert(pubkey.length === 64, 'Pubkey must be 64 characters long')
  emit({op: 'SET_ADMIN', pubkey})
}

export function addParticipant ({pubkey}, emit) {
  assert(isWriter, 'Must be a writer')
  assert(typeof pubkey === 'string', 'Pubkey must be a string')
  assert(pubkey.length === 64, 'Pubkey must be 64 characters long')
  emit({op: 'ADD_PARTICIPANT', pubkey})
}

export function removeParticipant ({pubkey}, emit) {
  assert(isWriter, 'Must be a writer')
  assert(typeof pubkey === 'string', 'Pubkey must be a string')
  assert(pubkey.length === 64, 'Pubkey must be 64 characters long')
  emit({op: 'REMOVE_PARTICIPANT', pubkey})
}

// transaction handler
// =

export const apply = {
  PUT (tx, op) {
    assert(typeof op.key === 'string')
    assert(typeof op.value !== 'undefined')
    if (!op.key.startsWith('/')) op.key = `/${op.key}`
    tx.put(`/values${op.key}`, op.value)
  },

  DEL (tx, op) {
    assert(typeof op.key === 'string')
    if (!op.key.startsWith('/')) op.key = `/${op.key}`
    tx.delete(`/values${op.key}`)
  },

  async SET_ADMIN (tx, op, ack) {
    assert(typeof op.pubkey === 'string', 'Pubkey must be a string')
    assert(op.pubkey.length === 64, 'Pubkey must be 64 characters long')
    const adminEntry = await index.get('/admin')
    assert(!adminEntry || adminEntry.value.pubkey === ack.origin, 'Must be the admin to set the admin')
    tx.put('/admin', {pubkey: op.pubkey})
  },

  async ADD_PARTICIPANT (tx, op, ack) {
    assert(typeof op.pubkey === 'string', 'Pubkey must be a string')
    assert(op.pubkey.length === 64, 'Pubkey must be 64 characters long')
    const adminEntry = await index.get('/admin')
    assert(adminEntry?.value.pubkey === ack.origin, 'Must be the admin to modify participants')
    tx.addOplog({pubkey: op.pubkey})
  },

  async REMOVE_PARTICIPANT (tx, op, ack) {
    assert(typeof op.pubkey === 'string', 'Pubkey must be a string')
    assert(op.pubkey.length === 64, 'Pubkey must be 64 characters long')
    const adminEntry = await index.get('/admin')
    assert(adminEntry?.value.pubkey === ack.origin, 'Must be the admin to modify participants')
    tx.removeOplog({pubkey: op.pubkey})
  }
}