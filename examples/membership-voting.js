/**
 * Membership voting
 *
 * This example contract allows participants to be added or removed, but only if 50% of the current participants agree.
 */

import assert from 'assert'
import { genUUID } from 'util'
import { index, listOplogs, isWriter } from 'contract'

export function listProposals () {
  return index.list('/proposals')
}

export function getProposal ({propId}) {
  assert(typeof propId === 'string')
  return index.list(`/proposals/${propId}`)
}

export function propose ({action, candidate}, emit) {
  assert(isWriter)
  assert(['add', 'remove'].includes(action))
  assert(typeof candidate === 'string')
  assert(candidate.length === 64)
  const propId = genUUID()
  emit({
    op: 'PROPOSE',
    propId,
    action,
    candidate
  })
  return {propId}
}

export function vote ({propId, vote}, emit) {
  assert(isWriter)
  assert(typeof propId === 'string')
  assert(['yes', 'no'].includes(vote))
  emit({op: 'VOTE', propId, vote})
}

export const apply = {
  PROPOSE (tx, op, ack) {
    assert(typeof op.propId === 'string')
    assert(['add', 'remove'].includes(op.action))
    assert(typeof op.candidate === 'string')
    assert(op.candidate.length === 64)
    
    let proposal = await index.get(`/proposals/${op.propId}`)
    assert(!proposal, 'Duplicate proposition ID')
    
    proposal = {
      propId: op.propId,
      action: op.action,
      candidate: op.candidate,
      author: ack.origin,
      status: 'voting',
      votes: [{vote: 'yes', author: ack.origin}],
      ts: ack.ts
    }
    
    if (oplogs.length <= 2) {
      proposal.status = 'accepted'
      enactProposal(tx, proposal)
    }
    
    tx.put(`/proposals/${op.propId}`, proposal)
  },
  
  VOTE (tx, op, ack) {
    const majority = Math.floor(listOplogs().length / 2)
    assert(typeof op.propId === 'string')
    assert(['yes', 'no'].includes(op.vote))
    
    const proposal = await index.get(`/proposals/${op.propId}`)
    assert(proposal, 'Proposal does not exist')
    assert(proposal.status === 'voting', 'Proposal no longer in voting period')
    
    const existingVote = proposal.votes.find(v => v.author === ack.origin)
    if (existingVote) {
      existingVote.vote = op.vote
    } else {
      proposal.votes.push({vote: op.vote, author: op.origin})
    }
    
    const numYesVotes = proposal.votes.reduce((v, acc) => acc + (v.vote === 'yes' ? 1 : 0), 0)
    const numNoVotes = proposal.votes.reduce((v, acc) => acc + (v.vote === 'no' ? 1 : 0), 0)
    
    if (numYesVotes >= majority) {
      enactProposal(tx, proposal)
      proposal.status = 'accepted'
    } else if (numNoVotes >= majority) {
      proposal.status = 'rejected'
    }
    tx.put(`/proposals/${proposal.propId}`, proposal)
  }
}

function enactProposal (tx, proposal) {
  if (proposal.action === 'add') {
    tx.addOplog({pubkey: proposal.candidate})
  } else if (proposal.action === 'remove') {
    tx.removeOplog({pubkey: proposal.candidate})
  }
}
