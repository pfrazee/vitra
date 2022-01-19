# Implementation specs

- Contracts are strongly isolated in virtual machines and do not share resources
- Every contract is bound to a hypercore (the index log)
- Every contract has a public key (the index log key)
- Contract code is published on the index log
- If you know the public key of a contract you can access it
- A contract "instance" is created locally when the contract is accessed
- Each contract instance may have an oplog

Contracts are instantiated on any device that's interested in accessing it. This means there's always a "local instance" of the contract running. Contracts export an API for external interaction.

> ℹ️ It is possible to examine the datacores of contracts without instantiating the contract, but this is not the default behavior.

In addition to the contract's index core, each instance may or may not have an oplog core. All state-mutations are appended as operations to the local instance's oplog core. A required function, `apply()`, is then called to handle each oplog cores' operations and update the index core's state. 

The contract instance that owns the index core is known as the "executor." Contract instances that own oplog cores are known as "participants." 

## Glossary

|Name|Description|
|-|-|
|Contract|A program executed using the ITO framework. This term may refer to only the code or to the code and all the state and participants.|
|Contract code|The source code defining the contract.|
|Log|An append-only listing of messages. Sometimes called a Hypercore or "core" due to the technology ITO is implemented upon.|
|Oplog|A log which produces operations to be executed by the contract.|
|Index log|The log which represents the current state of the contract which are the results of processed operations.|
|Executor|The party responsible for executing the contract.|
|Participant|Any party with an oplog declared in the contract.|
|Monitor|Any party who chooses to validate the contract's execution.|
|Operation|Any message published on an oplog. Will be processed by the executor.|
|Transaction|A collection of operations and resulting changes to the index which result from a call to the contract.|
|Full verification|Conduct a full audit of the contract's execution.|
|Transaction verification|Audit the execution of an individual transaction.|
|Proof|An independently-verifiable assertion of some contract state.|
|Inclusion proof|A proof that some state (e.g. an operation) was processed by the contract.|
|Fraud proof|A proof that the executor or a participant in a contract has violated some invariant.|

## Index layout (output log)

The output log has a set of fixed entries:

|Key|Usage|
|-|-|
|`.sys/contract/source`|The source code of the contract|
|`.sys/inputs/{pubkey-hex}`|Declarations of oplogs|
|`.sys/acks/{pubkey-hex}/{seq}`|Acknowledgements of processed ops|

Entries under `.sys/acks/` can not be modified by the contract.

> ℹ️ Acks are stored in the output logs to ensure atomicity of transaction-handling.

## Encodings

- Oplog values: messagepack.
- Output index keys: utf8 with a `\x00` separator.
- Output index values: messagepack.

## Flows

### Initialization flow (executor)

The executor host initializes a contract with the following steps:

- The index is created.
- The Hyperbee header is written to the index log. (block 0)
- The `.sys/contract/source` entry is written to the index log with the source code of the contract. (block 1)
- Any number of `.sys/inputs/{key}` entries may be written.
- An empty entry is written at `.sys/acks/genesis` indicating that initialization is complete and that all further entries will be dictated by the contract.

### Operation processing flow (executor)

The executor host watches all active oplogs for new entries and enters the following flow as each entry is detected:

- Place the vm in "restricted mode."
- If the contract exports a `process()` function
  - Call `process(op)` and retain the returned metadata.
- Create a new `ack` object which includes:
  - The oplog pubkey.
  - The op sequence number.
  - The root hash of the oplog.
  - A local timestamp.
  - Metadata returned by `process()`.
- Call `apply()` with the following arguments:
  - `tx` An object with `put(key, value)` and `del(key)` operations for queueing updates to the index.
  - `op` The operation.
  - `ack` The generated ack.
- If the `apply()` call:
  - Returns a resolved promise
    - Set `ack.success` to true
  - Returns a rejected promise
    - Set `ack.success` to false
    - Set `ack.error` to a string (the message of the error)
    - Empty the `tx` queue of actions
- Place the vm in "unrestricted mode."
- Prepend the `ack` entry to the `tx` with a path of `.sys/acks/{oplog-pubkey-hex}/{seq}`.
- Atomically apply the queued actions in `tx` to the index.
- Iterate the actions in `tx` using offset `i`:
  - If the `tx[i]` key is `.sys/contract/source`:
    - Replace the active VM with the value of `tx[i]`.
  - If the `tx[i]` key is prefixed by `.sys/input/`:
    - If the `tx[i]` action is `put`:
      - Add the encoded oplog to the active oplogs.
    - If the `tx[i]` action is `delete`:
      - Remove the encoded oplog from the active oplogs.

### Transaction flow (participant)

> ℹ️ A "transaction" is an API call on the contract, including reads. Every transaction returns an inclusion proof called a "transaction proof" or "tx proof." See the `ContractTransaction` API for information about what each tx proof includes.

The transaction flow is divided into "creation" and "receiving" as time may pass between the initial op-generating call and result processing by the executor.

**Creating the transaction**

- Sync the index head from the network.
- Initialize the contract VM with the current contract source.
- Capture the index root proof as `indexProof`.
- Call the specified contract method.
- Respond with the following information:
  - Was the call successful?
  - The response or error returned by the call.
  - `indexProof`
  - An array of all operations generated, including:
    - The oplog root proof.
    - The operation value.

**Receiving transaction result**

- Iterate each operation generated by the transaction as `op`:
  - Await the matching ack in the index.
  - Fetch the matching ack as `ack`.
  - Fetch all mutations to the index matching `ack` as `mutations`.
  - Fetch the index root proof at the seq of the `ack` as `indexProof`.
  - Respond with the following information:
    - `op`
    - `ack`
    - `mutations`
    - `indexProof`

### Full verification flow (monitor)

> ℹ️ Verification occurs by iterating the index's log and comparing published tx-results against generated tx-results. All transactions are preceded by an ack entry, so the majority of the flow is looking for acks at expected places, comparing all updates that result from the message indicated by the ack, and then skipping forward.

The monitor host verifies a contract using the following flow:

**Verify Initialization Entries**

- Verify that `idxLog[0]` is a valid Hyperbee header.
- Read contract source from `idxLog[1]` and instantiate the VM with it.
- Place the vm in "restricted mode."
- Create a map `processedSeqs` to for each active oplog with each entry initialized at `-1`.
- Set `idxSeq` to `2`
- While `idxSeq < idxLog.length`:
  - If `idxLog[idxSeq]` key is `.sys/ack/0`, exit while loop.
  - If `idxLog[idxSeq]` key is not `.sys/inputs/{key}`, fail verification.
  - Increment `idxSeq`
- Increment `idxSeq`

**Verify Execution Entries**

- While `idxSeq < idxLog.length`:
  - Set `ack` to `idxLog[idxSeq]`
  - If `ack` key does not match `.sys/ack/{pubkey}/{seq}`, fail verification.
  - If `ack` write-type is not `put`, fail verification.
  - If the `{seq}` segment of the key does not equal `processedSeqs[pubkey] + 1`, fail verification.
  - Fetch the `op` from the oplog specified by the `ack` value.
  - Rewind VM `index` state to `idxSeq`.
  - Call `apply()` with the following arguments:
    - `tx` An object with `put(key, value)` and `del(key)` operations for queueing updates to the index.
    - `op` The operation.
    - `ack` The `ack` value.
  - Set `newContractSource` to `null`.
  - Set `oplogChanges` to an empty array.
  - Iterate the actions in `tx` using offset `i`:
    - If the `tx[i]` type does not equal the `idxLog[idxSeq + i]` type, fail verification.
    - If the `tx[i]` key does not equal the `idxLog[idxSeq + i]` key, fail verification.
    - If the `tx[i]` value does not equal the `idxLog[idxSeq + i]` value, fail verification.
    - If the `tx[i]` key is `.sys/contract/source`, set `newContractSource` to the `tx[i]` value.
    - If the `tx[i]` key matches `.sys/inputs/{pubkey}`, add the value to `oplogChanges`.
  - Set `processedSeqs[pubkey]` to the `{seq}` segment of the `ack` key.
  - Increment `idxLogSeq` by `tx.length + 1`.
  - If `newContractSource` is not `null`:
    - Replace the active VM with `newContractSource`
  - Iterate each entry in `oplogChanges`:
    - Add or remove oplogs according to the encoded change.

### Transaction verification flow (monitor)

TODO