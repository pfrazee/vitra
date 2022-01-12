/**
 * Counter
 *
 * This contract maintains a singe numeric value which can only be incremented. 
 */

import { index } from 'contract'

// database api
// =

export async function get () {
  const entry = await index.get(`/counter`)
  return Number(entry?.value || 0)
}

export function increment (_, emit) {
  emit({op: 'INCREMENT'})
}

// transaction handler
// =
 
export const apply = {
  async INCREMENT (tx, op) {
    const current = await get()
    tx.put(`/counter`, current + 1)
  }
}