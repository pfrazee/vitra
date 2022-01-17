# Vitra

```
██╗   ██╗██╗████████╗██████╗  █████╗
██║   ██║██║╚══██╔══╝██╔══██╗██╔══██╗
██║   ██║██║   ██║   ██████╔╝███████║
╚██╗ ██╔╝██║   ██║   ██╔══██╗██╔══██║
 ╚████╔╝ ██║   ██║   ██║  ██║██║  ██║
  ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
```

Cooperative databases using smart contracts. [Read the white paper](https://github.com/pfrazee/vitra/blob/master/docs/whitepaper.md).

## Introduction

Vitra is a research project for exploring the limits of smart contracts *without* blockchains -- specifically, without using decentralized consensus algorithms like Proof-of-Work or Proof-of-Stake. Its purpose is research and education. Contributors are welcome, but the software is not stable and should not be used in production.

## Overview

Vitra is a hybrid of blockchains and traditional databases. It takes inspiration from [Certificate Transparency](https://certificate.transparency.dev/) and [Layer 2 Optimistic Rollups](https://ethereum.org/en/developers/docs/scaling/layer-2-rollups/) to create a hosted smart-contract protocol called ["Execution Transparency (ET)."](https://github.com/pfrazee/vitra/blob/master/docs/whitepaper.md)

Vitra databases use [verifiable logs](https://transparency.dev/verifiable-data-structures) to record all transactions in a publicly-auditable structure. A contract written in Javascript then enforces the schemas and business logic of the database. By replaying the logs, users can audit the execution of the database and ensure that each participant is playing by the rules. Vitra also responds to every transaction with an inclusion proof, giving end-users an efficient solution to proving their data in the database.

**When is this useful?**

- Public/community services that need to publish very sensitive data, like user encryption-keys or software packages. Vitra gives clear external auditability of every change that occurs, much like Certificate Transparency does for PKI.
- Decentralized organizations where a database needs to be shared among people who don't totally trust each other. The smart contract ensures that the operator of the database can't cheat the community; it effectively protects users from the owners of a service.
- Large multi-org collaborations (think enterprises with multiple vendors) where data-sharing needs to be coordinated and consistent. Vitra protects you from incompetance in the same way it protects you from malice: the system is transparent and self-auditing.

Vitra uses the [Hypercore Protocol](https://hypercore-protocol.org) to implement its verifiable logs.

## Docs

[![Vitra tutorial video](https://img.youtube.com/vi/6lS7FMGzMZk/0.jpg)](https://www.youtube.com/watch?v=6lS7FMGzMZk)

[☝️ Tutorial video ☝️](https://www.youtube.com/watch?v=6lS7FMGzMZk)

- [White paper](./docs/whitepaper.md)
- [Command-line docs](./docs/cli.md)
- [Smart contract API docs](./docs/contract-apis.md)
- [API Reference](https://pfrazee.github.io/vitra/)
- [Example contracts](./examples/)
- Technical docs
  - [Implementation specs](./docs/implementation.md)
  - [VM Runtime](./docs/vm-runtime.md)

## Example

This very simple contract maintains a counter which can only ever increment. The contract exports two calls, `get()` and `increment({amount})`, which we can use to interact with the database.

```js
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

export function increment (opts = {}, emit) {
  const amount = typeof opts?.amount === 'number' ? opts.amount : 1
  emit({op: 'INCREMENT', amount})
}

// transaction handler
// =
 
export const apply = {
  async INCREMENT (tx, op) {
    const current = await get()
    tx.put(`/counter`, current + op.amount)
  }
}
```

You'll notice that transactions are handled in two phases: first publishing an operation with `emit()`, and then applying the operation with `apply.INCREMENT()`. This separation is because Vitra databases may have multiple *participants* who can generate ops, but only one *executor* who can execute the ops. When we verify a contract, we're replaying the emitted operations against the apply functions to make sure the executor has been honest.

Let's create a database using our contract. We'll use the API for this readme, but the interactive CLI is generally much easier.

```js
import { Database } from 'vitra'

// Create the DB
const db = await Database.create('./db-storage-path', {
  contract: {source: COUNTER_CONTRACT}
})
db.swarm() // share on the hypercore network
console.log('New database created, public key:', db.pubkey.toString('hex'))

// Read the current state
const tx1 = await db.call('get', {})
console.log(tx.response) // => 0

// Increment a few times
const tx2 = await db.call('increment', {})
const tx3 = await db.call('increment', {amount: 2})
const tx4 = await db.call('increment', {})

// Wait for those increments to be processed
await Promise.all([tx2.whenProcessed(), tx3.whenProcessed(), tx4.whenProcessed()])

// Read the new state
const tx5 = await db.call('get', {})
console.log(tx.response) // => 4
```

As you can see, Vitra is a programmable database. We're interacting with the DB using the contract's API.

To verify the execution, we can use one of two methods: `verify()` or `monitor()`. The difference is whether we want to persistently verify or not; monitor will watch for new updates and verify them continuously.

```js
await db.verify() // check all current state

const mon = await db.monitor() // persistently monitor transactions
mon.on('violation', console.log)
```

Generally we try *not* to violate a contract; violations are unrecoverable and will require users to switch to an entirely new database. This is on purpose: if a contract has been violated, then your database's executor has either suffered a serious technical issue, or they're trying to defraud you and shouldn't be trusted!

For this example, however, we'll force a violation to see what happens:

```js
await db.index.dangerousBatch([{type: 'put', path: '/counter', value: 1}])

try {
  await db.verify()
} catch (e) {
  console.log(e) // => ContractFraudProof (The executor has violated the contract)
}
```

We just violated the contract by setting the counter back to 1. This particular violation is an unprompted change -- no operation caused this write -- but if the executor had responded to an operation with the wrong changes, or skipped over an operation, or tried to unpublish a change, it would be caught the same way.

## License

Vitra is copyright 2022 Blue Link Labs. We're currently deciding how to license Vitra and have not set a FOSS license yet, though we intend to (sorry!). We're currently considering a less liberal license such as AGPL.

## Future improvements

### Transaction-result inclusion proofs

Calls to a contract (transactions) may produce one or more operations, and each operation may produce one or more changes (results). Operations are published by the contract participants by writing to their "oplogs," while the operation results are always published by the executor in the "index log." Using Hypercore, we're able to generate inclusion proofs for any log message. 

Inclusion proofs are comprised of a log message's sequence number, the root hash of the log's merkle tree, and a signature over the root hash by the log's keypair. We can use the inclusion proof to independently verify that a log message was published by a log, and to prove mischief if the log owner ever attempts to unpublish a message.

Vitra can easily generate an inclusion proof for *operations* when handling a transaction because there's a local interactive session with the participant that's executing the transaction. For the *results* published to the index log, there's no guarantee of an interactive session as the participant may not be the executor. The Hypercore protocol has mechanisms for requesting log inclusion proofs over a connection (this is fundamental to the protocol) but the implementation embeds this in the replication logic and does not currently include APIs to fetch proofs for random messages in a log. By adding those APIs to Hypercore, we can add transaction-result inclusion proofs to Vitra's API.

### Additional append-only fraud proof detection

Violations to the append-only constraint are currently detected when verifying an inclusion proof. It is possible to detect append-only violations more aggressively by checking for them during replication. (In this framework, forking explicitly with Hypercore's truncate() API and forking implicitly with split logs are both considered violations.)

### Native-code contract runtime

Currenly Vitra is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the Confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.

### Edge-case protocols

Vitra is currently designed to follow the contract with no external mutations allowed. This means that operator error could leave a Vitra in an unrecoverable state. We could solve this kind of problem with "edge-case protocols." Some edge-case protocols to consider:

- **Contract rollback**. A broken contract could leave the database in an inoperable state (e.g. a runtime error stops execution). An edge-case protocol for rolling back to a previous version could help solve this.

### ZK-SNARKs

Vitra uses transaction logs and log-replays to audit execution of a database. Novel research in Layer 2 rollups has recently focused on using zero-knowledge proofs to create a more compact and efficient approach to auditing (ZK-Rollups). It should be possible to apply the same research to Vitra.
