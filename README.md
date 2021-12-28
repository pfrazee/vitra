# In The Open (ITO)

*Work in progress*

A blockchain-free smart contract runtime using secure ledgers. [Read the white paper](./docs/whitepaper.md).

## TODO

- [x] Create a d.ts for confine
  - [x] Update the readme too
  - [x] Publish
- [x] Create ito-confine-runtime
  - [x] Process-local globals
  - [x] Restricted mode
  - [x] Add configure() to confine
- [x] Create a d.ts for Hypercore & Hyperbee
- [ ] Implement initialization
- [x] Implement transactions
  - [x] API calls
  - [x] Op execution
- [ ] Implement verification
  - [ ] Append-only constraint violation detection
  - [ ] Inclusion proofs for
    - [x] Ops
    - [ ] Transactions
    - [ ] Transaction results
  - [ ] Log replay
- [ ] Implement monitoring
- [ ] Additional tests
  - [ ] Participant changes
  - [ ] Contract changes
- [ ] Create CLI

## High-level description

Contracts are instantiated on any device that's interested in accessing it. This means there's always a "local instance" of the contract running. Contracts export an API for external interaction.

> ℹ️ It is possible to examine the datacores of contracts without instantiating the contract, but this is not the default behavior.

In addition to the contract's output core, each instance may or may not have an input core. All state-mutations are appended as operations to the local instance's input core. A required function, `apply()`, is then called to handle each input cores' operations and update the output core's state. 

The contract instance that owns the output core is known as the "executor." Contract instances that own input cores are known as "participants." 

It's possible for contracts to call other contracts' APIs if they know the output core's public key. These calls only route to the local instances; any kind of messaging over the network is not allowed. The host environment for contracts may choose how to expose the contracts to outside systems. A simple example is an HTTP gateway which binds a contract to some domain and translates JSON-RPC calls to the contract.

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

export function apply (tx, op, ack) {
  if (op.op === 'PUT') {
    assert(typeof op.key === 'string' && key.length > 0)
    tx.put(op.key, op.value)
  }
}

/**
 * alternatively:
 * 
 * export const apply = {
 *   PUT (tx, op, ack) {
 *     assert(typeof op.key === 'string' && key.length > 0)
 *     tx.put(op.key, op.value)
 *   }
 * }
 */
```

## Future improvements

### Native-code contract runtime

Currenly ITO is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the Confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.