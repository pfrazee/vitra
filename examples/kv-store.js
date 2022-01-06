/**
 * Key/Value store with admin
 *
 * This contract is a simple key/value store with an appointed "admin" who can add or remove participants.
 */

import assert from 'assert'
import { index, isWriter } from 'contract'

export function get ({key}) {
  assert(typeof key === 'string')
  if (!key.startsWith('/')) key = `/${key}`
  return index.get(`/values${key}`)
}

export function list ({prefix}) {
  assert(typeof prefix === 'string')
  if (!prefix.startsWith('/')) prefix = `/${prefix}`
  return index.list(`/values${prefix}`)
}

export function put ({key, value}, emit) {
  assert(isWriter)
  assert(typeof key === 'string')
  assert(typeof value !== 'undefined')
  emit({op: 'PUT', key, value})
}

export function del ({key}, emit) {
  assert(isWriter)
  assert(typeof key === 'string')
  emit({op: 'DELETE', key, value})
}

export function getAdmin () {
  return index.get('/admin')
}

export function setAdmin ({pubkey}, emit) {
  assert(isWriter)
  assert(typeof pubkey === 'string')
  assert(pubkey.length === 64)
  emit({op: 'SET_ADMIN', pubkey})
}

export function addMember ({pubkey}, emit) {
  assert(isWriter)
  assert(typeof pubkey === 'string')
  assert(pubkey.length === 64)
  emit({op: 'ADD_MEMBER', pubkey})
}

export function removeMember ({pubkey}, emit) {
  assert(isWriter)
  assert(typeof pubkey === 'string')
  assert(pubkey.length === 64)
  emit({op: 'REMOVE_MEMBER', pubkey})
}

export const apply = {
  PUT (tx, op) {
    assert(typeof op.key === 'string')
    assert(typeof op.value !== 'undefined')
    if (!op.key.startsWith('/')) op.key = `/${op.key}`
    tx.put(`/values${op.key}`, op.value)
  },

  DELETE (tx, op) {
    assert(typeof op.key === 'string')
    if (!op.key.startsWith('/')) op.key = `/${op.key}`
    tx.delete(`/values${op.key}`)
  },

  SET_ADMIN (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(!adminEntry || adminEntry.pubkey === ack.origin)
    tx.put('/admin', {pubkey: op.pubkey})
  },

  ADD_MEMBER (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(adminEntry?.pubkey === ack.origin)
    tx.addOplog(op.pubkey)
  },

  REMOVE_MEMBER (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(adminEntry?.pubkey === ack.origin)
    tx.removeOplog(op.pubkey)
  }
}