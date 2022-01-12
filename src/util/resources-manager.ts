import EventEmitter from 'events'

interface Resource {
  open (): Promise<void>
  close (): Promise<void>
  equals (other: Resource): boolean
}

export class ResourcesManager<T extends Resource> extends EventEmitter {
  items: T[] = []

  get length () {
    return this.items.length
  }

  *[Symbol.iterator] () {
    for (const item of this.items) {
      yield item
    }
  }

  async* watch (emitExisting = true): AsyncGenerator<[string, T]> {
    if (emitExisting) {
      for (const item of this.items) {
        yield ['added', item]
      }
    }
    while (true) {
      yield await new Promise(r => {
        this.once('changed', (evt, item) => r([evt, item]))
      })
    }
  }

  at (index: number): T|undefined {
    return this.items[index]
  }

  find (item: T|((item: T) => boolean)): T|undefined {
    if (typeof item === 'function') return this.items.find(item)
    return this.items.find(item2 => item2.equals(item))
  }

  findIndex (item: T|((item: T) => boolean)): number {
    if (typeof item === 'function') return this.items.findIndex(item)
    return this.items.findIndex(item2 => item2.equals(item))
  }

  has (item: T|((item: T) => boolean)): boolean {
    if (typeof item === 'function') return !!this.items.find(item)
    return !!this.items.find(item2 => item2.equals(item))
  }

  map (fn: (item: T, index: number)=>any): any[] {
    return this.items.map(fn)
  }

  async add (item: T) {
    if (!this.find(item)) {
      this.items.push(item)
      await item.open()
      this.emit('added', item)
      this.emit('changed', 'added', item)
    }
  }

  async remove (item: T) {
    const index = this.findIndex(item)
    if (index !== -1) {
      await this.removeAt(index)
    }
  }

  async removeAt (index: number) {
    const item = this.items[index]
    this.items.splice(index, 1)
    await item.close()
    this.emit('removed', item)
    this.emit('changed', 'removed', item)
  }

  async removeAll () {
    await Promise.all(this.items.map(item => item.close()))
    this.items.length = 0
  }
}