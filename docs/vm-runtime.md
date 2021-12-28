# VM Runtime

A contract is an ES module. Source code must be defined as a single "blob" and therefore no imports are enabled.

## Restricted Mode

In "restricted mode," all host calls are disabled except for reads from the `ContractIndex` instance located at `globals.index`. Additionally, only one call to the contract may be active at a time.

> ℹ️ Restricted mode is used during `process()` and `apply()` calls.

## Standard Exports

Each contract exports the following functions:

- `apply` Required. Translates operations into changes to the index. Must not have any side-effects. Called only on the executor instance or during verification flows.
- `process` Optional. Returns metadata to be attached to operation `ack` messages. Cannot be async. Called only on the executor instance.

Apply is expected to conform to one of the following signature:

```typescript
// signature one
(tx: ApplyTransactor, op: any, ack: Ack) => Promise<void>

// signature two
Record<string, (tx: ApplyTransactor, op: any, ack: Ack) => Promise<void>>
```

In the latter case, the `.op` attribute of the operation is used to lookup the correct apply function.

Process is expected to conform to the following signature:

```typescript
(op: any) => any|Promise<any>
```

Every other export is expected to conform to the following signature:

```typescript
(params: any, emit: (op: any) => void) => any|Promise<any>
```

The passed APIs are defined hereafter.

### `ApplyTransactor`

This is the API of the first parameter passed into `apply()`

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

> ℹ️ `put` and `delete` are not allowed to modify `.sys/*` keys directly, and instead must use the system mutators. This is for security reasons and to reduce the potential for malformed system entries.

### `Ack`

This is the API of the third parameter passed into `apply()`

```javascript
interface Ack {
  origin: string // the pubkey of the op author (hex string)
  ts: Date // the timestamp of the executor's ack (Date)
  metadata: any // any metadata provided by `process()`; may be undefined
}
```

## Standard Modules

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

type listOplog = () => ContractOplog[]
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

## Globals

The environment includes all items listed in https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects except for the following:

- `eval`
- `Atomics`
- `WebAssembly`
- `Function`
- `AsyncFunction`
