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
- [ ] Implement verification
  - [ ] Append-only constraint violation detection
  - [ ] Inclusion proofs for
    - [x] Ops
    - [ ] Transactions
    - [ ] Transaction results
  - [x] Log replay
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

### Native-code contract runtime

Currenly ITO is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the Confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.