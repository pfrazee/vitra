/*
await-lock
NOTE copied into here because it struggles with compilation and it's too small to bother with anything else

The MIT License (MIT)

Copyright (c) 2015-present James Ide
*/

/**
 * A mutex lock for coordination across async functions
 */
 class AwaitLock {
  _acquired: boolean
  _waitingResolvers: ((value: unknown) => void)[]

  constructor() {
      this._acquired = false;
      this._waitingResolvers = [];
  }
  /**
   * Whether the lock is currently acquired or not. Accessing this property does not affect the
   * status of the lock.
   */
  get acquired() {
      return this._acquired;
  }
  /**
   * Acquires the lock, waiting if necessary for it to become free if it is already locked. The
   * returned promise is fulfilled once the lock is acquired.
   *
   * After acquiring the lock, you **must** call `release` when you are done with it.
   */
  acquireAsync() {
      if (!this._acquired) {
          this._acquired = true;
          return Promise.resolve();
      }
      return new Promise((resolve) => {
          this._waitingResolvers.push(resolve);
      });
  }
  /**
   * Acquires the lock if it is free and otherwise returns immediately without waiting. Returns
   * `true` if the lock was free and is now acquired, and `false` otherwise,
   */
  tryAcquire() {
      if (!this._acquired) {
          this._acquired = true;
          return true;
      }
      return false;
  }
  /**
   * Releases the lock and gives it to the next waiting acquirer, if there is one. Each acquirer
   * must release the lock exactly once.
   */
  release() {
      if (!this._acquired) {
          throw new Error(`Cannot release an unacquired lock`);
      }
      if (this._waitingResolvers.length > 0) {
          const resolve = this._waitingResolvers.shift();
          if (resolve) {
            resolve(undefined);
          }
      }
      else {
          this._acquired = false;
      }
  }
}

// wraps await-lock in a simpler interface, with many possible locks
interface LocksMap {
  [key: string]: AwaitLock
}
var locks: LocksMap = {}

/**
 * Create a new lock
 * @example
 * var lock = require('./lock')
 * async function foo () {
 *   var release = await lock('bar')
 *   // ...
 *   release()
 * }
 */
export default async function (key: string): Promise<() => void> {
  if (!(key in locks)) locks[key] = new AwaitLock()

  var lock = locks[key]
  await lock.acquireAsync()
  return lock.release.bind(lock)
};