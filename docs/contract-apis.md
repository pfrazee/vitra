# Contract APIs

Vitra contracts are a javascript modules. They must be a single file (you can't import from other .js files) but there are some APIs defined which you can import.

The programming model of the contract is as follows:

- A set of functions are exported. These are the contract's API.
- Some functions may emit "operations" which are published in an oplog.
- Operations are handled by database's "executor" using the `apply()` function.

Here is a simple example contract to help explain this:

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
```

This contract exports two methods, `get()` and `increment()`. The increment method publishes an `INCREMENT` operation which is then processed by the `apply.INCREMENT` method.

## Exported functions

Each contract exports the following functions:

- `apply` Required. Translates operations into changes to the index. Must not have any side-effects. Called only on the executor instance or during verification flows.
- `process` Optional. Returns metadata to be attached to operation `ack` messages. Cannot be async. Called only on the executor instance.

They can also export any number of functions for working with the contract.

### The `apply()` method

The `apply` function MUST be provided. It is called by the executor to transform operations into changes to the database. It is also called by monitors to double-check that the executor is following the contract.

```typescript
// version 1
export async function apply (tx, op, ack) {
  // apply the operation
}

// version 2
export const apply = {
  async OPERATION_NAME (tx, op, ack) {
    // apply the operation
  }
}
```

Three parameters are passed into apply: `tx`, `op`, and `ack`. The `op` is the operation you're currently processing, and it will simply be the object you passed with the `emit()` call in one of the API methods.

The `tx` parameter is how you make changes to the database state and will follow the following API:

```typescript
interface ApplyTransactor {
  get(key: string): any // gets the queued operation at the given key

  // general mutators
  put(key: string, value: any): void
  delete(key: string): void

  // system mutators
  addOplog(value: {pubkey: string}): void
  removeOplog(value: {pubkey: string}): void
  setContractSource(value: {code: string}): void
}
```

The `ack` object is some additional metadata which will look like this:

```javascript
interface Ack {
  origin: string // the pubkey of the op author (hex string)
  ts: Date // the timestamp of the executor's ack (Date)
  metadata: any // any metadata provided by `process()`; may be undefined
}
```

## The `process()` method

The process method is an optional export which allows you to attach metadata to an operation. It's useful for attaching non-deterministic information such as a timestamp or random bits. It is only called by the executor, and it is called right before `apply()` is called. It should look like this:

```typescript
export async function process (op) {
  return {some: 'metadata'}
}
```

The result of `process()` is provided in the `ack.metadata` field in `apply()`.

### Other exported functions

All other exported functions should follow the following signature:

```typescript
export async function someMethod (params, emit) {
  // do whatever
}
```

The first parameter, `params` will always be an object. It contains parameters supplied by the caller.

The second parameter, `emit`, queues operations to be handled by `apply()`. The exact object passed to `emit()` will be the operation published. It's strongly recommended that every emitted operation includes an `op` attribute, which is the ID of the operation. For example, `emit({op: 'SET_VALUE', key: 'foo', value: 'bar'})`.

## Modules

The contract environment includes a few standard modules. The most important is the `contract` module which provides APIs for interacting with the contract:

```js
import { index } from 'contract'

await index.get('/foo')
await index.list('/')
```

### `assert`

```typescript
import ok, * as assert from 'assert'

interface Assert {
  ok (value: any, message: string): void
  deepEqual (v1: any, v2: any, message: string): void
  doesNotMatch (str: string, regex: RegExp, message: string): void
  equal (v1: any, v2: any, message: string): void
  fail (message: string): void
  match (str: string, regex: RegExp, message: string): void
  notDeepEqual (v1: any, v2: any, message: string): void
  notEqual (v1: any, v2: any, message: string): void
}
```

### `contract`

```typescript
import { index, oplog, isWriter, listOplogs } from 'contract'

type listOplogs = () => ContractOplog[]
type isWriter = boolean

interface ContractIndex {
  list (prefix: string, opts: any): Promise<ContractIndexEntry>
  get (key: string): Promise<any>
}

interface ContractIndexEntry {
  key: string
  value: any
}

interface ContractOplog {
  getLength (): Promise<number>
  get (seq: number): Promise<any>
}
```

### `util`

```typescript
import { genUUID } from 'util'

type genUUID = () => string
```
