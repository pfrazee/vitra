# In The Open (ITO)

A hosted smart-contract runtime using secure ledgers. [Read the white paper](./docs/whitepaper.md).

**⚠️Work in progress⚠️**

## TODO

- [x] Create a d.ts for confine
  - [x] Update the readme too
  - [x] Publish
- [x] Create ito-confine-runtime
  - [x] Process-local globals
  - [x] Restricted mode
  - [x] Add configure() to confine
- [x] Create a d.ts for Hypercore & Hyperbee
- [x] Implement initialization
- [x] Implement transactions
  - [x] API calls
  - [x] Op execution
- [ ] API details & various tasks
  - [ ] Flows for creating oplogs
  - [x] Await transaction processing
  - [ ] Networking
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

## Overview

An example contract:

```js
import assert from 'assert'
import { index } from 'contract'

export function get ({key}) {
  assert(typeof key === 'string' && key.length > 0)
  return index.get(key)
}

export function put ({key, value}, emit) {
  assert(typeof key === 'string' && key.length > 0)
  emit({op: 'PUT', key, value})
}

export const apply = {
  PUT (tx, op, ack) {
    assert(typeof op.key === 'string' && op.key.length > 0)
    tx.put(op.key, op.value)
  }
}
```

## Future improvements

### Transaction-result inclusion proofs

Calls to a contract (transactions) may produce one or more operations, and each operation may produce one or more changes (results). Operations are published by the contract participants by writing to their "oplogs," while the operation results are always published by the executor in the "index log." Using Hypercore, we're able to generate inclusion proofs for any log message. 

Inclusion proofs are comprised of a log message's sequence number, the root hash of the log's merkle tree, and a signature over the root hash by the log's keypair. We can use the inclusion proof to independently verify that a log message was published by a log, and to prove mischief if the log owner ever attempts to unpublish a message.

ITO can easily generate an inclusion proof for *operations* when handling a transaction because there's a local interactive session with the participant that's executing the transaction. For the *results* published to the index log, there's no guarantee of an interactive session as the participant may not be the executor. The Hypercore protocol has mechanisms for requesting log inclusion proofs over a connection (this is fundamental to the protocol) but the implementation embeds this in the replication logic and does not currently include APIs to fetch proofs for random messages in a log. By adding those APIs to Hypercore, we can add transaction-result inclusion proofs to ITO's API.

### Additional append-only fraud proof detection

Violations to the append-only constraint are currently detected when verifying an inclusion proof. It is possible to detect append-only violations more aggressively by checking for them during replication. (In this framework, forking explicitly with Hypercore's truncate() API and forking implicitly with split logs are both considered violations.)

### Native-code contract runtime

Currenly ITO is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the Confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.