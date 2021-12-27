# In The Open (ITO)

*Work in progress*

A blockchain-free smart contract platform using secure ledgers. [Read the white paper](#todo).

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
- [ ] Implement transactions
  - [x] API calls
  - [ ] Op execution
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

## Future improvements

### Native-code contract runtime

Currenly ITO is using [https://github.com/laverdet/isolated-vm] to execute contracts (via the [Confine Sandbox](https://github.com/confine-sandbox) framework). This could be optimized by replacing the confine guest process with a C++ program that embeds V8, which would reduce the amount of marshalling between V8 contexts.