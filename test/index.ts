import ava from 'ava'
import { ItoStorageInMemory, ItoIndexLog, ItoIndexLogEntry } from '../src/index.js'

ava('batch modifications', async t => {
  const idx = await ItoIndexLog.create(new ItoStorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', key: '/foo', value: 1},
    {type: 'put', key: 'bar', value: 2},
    {type: 'put', key: '/baz/buz', value: 3},
    {type: 'delete', key: 'nothing'}
  ])
  t.is(idx.length, 4)
  await t.throwsAsync(() => idx.dangerousBatch([{type: 'wrong', key: '/foo', value: 100}]))
  await t.throwsAsync(() => idx.dangerousBatch([{type: 'put', key: '', value: 100}]))
})

ava('list', async t => {
  const testOutput = (res: ItoIndexLogEntry[], desc: string[]) => {
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
  const idx = await ItoIndexLog.create(new ItoStorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', key: '/a', value: '/a'},
    {type: 'put', key: '/a/a', value: '/a/a'},
    {type: 'put', key: '/a/b', value: '/a/b'},
    {type: 'put', key: '/a/c', value: '/a/c'},
    {type: 'put', key: '/a/c/a', value: '/a/c/a'},
    {type: 'put', key: '/a/d/a', value: '/a/d/a'},
    {type: 'put', key: '/a/d/b', value: '/a/d/b'},
    {type: 'put', key: '/a/e', value: '/a/e'},
    {type: 'put', key: '/b', value: '/b'},
    {type: 'put', key: '/c', value: '/c'},
    {type: 'put', key: '/d', value: '/d'},
    {type: 'put', key: '/e/a/a/a', value: '/e/a/a/a'},
    {type: 'put', key: '/e/a/a/b', value: '/e/a/a/b'},
    {type: 'put', key: '/e/a/a/c', value: '/e/a/a/c'},
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
  const testOutput = (res: ItoIndexLogEntry|undefined, key: string, path: string) => {
    t.truthy(res)
    if (res) {
      t.is(res.key, key)
      t.is(res.path, path)
      t.deepEqual(res.value, path)
    }
  }
  const idx = await ItoIndexLog.create(new ItoStorageInMemory())
  await idx.dangerousBatch([
    {type: 'put', key: '/a', value: '/a'},
    {type: 'put', key: '/a/a', value: '/a/a'},
    {type: 'put', key: '/a/b', value: '/a/b'},
    {type: 'put', key: '/a/c', value: '/a/c'},
    {type: 'put', key: '/a/c/a', value: '/a/c/a'}
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