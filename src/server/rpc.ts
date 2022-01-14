import util from 'util'
import net from 'net'
import frame from 'frame-stream'
import * as jsonrpc from 'jsonrpc-lite'
import * as msgpackr from 'msgpackr'
import { Server } from './server.js'
import { Transaction } from '../core/transactions.js'
import { Log } from '../core/log.js'
import { FraudProof } from '../core/fraud-proofs.js'
import { listExportedMethods } from '../util/parser.js'
import { keyToBuf } from '../types.js'

interface LogInfo {
  label: string
  pubkey: string
  length: number
  writable: boolean
}

interface GetInfoResponse {
  logs: LogInfo[]
  numPeers: number
}

interface GetSourceResponse {
  source: string
}

interface ListMethodsResponse {
  methods: {name: string, args: string}[]
}

interface LogGetHistoryParams {
  pubkey: string
}

interface LogGetHistoryResponse {
  isIndex: boolean
  entries: any[]
}

interface IndexListParams {
  path: string
}

interface IndexListResponse {
  entries: any[]
}

interface IndexGetParams {
  path: string
}

type IndexGetResponse = any

interface IndexDangerousWriteParams {
  type: 'put'|'del'
  path: string
  value: any
}

interface TxListResponse {
  txIds: string[]
}

interface TxGetParams {
  txId: string
}

interface TxGetResponse {
  vitraTransaction: number
  databasePubkey: string
  isProcessed: boolean
  call: {
    method: string
    params: any[]
  }
  response: any
  operations: {
    value: any,
    proof: {
      logPubkey: string,
      blockSeq: number,
      rootHashAtBlock: string,
      rootHashSignature: string
    }, 
    result: any
  }[]
}

interface TxVerifyParams {
  txId: string
}

interface FraudListResponse {
  fraudIds: string[]
}

interface FraudGetParams {
  fraudId: string
}

interface TxVerifyResponse {
  success: boolean
  fraudId?: string
  fraudDescription?: string
}

interface DbCallParams {
  method: string
  args: any
}

interface DbCallResponse {
  txId: string|undefined
  response: any
}

interface DbSyncParams {
  fullHistory?: boolean
}

interface DbVerifyResponse {
  success: boolean
  fraudId?: string
  fraudDescription?: string
}

export interface Client {
  getInfo (): Promise<GetInfoResponse>
  getSource (): Promise<GetSourceResponse>
  listMethods (): Promise<ListMethodsResponse>
  logGetHistory (params: LogGetHistoryParams): Promise<LogGetHistoryResponse>
  indexList (params: IndexListParams): Promise<IndexListResponse>
  indexGet (params: IndexGetParams): Promise<IndexGetResponse>
  indexDangerousWrite (params: IndexDangerousWriteParams): Promise<void>
  txList (): Promise<TxListResponse>
  txGet (params: TxGetParams): Promise<TxGetResponse>
  txVerify (params: TxVerifyParams): Promise<TxVerifyResponse>
  fraudList (): Promise<FraudListResponse>
  fraudGet (params: FraudGetParams): Promise<any>
  dbCall (params: DbCallParams): Promise<DbCallResponse>
  dbVerify (): Promise<DbVerifyResponse>
  dbSync (params: DbSyncParams): Promise<void>
  dbStartMonitor (): Promise<void>
  dbStopMonitor (): Promise<void>
}

function createClient (handler: Function): Client {
  let id = 1
  const request = async (method: string, params: any = undefined): Promise<any> => {
    const req = jsonrpc.request(id++, method, [params])
    const parsed = jsonrpc.parseObject(await handler(req))
    if (parsed.type === 'error') {
      throw new Error(parsed.payload.error.message)
    } else if (parsed.type === 'success') {
      return parsed.payload.result
    }
  }

  return {
    getInfo (): Promise<GetInfoResponse> {
      return request('getInfo')
    },
  
    getSource (): Promise<GetSourceResponse> {
      return request('getSource')
    },
  
    listMethods (): Promise<ListMethodsResponse> {
      return request('listMethods')
    },
  
    logGetHistory (params: LogGetHistoryParams): Promise<LogGetHistoryResponse> {
      return request('logGetHistory', params)
    },
  
    indexList (params: IndexListParams): Promise<IndexListResponse> {
      return request('indexList', params)
    },
  
    indexGet (params: IndexGetParams): Promise<IndexGetResponse> {
      return request('indexGet', params)
    },
    
    indexDangerousWrite (params: IndexDangerousWriteParams): Promise<void> {
      return request('indexDangerousWrite', params)
    },
  
    txList (): Promise<TxListResponse> {
      return request('txList')
    },
  
    txGet (params: TxGetParams): Promise<TxGetResponse> {
      return request('txGet', params)
    },
  
    txVerify (params: TxVerifyParams): Promise<TxVerifyResponse> {
      return request('txVerify', params)
    },
  
    fraudList (): Promise<FraudListResponse> {
      return request('fraudList')
    },
  
    fraudGet (params: FraudGetParams): Promise<any> {
      return request('fraudGet', params)
    },
  
    dbCall (params: DbCallParams): Promise<DbCallResponse> {
      return request('dbCall', params)
    },
  
    dbVerify (): Promise<DbVerifyResponse> {
      return request('dbVerify')
    },
  
    dbSync (params: DbSyncParams): Promise<void> {
      return request('dbSync', params)
    },

    dbStartMonitor (): Promise<void> {
      return request('dbStartMonitor')
    },

    dbStopMonitor (): Promise<void> {
      return request('dbStopMonitor')
    }
  }
}

function createServer (server: Server) {
  const handlers: Record<string, Function> = {
    getInfo (): GetInfoResponse {
      const logs: LogInfo[] = []
      const capture = (label: string, log: Log) => {
        logs.push({label, pubkey: log.pubkey.toString('hex'), length: log.length, writable: log.writable})
      }
      capture('Index', server.db.index)
      for (let i = 0; i < server.db.oplogs.length; i++) {
        capture(`Oplog ${i}`, server.db.oplogs.at(i) as Log)
      }
      return {numPeers: server.db.numPeers, logs}
    },

    async getSource (params: any) {
      const source = await server.db._readContractCode()
      return {source}
    },

    async listMethods (params: any) {
      const source = await server.db._readContractCode()
      return {
        methods: listExportedMethods(source)
      }
    },

    async logGetHistory (params: any) {
      let pubkeyBuf: Buffer
      try {
        if (!params?.pubkey) pubkeyBuf = server.db.index.pubkey
        else pubkeyBuf = keyToBuf(params?.pubkey)
      } catch (e: any) {
        throw new Error(`Invalid public key: ${e.message}`)
      }

      if (server.db.index.pubkey.equals(pubkeyBuf)) {
        const entries = []
        for await (const entry of server.db.index.history()) {
          entries.push(entry)
        }
        return {isIndex: true, entries}
      } else {
        const oplog = server.db.oplogs.find(item => item.pubkey.equals(pubkeyBuf as Buffer))
        if (!oplog) throw new Error(`Log not found`)
    
        const entries = []
        for (let i = 0; i < oplog.length; i++) {
          entries.push((await oplog.get(i))?.value)
        }
        return {isIndex: false, entries}
      }
    },

    async indexList (params: any) {
      const path = params?.path || '/'
      const entries = []
      for (const entry of await server.db.index.list(path)) {
        entries.push(entry)
      }
      return {entries}
    },

    async indexGet (params: any) {
      const entry = await server.db.index.get(params?.path)
      if (!entry) throw new Error(`No entry found`)
      return entry
    },
    
    async indexDangerousWrite (params: IndexDangerousWriteParams) {
      await server.db.index.dangerousBatch([params])
      return `${params.path} written.`
    },

    async txList (params: any) {
      return {txIds: await server.dir.listTrackedTxIds()}
    },

    async txGet (params: any) {
      return await server.dir.readTrackedTx(params?.txId)
    },

    async txVerify (params: any) {
      const txInfo = await server.dir.readTrackedTx(params?.txId)
      if (!txInfo) throw new Error(`No transaction data found`)
      const tx = Transaction.fromJSON(server.db, txInfo)
      try {
        await tx.verifyInclusion()
        return {success: true}
      } catch (e: any) {
        if (e instanceof FraudProof) {
          const fraudId = String(Date.now())
          server.dir.writeFraud(fraudId, e)
          return {
            success: false,
            fraudId,
            fraudDescription: util.inspect(e)
          }
        }
        throw e
      }
    },

    async fraudList (): Promise<FraudListResponse> {
      return {fraudIds: await server.dir.listTrackedFraudIds()}
    },
  
    async fraudGet (params: FraudGetParams): Promise<any> {
      return await server.dir.readTrackedFraud(params?.fraudId)
    },

    async dbCall (params: any) {
      let txId = undefined
      const tx = await server.db.call(params?.method, params?.args)
      if (tx.ops.length) {
        txId = tx.txId
        server.dir.trackTransaction(tx)
      }
      return {
        txId,
        response: tx.response
      }
    },

    async dbVerify (): Promise<DbVerifyResponse> {
      try {
        await server.db.verify()
        return {success: true}
      } catch (e: any) {
        if (e instanceof FraudProof) {
          const fraudId = String(Date.now())
          server.dir.writeFraud(fraudId, e)
          return {
            success: false,
            fraudId,
            fraudDescription: util.inspect(e)
          }
        }
        throw e
      }
    },
  
    async dbSync (params: DbSyncParams): Promise<void> {
      if (params.fullHistory) {
        await server.db.syncFullHistory()
      } else {
        await server.db.syncLatest()
      }
    },

    async dbStartMonitor (): Promise<void> {
      await server.startMonitor()
    },

    async dbStopMonitor (): Promise<void> {
      await server.stopMonitor()
    }
  }

  return async (reqbuf: Buffer): Promise<Buffer> => {
    const parsed = jsonrpc.parseObject(msgpackr.unpack(reqbuf))
    if (parsed.type === 'error') {
      return msgpackr.pack(parsed.payload)
    } else if (parsed.type === 'request') {
      try {
        const param = Array.isArray(parsed.payload.params) ? parsed.payload.params[0] : []
        const res = await handlers[parsed.payload.method](param)
        return msgpackr.pack(jsonrpc.success(parsed.payload.id, typeof res !== 'undefined' ? res : 0))
      } catch (e: any) {
        const msg = e[util.inspect.custom] ? util.inspect(e) : (e.message || e.toString())
        const rpcErr = new jsonrpc.JsonRpcError(msg, e.code || -32000, e.data)
        return msgpackr.pack(jsonrpc.error(parsed.payload.id, rpcErr))
      }
    } else {
      throw new Error('Unhandled object type')
    }
  }
}

export function createLoopbackClient (server: Server): Client {
  const handleRPC = createServer(server)
  return createClient(async (req: jsonrpc.RequestObject) => {
    return msgpackr.unpack(await handleRPC(msgpackr.pack(req) as Buffer) as Buffer)
  })
}

export function bindServerSocket (server: Server) {
  const handleRPC = createServer(server)
  const sockPath = server.dir.socketFilePath
  const sockServer = net.createServer((c) => {
    const encode = frame.encode()
    encode.pipe(c)
    c.pipe(frame.decode()).on('data', async (buf: Buffer) => {
      encode.write(await handleRPC(buf))
    })
  });
  sockServer.listen(sockPath, () => {
    console.log(`Listening on ${sockPath}`)
  })
  return sockServer
}

export async function connectServerSocket (sockPath: string) {
  const socket = net.connect(sockPath)
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve)
    socket.on('error', reject)
  })

  const pending: Map<number, Function> = new Map()
  const encode = frame.encode()
  encode.pipe(socket)
  socket.pipe(frame.decode()).on('data', (buf: Buffer) => {
    const obj = msgpackr.unpack(buf)
    const r = pending.get(obj.id)
    if (r) {
      pending.delete(obj.id)
      r(obj)
    } else {
      console.error('Received a response for a non-pending request', r)
    }
  })
  return createClient((req: jsonrpc.RequestObject) => {
    encode.write(msgpackr.pack(req))
    return new Promise(r => { pending.set(Number(req.id), r) })
  })
}