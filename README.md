# Vitra

**⚠️Vitra is a work in progress and is currently a proof-of-concept. Do not use it in production.⚠️**

A framework for cooperatively-owned databases using smart contracts. [Read the white paper](https://github.com/pfrazee/vitra/blob/master/docs/whitepaper.md).

*"Vitra" is latin for "Glass."*

## Overview

Vitra could be described as a hybrid of blockchains and traditional databases. It takes inspiration from [Certificate Transparency](https://certificate.transparency.dev/) and [Layer 2 Optimistic Rollups](https://ethereum.org/en/developers/docs/scaling/layer-2-rollups/) to create a hosted smart-contract protocol called ["Execution Transparency (ET)."](https://github.com/pfrazee/vitra/blob/master/docs/whitepaper.md)

Vitra databases use [verifiable logs](https://transparency.dev/verifiable-data-structures) to record all transactions in a publicly-auditable structure. A contract written in Javascript then enforces the schemas and business logic of the database. By replaying the logs, users can audit the execution of the database and ensure that each participant is playing by the rules. Vitra also responds to every transaction with an inclusion proof, giving end-users an efficient solution to proving their data in the database.

Vitra's goal is to enable multiple orgs to share ownership and operation of a database. A federated network could use Vitra to share user registries, data schemas, or data indexes. Vitra ensures that each org follows the contract of the database, enabling resource limits, multi-party votes, ownership policies, and more.

Vitra uses the [Hypercore Protocol](https://hypercore-protocol.org) to implement its verifiable logs.

## TODO

- [ ] API details & various tasks
  - [ ] Flows for creating oplogs
  - [ ] Networking
- [ ] Implement developer APIs
  - [ ] Debugging information for contract-definition issues
  - [ ] Testing sandbox for debugging changes to an active 
- [ ] Edge-case protocols
  - [ ] Source-code rollback protocol for handling bad deployments
- [ ] Documentation
  - [ ] Overview
  - [ ] Basic usage
  - [ ] Examples
  - [ ] Technical description
  - [ ] Complete the white paper
- [ ] Create CLI

## DONE

- [x] Implement initialization
- [x] Implement transactions
  - [x] API calls
  - [x] Op execution
- [x] Implement verification
  - [x] Append-only constraint violation detection
  - [x] Log replay
- [x] Implement compact (shareable) proof generation
  - [x] Operation inclusion proofs
  - [x] Fraud proofs
    - [x] Append-only violations
    - [x] Contract violations
- [x] Implement monitoring
- [x] Additional tests
  - [x] Participant changes
  - [x] Contract changes

## Example usage

The following contract creates a shared key/value database. Multiple orgs may participate in operating the database, but one participant is designated the "admin" and given control over the other participants.

```js
import assert from 'assert'
import { index, isWriter } from 'contract'

// database api
// =

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
  emit({op: 'DEL', key, value})
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

export function addParticipant ({pubkey}, emit) {
  assert(isWriter)
  assert(typeof pubkey === 'string')
  assert(pubkey.length === 64)
  emit({op: 'ADD_PARTICIPANT', pubkey})
}

export function removeParticipant ({pubkey}, emit) {
  assert(isWriter)
  assert(typeof pubkey === 'string')
  assert(pubkey.length === 64)
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

  SET_ADMIN (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(!adminEntry || adminEntry.pubkey === ack.origin)
    tx.put('/admin', {pubkey: op.pubkey})
  },

  ADD_PARTICIPANT (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(adminEntry?.pubkey === ack.origin)
    tx.addOplog(op.pubkey)
  },

  REMOVE_PARTICIPANT (tx, op) {
    assert(typeof op.pubkey === 'string')
    assert(op.pubkey.length === 64)
    const adminEntry = await state.get('/admin')
    assert(adminEntry?.pubkey === ack.origin)
    tx.removeOplog(op.pubkey)
  }
}
```

This contract is then instantiated as a new database using the Vitra API:

```js
import { Database } from 'vitra'

const db = await Database.create('./db-storage-path', {
  contract: {source: MY_CONTRACT}
})
db.swarm() // share on the hypercore network
console.log('New database created, public key:', db.pubkey.toString('hex'))

// set myself as the admin
await db.call('setAdmin', {pubkey: db.myOplog.pubkey.toString('hex')})

// set a value
const tx = await db.call('put', {key: 'hello', value: 'world'})
await tx.verifyInclusion() // validate the proofs for this transaction
await tx.whenProcessed() // wait for the transaction to process

// get a value
const tx2 = await db.call('get', {key: 'hello'})
tx.response // => 'world'
```

## Future improvements

### Transaction-result inclusion proofs

Calls to a contract (transactions) may produce one or more operations, and each operation may produce one or more changes (results). Operations are published by the contract participants by writing to their "oplogs," while the operation results are always published by the executor in the "index log." Using Hypercore, we're able to generate inclusion proofs for any log message. 

Inclusion proofs are comprised of a log message's sequence number, the root hash of the log's merkle tree, and a signature over the root hash by the log's keypair. We can use the inclusion proof to independently verify that a log message was published by a log, and to prove mischief if the log owner ever attempts to unpublish a message.

Vitra can easily generate an inclusion proof for *operations* when handling a transaction because there's a local interactive session with the participant that's executing the transaction. For the *results* published to the index log, there's no guarantee of an interactive session as the participant may not be the executor. The Hypercore protocol has mechanisms for requesting log inclusion proofs over a connection (this is fundamental to the protocol) but the implementation embeds this in the replication logic and does not currently include APIs to fetch proofs for random messages in a log. By adding those APIs to Hypercore, we can add transaction-result inclusion proofs to Vitra's API.

### Additional append-only fraud proof detection

Violations to the append-only constraint are currently detected when verifying an inclusion proof. It is possible to detect append-only violations more aggressively by checking for them during replication. (In this framework, forking explicitly with Hypercore's truncate() API and forking implicitly with split logs are both considered violations.)

### Native-code contract runtime

Currenly Vitra is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the Confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.

### ZK-SNARKs

Vitra uses transaction logs and log-replays to audit execution of a database. Novel research in Layer 2 rollups has recently focused on using zero-knowledge proofs to create a more compact and efficient approach to auditing (ZK-Rollups). It should be possible to apply the same research to Vitra.