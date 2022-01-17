# Low-Trust Networking through Secure, Public Logs

*Draft 2. Not yet final.*

Decentralized networks require open participation. Hostile actors must be assumed in such an environment. To counteract their effects, a decentralized network must be designed defensively.

A common property now used by decentralized networks is "trustlessness". A trustless network constrains the activity of each participant such that good actors are able to transact while bad actors are either quickly detected and stopped or are prevented from executing an attack.

Blockchains rely on Byzantine-Fault-Tolerant consensus, work/stake proofs, and economic incentives to create trustlessness. Their notable downsides include reliance on large networks to provide majority honesty, per-transaction fees, global consensus on all transactions, and wasteful hash mining in PoW schemes. While these details give blockchains their useful properties, the cost and low throughput indicate that they're not suitable for all use-cases.

Blockchains use trust minimization to block the actions of malicious actors. By choosing instead to merely expose malicious actors, we can make a simpler, more efficient system.

In this paper, we present an alternative model for trust minimization called "Execution Transparency" (or ET) which provides low cost, high throughput transactions while maintaining useful security guarantees.

Execution Transparency is a generalization of [Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962) (or CT) a widely-used protocol for TLS certificate issuance. Like CT, Execution Transparency uses publicly auditable, append-only, untrusted logs of all transactions. ET does not stop invalid transactions, but it makes them easily detectable so that third parties may respond. ET's logs ensure that any invalid transaction may be exposed by a third party.

Execution Transparency generalizes Certificate Transparency through programs called "contracts" which are similar to smart contracts in blockchains like Ethereum. Each participant publishes the contract which they are executing along with the secure logs which record their transactions. To ensure correct execution, a third party may replay the logs against the contract in order to verify their validity. If an output generated in the verification process does not match an output published by the executor, a "breach notice" can be published indicating that the executor has violated the contract and should not be trusted.

Execution Transparency binds participants to the behaviors specified in the contract, reducing the amount of trust a participant must be given. We refer to this as "low trust" rather than trustless as the mechanism for counteracting hostile actors is reputational; a breach of contract is not prevented, and so must be handled by reducing trust in the executor.

Execution Transparency has several use-cases. As with Certificate Transparency, it can be used to provide auditable registries of credentials or software packages. As with Smart Contracts, it can be used to enforce multi-party agreements such as voting rules on changes to social software (user governance). Execution Transparency may also provide an effective framework for [Oracles](https://en.wikipedia.org/wiki/Blockchain_oracle) which are reputational by nature.

In the rest of this paper, we will describe the high-level design principles of Execution Transparency along with important security considerations. We highlight the [Hypercore Protocol](https://hypercore-protocol.org) as a framework for implementing Execution Transparency.

## Description

Execution Transparency is a services protocol. Service providers (known as "executors") operate programs (known as "contracts") with third-party auditability. Each executor produces two logs (an "input" and the "output") which represents the execution history. Participants in a contract communicate with the executor using RPC or by providing additional input logs to the contract. Auditors (known as "monitors") validate execution by replaying the input log(s) against the contract and comparing against the published output log.

This paper describes a general framework for Execution Transparency. Implementations may choose from various consistency, networking, and bytecode/runtime models for contract execution so long as key attributes are preserved. Likewise, certain processes for ET are left unspecified (such as the handling of breach notifications) as these can be processed out-of-band.

### Executors

ET services are operated by machines known as "executors." Executors may be one or more device so long as they produce a linearized ordering of transactions.

Malicious behavior (contract breaches) by executors cannot be prevented, but can be detected afterwards by third-party auditing.

### Participants

Users which transact with an ET services are referred to as "participants." Participants may interact with the executor by sending indivial messages over the network (RPC) or by producing logs which are declared as inputs to the service.

Unlike executors, malicious behavior by participants is prevented. Any attempted transaction by a participant which violates the contract will be rejected by the executor.

### Monitors

Any third party which validates an ET contract's logs is known as a "monitor." Monitors do not need a pre-defined relationship with the executor or the contract; any device may sync the logs of an ET contract and verify their correctness.

The processes which monitors follow mimic the executor processes; the key difference is that monitors have no authority to publish updates to the output log. Instead, their job is to watch for breaches by the executor and warn participants if a breach is found.

### Public Auditable Logs

Execution Transparency relies on logs with the following properties:

- **Append-only**. Published messages must only be added; they may not be mutated or deleted.
- **Signed**. All messages must be signed by a keypair which represents the executor or participants (if participants produce their own input logs).

The suggested cryptographic construction of ET logs is similar to that of [Certificate Transparency logs](https://datatracker.ietf.org/doc/html/rfc6962#section-2.1). A Merkle Tree is used to efficiently identify the state of a log at a given point in its history. Signed root hashes may then be compared over a gossip network to ensure equivalent histories; if divergent histories have been published, the signed roots can be used as proofs that the append-only constraint has been violated.

From [RFC 6962, "Certificate Transparency"](https://datatracker.ietf.org/doc/html/rfc6962#section-2.1):

> The append-only property of each log is technically achieved using Merkle Trees, which can be used to show that any particular version of the log is a superset of any particular previous version. Likewise, Merkle Trees avoid the need to blindly trust logs: if a log attempts to show different things to different people, this can be efficiently detected by comparing tree roots and consistency proofs.

The [Hypercore Protocol](https://hypercore-protocol.org) provides a usable construction of signed, append-only logs using these techniques. These logs, known as "Hypercores," are identified using the public key of the keypair which signs all logs. A log-gossiping network is provided in the Hypercore Protocol ([Hyperswarm](https://github.com/hyperswarm)) which includes distributed peer-discovery of Hypercores.

As Hypercores are signed and authenticated against their public-key identifiers, third parties can trustlessly rehost Hypercores. This property enables bandwidth-sharing schemes (as multiple devices may host a Hypercore) and enables trustless rehosting services which ensure availability without compromising the security properties of Hypercores.

### Contract Programs

An ET service consists of 

- one or more input logs,
- one output log, and
- the contract program.

The input logs may represent the contract executor as well as third parties and end-users who are participating in the contract. 

The output log represents the computed results of all transactions.

The contract specifies a pure function known as the "apply" function for deterministically producing the output log from the input log(s). Deterministic execution is a key feature of the apply function; repeated executions of the input logs at any state must result in an equivalent output log.

To achieve a deterministic mapping, the following properties must apply:

- **Purity**. Side-effects such as randomness, timestamps, or external data must not be introduced in the apply function.
- **Reproducable Ordering**. Operations must complete in the same order for each execution. If asynchronous operations are permitted, they must resolve in a consistent order.

Some of these properties may be enforced by the contract runtime (e.g. by providing no `random()` in the ABI). Additionally, any contract with multiple input logs must counteract the variable ordering of each input log as participants are not assumed to maintain linear consistency with each other.

Both of these issues are solved by including an executor input log in every ET contract. The executor input log is responsible for linearizing the order of all input logs by publishing pointers to each message as they are processed. Likewise, the executor input log can capture any non-deterministic data as messages, ensuring reproduceable outputs.

To produce messages in the executor's input log which react to participant messages, a "process" function may be defined in the ET contract. The specifics of the process function depends on the ET implementation; if all participants are expected to transact with the executor using RPC then no process function is needed. If instead participants produce messages through input logs, then a process function is required. If no custom processing is required by a contract then a default implementation could be provided by the executor which simply writes acknowledgement messages (providing linear order).

In addition to the "apply" and "process" functions, an ET contract may export an API which provides higher-level input and output methods. Contract input methods are used by participants to construct valid messages on their input logs. Contract output methods read the output log to produce a view of the contract state.

While the input logs should act as a sequence of operations, the output log may include embedded indexes which enable efficient reads of the contract state. These indexes have been explored heavily in the Hypercore Protocol, including embedded B-Trees ([Hyperbee](https://github.com/hypercore-protocol/hyperbee)) and rolling hash-array mapped tries ([Hypertrie](https://github.com/hypercore-protocol/hypertrie)). Using these indexes, it is possible for the contract output methods to behave as key-value stores or filesystems with efficient sparse synchronization of the output log to achieve reads of the current state.

### Contract Audits

To audit a contract, a monitor must synchronize the full known state of a contract's input logs and output log. The Hypercore Protocol gives no guarantee for latest state; instead, it relies on the gossip network to eventually sync all state. As any party may rehost a Hypercore, it's assumed that at least one fully-synced host will be available.

Auditing does not rely on public operation. Contracts may be executed privately between interested parties so long as each participant is capable of monitoring the logs. It's recommended to use a persistent gossip protocol to sync the logs to multiple third-party monitors as transactions occur, as this will reduce the potential for log rewriting.

Once the input and output logs are synchronized, a monitor validates the contract's execution by replaying the input log(s) against the contract's apply function. The monitor then compares its generated output log against the executor's published output log. If the generated message content is found to differ from the equivalent published message in the output log, the monitor should regard the executor as "in breach." As a contract-breach is reproduceable, the monitor can give notice of the breach by sharing the sequence number of the output log in which the breach occurred.

In addition to contract breaches, monitors must watch for violations of the append-only constraint as described in the "Public Auditable Logs" section. In the event of a contract breach or append-only violation, monitors should contact other participants and take action to resolve the issue. The nature of the breach should be evaluated to determine if the cause was technical (e.g. a bug in the contract) or malicious. The contract or the executor should be replaced accordingly.

## Technical and Security Considerations

### Log Availability

Monitors require access to the full histories of a contract's input and output logs to perform validation. If some part of history is not made available, then validation can not be accomplished. If an executor can not or will not produce the full histories of logs, it may be necessary to regard the executor as untrustworthy.

### Transaction Censorship and Ordering

As ET contracts are operated by a sole-executor, it is possible for a participant's messages to be rejected or ignored without recourse (censorship). In cases where timeliness is a factor, the ability to censor messages may prove harmful.

Likewise, the executor has sole discretion over the order by which messages are processed. As the execution order can have significant effects on the result of a transaction, it is important that participants consider the effects of message ordering on their use-case.

### Contract Sandboxing

A key requirement for the contract runtime is a secure sandbox for executing the untrusted contracts. Interpretted VMs such as Javascript or WASM are recommended, as are OS restrictions on the execution process (seccomp, seatbelt, etc).

### Incentive and Reputation Models

No incentive model for contract execution or monitoring is defined in this paper. Incentives are important in practice but their design is orthogonal to ET's core mechanics and can take many forms, including social altruism within semi-trusted groups or per-transaction payment through cryptocurrencies. Therefore we chose to leave incentive models unspecified in this paper.

No formal reputation model is specified in this paper for similar reasons. Implementators may create automated reputation networks based on honest and dishonest execution, but such a network is not strictly necessary for Execution Transparency as reputation can be managed manually by end-users.

## Use cases

### Registries

Execution Transparency can improve the security of sensitive registries such as user credentials or software packages. Third party monitors can watch updates to the registry to ensure that no unauthorized changes occur, and data distributed by an ET's logs provide a strong guarantee that tampering has not occurred (i.e. by including a modified binary to some requests). These benefits are similar to what Certificate Transparency provides to TLS certificate issuance.

The following examples serve to illustrate key concepts; implementations will likely differ depending on the needs of the use-case.

*Example: Simple public-key registry.* The registry service maintains a mapping of usernames to public keys. A governing contract is specified with the following methods: `get(username)`, `put(username, publicKey)`. Calls to `put()` occur through RPC and authentication is handled off-contract by the service. Participants monitor the output log to ensure no unauthorized key-changes occur.

*Example: Verifier public-key registry.* Expands on the simple public-key registry by requiring verifications of updates by appointed participants. A governing contract is specified with the following methods:

- `init(verifierLogKeys)`
- `get(username)`
- `put(username, publicKey)`
- `verify(username, publicKey)`

Verifiers transact using input logs while non-verifiers transact using RPC to the executor and to the verifiers. Logic within the contract `apply()` dictates that one `verify()` from an "appointed verifier" must follow a `put()` before the updating the username mapping. One or more verifier is declared in the `init()` function which must be the first message in the executor's input log.

Participants update their mapping via RPC by first sending a `put()` to the executor then sending a verification request to a verifier. Participants then monitor the output log to ensure no unauthorized key-changes occur. (The processes for changing the verifier set or for authenticating with the executor and verifiers have been omitted for brevity.)

### User Governance

ET contracts can be used to stipulate multi-party governance over shared resources. For example, an ET contract could include rules for updating the contract itself; these rules would require a majority vote by participants in the contract before the code could be updated. Similar schemes could be used to govern changes to software which is attached to the contract (such as the UI of an application) giving users a say in the development of shared social applications. These approaches can be layered, leveraging multiple contracts with hierarhical authorities to create sophisticated democratic networks which govern software, moderation, and algorithmic changes.

Similar contracts may be applicable to non-computing governance, such as the control of funds or intellectual property within an organization.

*Example: Governed fileset*. The fileset service maintains a collection of files which requires a vote on all changes ("commits"). The contract is created with the following methods:

- `init(voterLogKeys)`
- `listFiles(path)`
- `getFile(path)`
- `listProposals()`
- `proposeCommit(proposalId, files)`
- `acceptCommit(proposalId)`
- `rejectCommit(proposalId)`

All voter participants transact through input logs. New "commit proposals" may be created by any voter with `proposeCommit()`, placing it in the "proposed" state. If a majority of voters publish an `acceptCommit()` message the proposal enters the "accepted" state and the file mapping is updated in the apply function. If a majority publish a `rejectCommit()` message the proposal enters the "rejected" state. Voters can change their vote only if the proposal is in the "proposed" state.

### Oracles

[Oracles](https://en.wikipedia.org/wiki/Blockchain_oracle) are actors who provide information to networks which come from a third party. They might be used to capture pricing information around commodities or stocks, sensor data from IoT devices, web page responses, and more. Critically, Oracles rely on trust in the actor to provide actionable information.

ET contracts could be used to publish Oracle data auditably. Oracle output logs would be referenced by other ET contracts, ideally including the signed root hash of the referenced log-message to ensure authenticity. (The details of using ET oracles feeds in blockchain applications requires future exploration.)

Some ET contract schemes could combine data captures from oracles run by multiple different parties, adding an extra layer of trustworthiness. The contract could decide how to handle disagreement between the oracles according to the application, potentially rejecting disagreements or blending them if appropriate.

*Example: Website capture.* The website capture service would provide a snapshot of the response data from a URL at a regular period. A contract would provide the following functions:

- `init(snapshotterLogKey, url, interval, agreementWindow)`
- `get(timestamp)`
- `put(timestamp, responseData)`

In this example, the snapshotter is a separate participant than the executor† and only the input log of the snapshotter is allowed to execute the `put()` method. Each put call must possess a timestamp which is greater than the previous put's timstamp by the `interval` amount. The executor includes its local timestamp when processing the `put()` and the proposed timestamp must be within `agreementWindow` milliseconds of the exector's local timestamp.

Readers can fetch the snapshot of the contract's target URL at any time by calling the `get()` function, which will round the given timestamp down to the closest available capture.

† Note that the contract provides no way to verify that the executor and the snapshotter are controlled by different parties.

## Future work

### Inter-contract Linking

ET contracts as described in this paper are self-contained; they provide an output log based strictly on the messages of the input logs. It should however be possible for ET contracts to reference data from other contracts using a URL scheme. Depending on the guarantees of the URL scheme, it might be sufficient to encode only the URL so long as there's a strong guarantee the referenced data is accessible and deterministically resolved. Alternatively the contract may choose to embed the referenced data as a captured side-effect.

### Cross-contract RPC

As each contract specifics an API, it is possible that RPC methods -- that is, methods which can be accessed by third parties rather than owners of the input logs -- could be encoded in ET contracts. This can be used to enable contracts to send arbitrary API calls to each other.

Any such scheme is contingent on authentication and spam prevention as a naive approach would inevitably lead to DoS attacks. A future area to explore is the use of reputation networks and payment systems to effectively meter the resource usages of RPC.

### Multi-authority Execution

Execution Transparency relies on a deterministic, linear execution of the contract's transactions. In this paper, we suggest appointing a sole authority (the executor) to ensure these properties. Future work may explore how multiple executors can provide these guarantees. A working multi-executor scheme could be used to mitigate censorship risks and could provide a pathway to breach-resolution without having to replace the contract.

It may be possible to relax the lineariazed consistency constraint of contract inputs to a less strict consistency model such as causal ordering or other forms of eventual consistency. Any relaxation of the consistency model needs to consider how the contract program's semantics will be affected. For instance, causal ordering cannot enforce some invariants in a program's business logic (e.g. "foreign key" constraints).

### Bounded State Growth

As input and output logs are append-only, there is no mechanism for removing historic state. While embedded indexes can counteract the performance costs of state reads on large output logs, executors and monitors must maintain all historic state to correctly execute and audit ET contracts. Future work should explore mechanisms for truncating history without sacrificing the security properties of contracts.


### Transaction Proofs ("tx proofs")

The framework described in this paper has very little insight into the data structures used by contracts. However, it may be possible for some contracts to produce transaction proofs ("tx proofs") when participants create new transactions on the input log; for example, a proof could provide the signed root hash for the resulting state along with an assertion such as "the output log now includes entry K with value V." These proofs could be shared outside of the contract and quickly verified by third parties without consulting the current contract state.

An example use-case for tx proofs would be a package manager in which developers share the tx proofs out-of-band. Consumers of a package could quickly verify that the received package is a canonical distribution by computing the package's hash and then comparing with the hash asserted in the proof (along with verifying the proof's signature). At this stage, the consumer knows that the received package has been asserted to be "published" by the package-manager's executor; however, the consumer could consult the contract's current state to further verify that 1) the executor is honest and has not generated an invalid tx proof, and 2) the received copy of the package has not been revoked.

## Conclusion

Reducing the trust required for participation is key to ensuring open, decentralized networks. In this paper, we've given a high-level overview of a solution for externally-auditable services whose operations are constrained by software contracts. This transparency ensures that bad actors are quickly caught and stopped from harming the overall network.

While Execution Transparency provides weaker trust-minimization than blockchains, it provides significant performance improvements by relaxing some constraints. As with blockchains, ET may not be the ideal solution for all use-cases, but can be a much better fit for applications in which global consensus is not required.
