import ava from 'ava'
import { StorageInMemory, IndexLog, IndexLogEntry } from '../src/index.js'

ava('batch modifications', async t => {
  const idx = await IndexLog.create(new StorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', path: '/foo', value: 1},
    {type: 'put', path: 'bar', value: 2},
    {type: 'put', path: '/baz/buz', value: 3},
    {type: 'delete', path: 'nothing'}
  ])
  t.is(idx.length, 4)
  await t.throwsAsync(() => idx.dangerousBatch([{type: 'wrong', path: '/foo', value: 100}]))
  await t.throwsAsync(() => idx.dangerousBatch([{type: 'put', path: '', value: 100}]))
})

ava('list', async t => {
  const testOutput = (res: IndexLogEntry[], desc: string[]) => {
    t.is(res.length, desc.length)
    for (let i = 0; i < res.length; i++) {
      const itemDesc = desc[i]
      if (itemDesc.endsWith('/')) {
        t.truthy(res[i].container)
        t.is(res[i].path, itemDesc.slice(0, -1))
      } else {
        t.falsy(res[i].container)
        t.is(res[i].path, itemDesc)
      }
    }
  }
  const idx = await IndexLog.create(new StorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', path: '/a', value: '/a'},
    {type: 'put', path: '/a/a', value: '/a/a'},
    {type: 'put', path: '/a/b', value: '/a/b'},
    {type: 'put', path: '/a/c', value: '/a/c'},
    {type: 'put', path: '/a/c/a', value: '/a/c/a'},
    {type: 'put', path: '/a/d/a', value: '/a/d/a'},
    {type: 'put', path: '/a/d/b', value: '/a/d/b'},
    {type: 'put', path: '/a/e', value: '/a/e'},
    {type: 'put', path: '/b', value: '/b'},
    {type: 'put', path: '/c', value: '/c'},
    {type: 'put', path: '/d', value: '/d'},
    {type: 'put', path: '/e/a/a/a', value: '/e/a/a/a'},
    {type: 'put', path: '/e/a/a/b', value: '/e/a/a/b'},
    {type: 'put', path: '/e/a/a/c', value: '/e/a/a/c'},
  ])
  testOutput(await idx.list('/'), ['/a/', '/b', '/c', '/d', '/e/'])
  testOutput(await idx.list(''), ['/a/', '/b', '/c', '/d', '/e/'])
  testOutput(await idx.list('/a'), ['/a/a', '/a/b', '/a/c/', '/a/d/', '/a/e'])
  testOutput(await idx.list('/a/'), ['/a/a', '/a/b', '/a/c/', '/a/d/', '/a/e'])
  testOutput(await idx.list('/a/b'), [])
  testOutput(await idx.list('/a/b/'), [])
  testOutput(await idx.list('/a/c'), ['/a/c/a'])
  testOutput(await idx.list('/a/c/'), ['/a/c/a'])
  testOutput(await idx.list('/a/d'), ['/a/d/a', '/a/d/b'])
  testOutput(await idx.list('/e'), ['/e/a/'])
  testOutput(await idx.list('/e/a'), ['/e/a/a/'])
  testOutput(await idx.list('/e/a/a'), ['/e/a/a/a','/e/a/a/b','/e/a/a/c'])
  testOutput(await idx.list('/', {offset: 1}), ['/b', '/c', '/d', '/e/'])
  testOutput(await idx.list('/', {limit: 4}), ['/a/', '/b', '/c', '/d'])
  testOutput(await idx.list('/', {offset: 1, limit: 3}), ['/b', '/c', '/d'])
  testOutput(await idx.list('/', {reverse: true}), ['/e/', '/d', '/c', '/b', '/a/'])
  testOutput(await idx.list('/', {reverse: true, offset: 1}), ['/d', '/c', '/b', '/a/'])
  testOutput(await idx.list('/', {reverse: true, limit: 4}), ['/e/', '/d', '/c', '/b'])
  testOutput(await idx.list('/', {reverse: true, offset: 1, limit: 3}), ['/d', '/c', '/b'])
})

ava('get', async t => {
  const testOutput = (res: IndexLogEntry|undefined, name: string, path: string) => {
    t.truthy(res)
    if (res) {
      t.is(res.name, name)
      t.is(res.path, path)
      t.deepEqual(res.value, path)
    }
  }
  const idx = await IndexLog.create(new StorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', path: '/a', value: '/a'},
    {type: 'put', path: '/a/a', value: '/a/a'},
    {type: 'put', path: '/a/b', value: '/a/b'},
    {type: 'put', path: '/a/c', value: '/a/c'},
    {type: 'put', path: '/a/c/a', value: '/a/c/a'}
  ])
  testOutput(await idx.get('/a'), 'a', '/a')
  testOutput(await idx.get('a'), 'a', '/a')
  testOutput(await idx.get('/a/'), 'a', '/a')
  testOutput(await idx.get('a/'), 'a', '/a')
  testOutput(await idx.get('/a/a'), 'a', '/a/a')
  testOutput(await idx.get('/a/b'), 'b', '/a/b')
  testOutput(await idx.get('/a/c'), 'c', '/a/c')
  testOutput(await idx.get('/a/c/a'), 'a', '/a/c/a')
})