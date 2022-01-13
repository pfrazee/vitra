import repl, { REPLServer } from 'repl'
import fs, { promises as fsp } from 'fs'
import os from 'os'
import util from 'util'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DataDirectory } from './server/data-directory.js'
import { Server } from './server/server.js'
import { Client, createLoopbackClient } from './server/rpc.js'
import { keyToBuf } from './types.js'
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
  client: Client|undefined,
  confirmDestroyPath: string|undefined
} = {
  workingDir: undefined,
  server: undefined,
  client: undefined,
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
    async action () {
      this.clearBufferedCommand()
      await logInfo()
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

  inst.defineCommand('fraudlist', {
    help: 'List all tracked fraud-proofs with this database.',
    async action () {
      this.clearBufferedCommand()
      await logFraudList()
      this.displayPrompt()
    }
  })

  inst.defineCommand('fraud', {
    help: 'View a tracked fraud-proof with this database.',
    async action (fraudId: string) {
      this.clearBufferedCommand()
      await logFraud(fraudId)
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
  state.client = undefined
  replInst.context.server = undefined
  replInst.context.rpc = undefined
}

function setupServer () {
  if (state.server) {
    state.server.db.on('error', onServerDbError)
    console.log(`Database initialized.`)
    state.client = createLoopbackClient(state.server)
    replInst.context.server = state.server
    replInst.context.rpc = state.client
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

async function logInfo () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const info = await state.client.getInfo()
    const labelLength = info.logs.reduce((acc: number, log: any) => Math.max(acc, log.label.length), 0)
    console.log(chalk.bold(`${'Log'.padEnd(labelLength)} | ${'Pubkey'.padEnd(64)} | Length | Owner?`))
    for (const log of info.logs) {
      console.log(`${log.label.padEnd(labelLength)} | ${log.pubkey} | ${String(log.length).padEnd(6)} | ${log.writable ? chalk.green('Yes') : 'No'}`)
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logHist (pubkey: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))

  try {
    const res = await state.client.logGetHistory({pubkey})
    for (let i = 0; i < res.entries.length; i++) {
      console.log(i, util.inspect(res.entries[i], false, Infinity, true))
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logIndexList (path: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  path = path || '/'
  try {
    const res = await state.client.indexList({path})
    for (const entry of res.entries) {
      if (entry.container) {
        console.log(`${entry.path}/`)
      } else {
        console.log(`${entry.path} = ${util.inspect(entry.value, false, Infinity, true)}`)
      }
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logIndexGet (path: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const entry = await state.client.indexGet({path})
    console.log(util.inspect(entry, false, Infinity, true))
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logSource () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const res = await state.client.getSource()
    console.log(res.source)
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logSourceMethods () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const res = await state.client.listMethods()
    for (const {name, args} of res.methods) {
      if (args) console.log(`${name} ${args}`)
      else console.log(`${name}`)
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logTxList () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const res = await state.client.txList()
    for (const txId of res.txIds) {
      console.log(txId)
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logTx (txId: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  if (!txId) return console.log(chalk.red(`Must specify the transaction ID`))
  try {
    const res = await state.client.txGet({txId})
    console.log(util.inspect(res, false, Infinity, true))
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function verifyTx (txId: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  if (!txId) return console.log(chalk.red(`Must specify the transaction ID`))
  try {
    console.log(`Verifying transaction...`)
    const res = await state.client.txVerify({txId})
    if (res.success) {
      console.log(`Transaction verified!`)
    } else {
      console.log(chalk.red(`Verification failed! Details:`))
      console.log(res.fraudDescription)
      console.log(chalk.red(`This is a serious issue. The details have been recorded under ID ${res.fraudId}. Use .fraudlist and .fraud to view these details.`))
    }
  } catch (e: any) {
    console.log(chalk.red(`Verification failed to execute. This error does not necessarily indicate that fraud has occurred.`))
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logFraudList () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    const res = await state.client.fraudList()
    for (const fraudId of res.fraudIds) {
      console.log(fraudId)
    }
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
  }
}

async function logFraud (fraudId: string) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  if (!fraudId) return console.log(chalk.red(`Must specify the transaction ID`))
  try {
    const res = await state.client.fraudGet({fraudId})
    console.log(util.inspect(res, false, Infinity, true))
  } catch (e: any) {
    console.log(chalk.red(e.message || e.toString()))
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
    console.log(chalk.red(`  ${e.message || e.toString()}`))
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
    console.log(chalk.red(`  ${e.message || e.toString()}`))
    return
  }

  await resetServer()
  state.server = await Server.createFromExisting(state.workingDir, pubkeyBuf)
  setupServer()
}

async function executeCall (method: string, args: string[]) {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  if (!method) return console.log(chalk.red(`Must specify the method to call.`))
  args = args || []
  const argsObj = minimist(args)
  // @ts-ignore dont care -prf
  delete argsObj._
  try {
    const res = await state.client.dbCall({method, args: argsObj})
    if (res.txId) {
      console.log(`Transaction ID: ${res.txId}`)
    }
    if (typeof res.response !== 'undefined') {
      console.log('Response:', res.response)
    }
  } catch (e: any) {
    console.log(chalk.red(`Your call failed to execute.`))
    console.log(chalk.red(e.message || e.toString()))
    return
  }
}

async function verify () {
  if (!state.workingDir) return console.log(chalk.red(`No working directory set. Call .use first.`))
  if (!state.client) return console.log(chalk.red(`No database active.`))
  try {
    console.log(`Verifying execution...`)
    const res = await state.client.dbVerify()
    if (res.success) {
      console.log(`Database verified!`)
    } else {
      console.log(chalk.red(`Verification failed! Details:`))
      console.log(res.fraudDescription)
      console.log(chalk.red(`This is a serious issue. The details have been recorded under ID ${res.fraudId}. Use .fraudlist and .fraud to view these details.`))
    }
  } catch (e: any) {
    console.log(chalk.red(`Verification failed to execute. This error does not necessarily indicate that fraud has occurred.`))
    console.log(chalk.red(e.message || e.toString()))
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
