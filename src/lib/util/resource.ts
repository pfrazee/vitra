import { EventEmitter } from 'events'
import { AwaitLock } from './lock.js'

const lock = Symbol('lock')
const reopen = Symbol('allow reopen')
const init = Symbol('init()')

export class Resource extends EventEmitter {
  opening = false
  opened = false
  closing = false
  closed = false
  ;[reopen] = false
  ;[lock] = new AwaitLock()

  constructor (opts?: {reopen: boolean}) {
    super()
    this[init]()
    this[reopen] = opts?.reopen || false
  }

  [init] () {
    this.opening = false
    this.opened = false
    this.closing = false
    this.closed = false
  }

  async open () {
    await this[lock].acquireAsync()
    try {
      if (this.closed) {
        if (!this[reopen]) {
          throw new Error('Resource is closed')
        }
        this[init]()
      }
      if (this.opened) return
      this.opening = true
      await this._open()
      this.opening = false
      this.opened = true
      this.emit('opened')
    } finally {
      this[lock].release()
    }
  }

  async close () {
    await this[lock].acquireAsync()
    try {
      if (this.closed) return
      if (!this.opened) {
        this.closed = true
        return
      }
      this.closing = true
      await this._close()
      this.closing = false
      this.closed = true
      this.emit('closed')
    } finally {
      this[lock].release()
    }
  }

  async _open () {}
  async _close () {}
}