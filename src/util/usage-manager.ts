import assert from 'assert'

export class UsageManager {
  public actives = 0
  
  private _pausePromise: Promise<void>|undefined = undefined
  private _pauseResolve: ((v:any)=>void)|undefined = undefined
  private _onPausable: ((v:any)=>void)|undefined = undefined

  async use <T>(fn: ()=>Promise<T>): Promise<T> {
    if (this.paused) await this._pausePromise
    this.actives++
    try {
      return await fn()
    } finally {
      this.actives--
      if (this.actives === 0) {
        this._onPausable?.(undefined)
      }
    }
  }

  get paused () {
    return !!this._pausePromise
  }

  async pause (): Promise<void> {
    assert(!this._pausePromise, 'Already paused')
    if (this.actives > 0) {
      await new Promise(resolve => {
        this._onPausable = resolve
      })
    }
    this._pausePromise = new Promise(resolve => {
      this._pauseResolve = resolve
    })
  }

  unpause () {
    assert(this._pausePromise, 'Not paused')
    assert(this._pauseResolve, 'Not paused')
    const resolve = this._pauseResolve
    this._pausePromise = undefined
    this._pauseResolve = undefined
    resolve(undefined)
  }
}