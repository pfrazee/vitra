import repl, { REPLServer } from 'repl'
import fs, { promises as fsp } from 'fs'
import os from 'os'
import util from 'util'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DataDirectory } from './server/data-directory.js'
import { Server } from './server/server.js'
import { Log } from './core/log.js'
import { Transaction } from './core/transactions.js'
import { keyToBuf } from './types.js'
import { listExportedMethods } from './util/parser.js'
import chalk from 'chalk'
import minimist from 'minimist'

const __dirname = join(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

// globals
// =

let replInst: REPLServer
const state: {
  workingDir: DataDirectory|undefined,
  server: Server|undefined,
  confirmDestroyPath: string|undefined
} = {
  workingDir: undefined,
  server: undefined,
  confirmDestroyPath: undefined
}

// start
// =

main()
async function main () {
  banner()
  await logStatus()
  console.log('Type .help if you get lost')
  replInst = createREPL()
}

// commands
// =

function createREPL (): REPLServer {
  const inst = repl.start('vitra $ ')
  inst.setupHistory(join(os.homedir(), '.vitra-history'), ()=>{})
  inst.on('exit', async () => {
    await resetAll()
    process.exit()
  })

  inst.defineCommand('status', {
    help: 'Get the current session information.',
    async action () {
      this.clearBufferedCommand()
      await logStatus()
      this.displayPrompt()
    }
  })

  inst.defineCommand('use', {
    help: 'Set the current working path.',
    async action (path) {
      this.clearBufferedCommand()
      await setDirectory(path)
      this.displayPrompt()
    }
  })

  inst.defineCommand('init', {
    help: 'Create a new database in the current working path.',
    async action (contractSourcePath: string) {
      this.clearBufferedCommand()
      await init(contractSourcePath)
      this.displayPrompt()
    }
  })

  inst.defineCommand('load', {
    help: 'Load an existing database into the current working path.',
    async action (pubkey: string) {
      this.clearBufferedCommand()
      await load(pubkey)
      this.displayPrompt()
    }
  })

  inst.defineCommand('info', {
    help: 'Output detailed information about the current database.',
    action () {
      this.clearBufferedCommand()
      logInfo()
      this.displayPrompt()
    }
  })

  inst.defineCommand('history', {
    help: 'Output the history of a log. (Pass the pubkey or "index".)',
    async action (pubkey: string) {
      this.clearBufferedCommand()
      await logHist(pubkey)
      this.displayPrompt()
    }
  })

  inst.defineCommand('list', {
    help: 'List entries in the index at the given path.',
    async action (path: string) {
      this.clearBufferedCommand()
      await logIndexList(path)
      this.displayPrompt()
    }
  })

  inst.defineCommand('get', {
    help: 'Get an entry in the index at the given path.',
    async action (path: string) {
      this.clearBufferedCommand()
      await logIndexGet(path)
      this.displayPrompt()
    }
  })

  inst.defineCommand('source', {
    help: 'Output the source code for the current database\'s contract.',
    async action () {
      this.clearBufferedCommand()
      await logSource()
      this.displayPrompt()
    }
  })

  inst.defineCommand('methods', {
    help: 'Output the methods exported by the current database\'s contract.',
    async action () {
      this.clearBufferedCommand()
      await logSourceMethods()
      this.displayPrompt()
    }
  })

  inst.defineCommand('txlist', {
    help: 'List all tracked transactions with this database.',
    async action () {
      this.clearBufferedCommand()
      await logTxList()
      this.displayPrompt()
    }
  })

  inst.defineCommand('tx', {
    help: 'View a tracked transaction with this database.',
    async action (txId: string) {
      this.clearBufferedCommand()
      await logTx(txId)
      this.displayPrompt()
    }
  })

  inst.defineCommand('txverify', {
    help: 'Verify the inclusion of a tracked transaction with this database.',
    async action (txId: string) {
      this.clearBufferedCommand()
      await verifyTx(txId)
      this.displayPrompt()
    }
  })

  inst.defineCommand('call', {
    help: 'Call a method on the current database.',
    async action (params: string) {
      this.clearBufferedCommand()
      let terms = params.match(/(?:[^\s"]+|"[^"]*")+/g) || [] // https://stackoverflow.com/questions/16261635/javascript-split-string-by-space-but-ignore-space-in-quotes-notice-not-to-spli
      terms = terms.map(term => {
        if (term.charAt(0) === '"' && term.charAt(term.length - 1) === '"') return term.slice(1, -1)
        return term
      })
      await executeCall(terms[0], terms.slice(1))
      this.displayPrompt()
    }
  })

  inst.defineCommand('verify', {
    help: 'Verify the execution of this database.',
    async action () {
      this.clearBufferedCommand()
      await verify()
      this.displayPrompt()
    }
  })

  inst.defineCommand('monitor', {
    help: 'Persistently watch and verify the execution of this database.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('sync', {
    help: 'Sync the latest state of the current database.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('syncall', {
    help: 'Sync the full history of the current database.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('bg', {
    help: 'Move the hosting process to a background process that will persist after this session.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('test', {
    help: 'Start a testing sandbox for the current database.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('testend', {
    help: 'End the testing sandbox.',
    async action () {
      this.clearBufferedCommand()
      console.log('TODO')
      this.displayPrompt()
    }
  })

  inst.defineCommand('destroy', {
    help: 'Destroy the database in the current working path.',
    async action () {
      this.clearBufferedCommand()
      await destroy()
      this.displayPrompt()
    }
  })

  return inst
}

// helpers
// =

function banner () {
  console.log(`
██╗   ██╗██╗████████╗██████╗  █████╗ 
██║   ██║██║╚══██╔══╝██╔══██╗██╔══██╗
██║   ██║██║   ██║   ██████╔╝███████║
╚██╗ ██╔╝██║   ██║   ██╔══██╗██╔══██║
 ╚████╔╝ ██║   ██║   ██║  ██║██║  ██║
  ╚═══╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝

[  v${pkg.version}  | created by Paul Frazee ]
`)
}

async function resetAll () {
  await resetServer()
}

async function resetServer () {
  if (state.server) {
    console.log(`Stopping host server for ${state.server.dir.path}`)
    await state.server.close()
  }
  state.server = undefined
  replInst.context.server = undefined
  replInst.context.db = undefined
}

function setupServer () {
  if (state.server) {
    state.server.db.on('error', onServerDbError)
    console.log(`Database initialized.`)
    replInst.context.server = state.server
    replInst.context.db = state.server.db
  }
}

async function logStatus () {
  if (state.workingDir) {
    const info = await state.workingDir.info()
    console.log(`Current directory: ${state.workingDir.path}`)
    console.log(`Database: ${info.exists ? info.config?.pubkey.toString('hex') : '(none)'}`)
  } else {
    console.log(`Current directory: (none)`)
  }
}

function logInfo () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))
 
  const labelLength = `Oplog ${state.server.db.oplogs.length}`.length

  console.log(chalk.bold(`${'Log'.padEnd(labelLength)} | ${'Pubkey'.padEnd(64)} | Length | Owner?`))

  const logLog = (label: string, log: Log) => {
    console.log(`${label.padEnd(labelLength)} | ${log.pubkey.toString('hex')} | ${String(log.length).padEnd(6)} | ${log.writable ? chalk.green('Yes') : 'No'}`)
  }
  logLog('Index', state.server.db.index)
  for (let i = 0; i < state.server.db.oplogs.length; i++) {
    logLog(`Oplog ${i}`, state.server.db.oplogs.at(i) as Log)
  }
}

async function logHist (pubkey: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))

  let pubkeyBuf: Buffer
  try {
    if (pubkey === 'index') pubkeyBuf = state.server.db.index.pubkey
    else pubkeyBuf = keyToBuf(pubkey)
  } catch (e: any) {
    console.log(chalk.red(`Invalid public key.`))
    console.log(chalk.red(`  ${e.message}`))
    return
  }

  if (state.server.db.index.pubkey.equals(pubkeyBuf)) {
    for await (const entry of state.server.db.index.history()) {
      console.log(util.inspect(entry, false, Infinity, true))
    }
  } else {
    const oplog = state.server.db.oplogs.find(item => item.pubkey.equals(pubkeyBuf as Buffer))
    if (!oplog) return console.log(chalk.red(`Log not found`))

    for (let i = 0; i < oplog.length; i++) {
      const block = await oplog.get(i)
      console.log(i, util.inspect(block.value, false, Infinity, true))
    }
  }
}

async function logIndexList (path: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))
  path = path || '/'

  for (const entry of await state.server.db.index.list(path)) {
    if (entry.container) {
      console.log(`${entry.path}/`)
    } else {
      console.log(`${entry.path} = ${util.inspect(entry.value, false, Infinity, true)}`)
    }
  }
}

async function logIndexGet (path: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))
  const entry = await state.server.db.index.get(path)
  if (!entry) console.log(chalk.red(`No entry found`))
  else console.log(util.inspect(entry, false, Infinity, true))
}

async function logSource () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))

  try {
    const source = await state.server.db._readContractCode()
    console.log(source)
  } catch (e: any) {
    console.log(chalk.red(`Failed to read the database contract source.`))
    console.log(chalk.red(`  ${e.message}`))
  }
}

async function logSourceMethods () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))

  let source
  try {
    source = await state.server.db._readContractCode()
  } catch (e: any) {
    console.log(chalk.red(`Failed to read the database contract source.`))
    console.log(chalk.red(`  ${e.message}`))
    return
  }

  const methods = listExportedMethods(source)
  for (const {name, args} of methods) {
    if (args) console.log(`${name} ${args}`)
    else console.log(`${name}`)
  }
}

async function logTxList () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  const txIds = await state.workingDir.listTrackedTxIds()
  for (const txId of txIds) {
    console.log(txId)
  }
}

async function logTx (txId: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!txId) return console.log(chalk.red(`Must specify the transaction ID`))
  const txInfo = await state.workingDir.readTrackedTx(txId)
  if (!txInfo) return console.log(chalk.red(`No transaction data found`))
  console.log(util.inspect(txInfo, false, Infinity, true))
}

async function verifyTx (txId: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))
  if (!txId) return console.log(chalk.red(`Must specify the transaction ID`))
  const txInfo = await state.workingDir.readTrackedTx(txId)
  if (!txInfo) return console.log(chalk.red(`No transaction data found`))
  const tx = Transaction.fromJSON(state.server.db, txInfo)
  try {
    console.log(`Verifying transaction...`)
    await tx.verifyInclusion()
    console.log('Verified!')
  } catch (e: any) {
    console.log(chalk.red(`Verification failed! Details:`))
    console.log(e)
    console.log(chalk.red(`This is a serious issue. Record the details above and share it with members of this database.`))
  }
}

async function setDirectory (path: string) {
  if (path[0] === '~') {
    path = join(os.homedir(), path.slice(1))
  } else {
    path = resolve(path)
  }

  console.log(`Setting the current db to ${path}`)
  if (state.workingDir?.path === path) {
    return
  }
  await resetServer()

  let st
  try {
    st = await fsp.stat(path)
    if (st.isFile()) {
      console.log('')
      console.log(chalk.red(`Unable to use this directory:`))
      console.log(chalk.red(`  ${path} is a file`))
      return
    }
  } catch (e) {} // ignore

  if (!st?.isDirectory()) {
    console.log(chalk.green(`Creating directory ${path}`))
    try {
      await fsp.mkdir(path, {recursive: true})
    } catch (e: any) {
      console.log('')
      console.log(chalk.red(`Unable to use this directory:`))
      console.log(chalk.red(`  ${e.message}`))
      return
    }
  }

  state.workingDir = new DataDirectory(path)
  const info = await state.workingDir.info()
  if (info.exists) {
    state.server = await Server.load(state.workingDir)
    setupServer()
  }
}

async function init (contractSourcePath: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  const info = await state.workingDir.info()
  if (info.exists) return console.log(chalk.red(`A database already exists at this path.`))

  if (!contractSourcePath) return console.log(chalk.red(`You must specify the path to your database's contract .js file.`))
  let contractSource
  try {
    contractSource = await fsp.readFile(contractSourcePath, 'utf-8')
    if (!contractSource) throw new Error('No source found')
  } catch (e: any) {
    console.log(chalk.red(`Failed to read the contract source at ${contractSourcePath}.`))
    console.log(chalk.red(`  ${e.message}`))
    return
  }

  await resetServer()
  state.server = await Server.createNew(state.workingDir, contractSource)
  setupServer()
}

async function load (pubkey: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  const info = await state.workingDir.info()
  if (info.exists) return console.log(chalk.red(`A database already exists at this path.`))
  if (!pubkey) return console.log(chalk.red(`You must specify the public key of the database to load.`))

  let pubkeyBuf
  try {
    pubkeyBuf = keyToBuf(pubkey)
  } catch (e: any) {
    console.log(chalk.red(`Invalid public key.`))
    console.log(chalk.red(`  ${e.message}`))
    return
  }

  await resetServer()
  state.server = await Server.createFromExisting(state.workingDir, pubkeyBuf)
  setupServer()
}

async function executeCall (method: string, args: string[]) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))
  if (!method) return console.log(chalk.red(`Must specify the method to call.`))
  args = args || []
  const argsObj = minimist(args)
  // @ts-ignore dont care -prf
  delete argsObj._
  try {
    const tx = await state.server.db.call(method, argsObj)
    if (tx.ops.length) {
      console.log(`Transaction ID: ${tx.txId}`)
      state.workingDir.trackTransaction(tx)
    }
    if (typeof tx.response !== 'undefined') {
      console.log('Response:', tx.response)
    }
  } catch (e: any) {
    console.log(chalk.red(`Your call failed to execute.`))
    console.log(chalk.red(`  ${e.message}`))
    return
  }
}

async function verify () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.server) return console.log(chalk.red(`No database active.`))

  try {
    console.log(`Verifying execution...`)
    await state.server.db.verify()
    console.log(`Database verified!`)
  } catch (e) {
    console.log(chalk.red(`Verification failed! Details:`))
    console.log(e)
    console.log(chalk.red(`This is a serious issue. Record the details above and share it with members of this database.`))
  }
}

async function destroy () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  const info = await state.workingDir.info()
  if (!info.exists) return console.log(`No database exists at this path.`)
  
  if (state.confirmDestroyPath !== state.workingDir.path) {
    console.log(`This will delete all data, including the keypairs, of the database at ${state.workingDir.path}`)
    console.log(`If you're sure you want to do this, call .destroy again.`)
    state.confirmDestroyPath = state.workingDir.path
    return
  }

  if (state.server) {
    await state.server.close()
    state.server = undefined
  }
  await state.workingDir.destroy()
  state.confirmDestroyPath = undefined
  console.log(`Database destroyed.`)
}

function onServerDbError (e: any) {
  console.log('')
  console.log(chalk.red(`An error has occurred:`))
  console.log(e)
}
