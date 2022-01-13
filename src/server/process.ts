import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import childProcess from 'child_process'
import { DataDirectory } from './data-directory.js'
import { Server } from './server.js'
import { bindServerSocket } from './rpc.js'

const __dirname = join(dirname(fileURLToPath(import.meta.url)))
const BIN_PATH = join(__dirname, '..', 'cli.js')

export async function init (path: string) {
  try {
    acquirePidFile(join(path, 'server.pid'))
  } catch (e) {
    console.error('A server process is already active')
    process.exit(100)
  }

  const dir = new DataDirectory(path)
  const info = await dir.info()
  if (!info.exists) {
    console.error('No database has been configured at this directory')
    process.exit(101)
  }

  const server = await Server.load(dir)
  const netServer = await bindServerSocket(server)
  console.log('Initialized at', (new Date()).toLocaleDateString())
  server.db.on('error', e => console.error(e))
  process.on('SIGINT', async () => {
    netServer.close()
    await server.close()
    console.log('Shut down at', (new Date()).toLocaleDateString())
    process.exit(0)
  })
  return server
}

export function isActive (path: string) {
  return fs.existsSync(join(path, 'server.pid'))
}

export async function spawn (path: string) {
  const p = childProcess.spawn(process.execPath, [BIN_PATH, 'bg', path], {
    detached: true
  })
  p.stdout.pipe(fs.createWriteStream(join(path, 'server.log')))
  p.stderr.pipe(fs.createWriteStream(join(path, 'server.err')))
  await new Promise((resolve, reject) => {
    p.on('spawn', resolve)
    p.on('error', reject)
    p.on('close', reject)
  })
  await whenSocketFileExists(path)
}

export async function kill (path: string) {
  const pidStr = await fs.promises.readFile(join(path, 'server.pid'), 'utf-8')
  const pid = Number(pidStr)
  if (typeof pid !== 'number') throw new Error('Unable to read server pidfile')
  process.kill(pid, 'SIGINT')
  await whenIsntActive(path)
}

function acquirePidFile (path: string) {
  const pidBuf = Buffer.from(`${process.pid}\n`, 'utf-8')
  var fd = fs.openSync(path, 'wx')
  var offset = 0
  while (offset < pidBuf.length) {
    offset += fs.writeSync(fd, pidBuf, offset, pidBuf.length - offset)
  }
  fs.closeSync(fd)
  process.on('exit', () => fs.unlinkSync(path))
}

async function whenSocketFileExists (path: string) {
  const sockPath = join(path, 'server.sock')
  const timeout = Date.now() + 15e3
  while (Date.now() < timeout) {
    try {
      const st = await fs.promises.stat(sockPath)
      if (st) return
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 1e3))
  }
  throw new Error('Server failed to start')
}

async function whenIsntActive (path: string) {
  const pidPath = join(path, 'server.pid')
  const timeout = Date.now() + 15e3
  while (Date.now() < timeout) {
    try {
      const st = await fs.promises.stat(pidPath)
      if (!st) return
    } catch (e) {
      return
    }
    await new Promise(r => setTimeout(r, 1e3))
  }
  throw new Error('Server failed to close')
}