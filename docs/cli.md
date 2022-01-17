# Vitra CLI docs

Vitra uses an interactive CLI. Install vitra by calling:

```
npm i -g vitra
```

Then start vitra by simply calling the `vitra` command.

## Overview

[![Vitra tutorial video](https://img.youtube.com/vi/6lS7FMGzMZk/0.jpg)](https://www.youtube.com/watch?v=6lS7FMGzMZk)

The interactive CLI is a REPL session, meaning you can run Javascript inside it. However: the majority of the time you'll use the builtin commands, all of which start with a `.`.

During the CLI session, you have a current working directory. This is the directory in which your database's data is stored. You can check the current directory and database with the `.status` command. You can set the current directory with the `.use {path}` command.

## Commands

```
.bg           Move the hosting process to a background process that will persist after this session.
.call         Call a method on the current database.
.deloplog     Delete an oplog on this database. (Must not be an active participant.)
.destroy      Destroy the database in the current working path.
.fg           Stop the background process, if it exists, and move the host back into this session.
.fraud        View a tracked fraud-proof with this database.
.fraudlist    List all tracked fraud-proofs with this database.
.get          Get an entry in the index at the given path.
.help         Print this help message
.history      Output the history of a log. (Pass the pubkey or "index".)
.info         Output detailed information about the current database.
.init         Create a new database in the current working path.
.list         List entries in the index at the given path.
.load         Load an existing database into the current working path.
.methods      Output the methods exported by the current database's contract.
.mkoplog      Create a new oplog for this database.
.monitor      Persistently watch and verify the execution of this database.
.monitorend   Stop monitoring this database.
.source       Output the source code for the current database's contract.
.status       Get the current session information.
.sync         Sync the latest state of the current database.
.syncall      Sync the full history of the current database.
.test         Start a testing sandbox.
.tx           View a tracked transaction with this database.
.txlist       List all tracked transactions with this database.
.txverify     Verify the inclusion of a tracked transaction with this database.
.use          Set the current working path.
.verify       Verify the execution of this database.
```

### `.bg`

Move the hosting process to a background process that will persist after this session.

### `.call`

```
.call {method} [params...]
```

Call a method on the current database. Params are specified using bash-style `--` switches; for instance, to call `put({key: 'foo', value: 'bar'})`, you would type `.call put --key foo --value bar`.

### `.deloplog`

```
.deloplog {pubkey}
```

Delete an oplog on this database. (Must not be an active participant.)

### `.destroy`

Destroy the database in the current working path.

### `.fg`

Stop the background process, if it exists, and move the host back into this session.

### `.fraud`

```
.fraud {id}
```

View a tracked fraud-proof with this database.

### `.fraudlist`

List all tracked fraud-proofs with this database.

### `.get`

```
.get {path}
```

Get an entry in the index at the given path.

### `.help`

Print a command listing.

### `.history`

```
.history [pubkey]
```

Output the history of a log. (Pass the pubkey or "index".)

### `.info`

Output detailed information about the current database.

### `.init`

```
.init {contract-js-path}
```

Create a new database in the current working path.

### `.list`

```
.list [path]
```

List entries in the index at the given path.

### `.load`

```
.load {pubkey}
```

Load an existing database into the current working path.

### `.methods`

Output the methods exported by the current database's contract.

### `.mkoplog`

Create a new oplog for this database.

### `.monitor`

Persistently watch and verify the execution of this database.

### `.monitorend`

Stop monitoring this database.

### `.source`

Output the source code for the current database's contract.

### `.status`

Get the current session information.

### `.sync`

Sync the latest state of the current database.

### `.syncall`

Sync the full history of the current database.

### `.test`

```
.test {contract-js-path}
```

Start a testing sandbox.

### `.tx`

```
.tx {id}
```

View a tracked transaction with this database.

### `.txlist`

List all tracked transactions with this database.

### `.txverify`

```
.txverify {id}
```

Verify the inclusion of a tracked transaction with this database.

### `.use`

```
.txverify {db-path}
```

Set the current working path.

### `.verify`

Verify the execution of this database.
