import Hyperbee from 'hyperbee'
import { ItoIndexLogEntry } from '../types.js'

const SEP = `\x00`
const MIN = `\x00`
const MAX = `\xff`

export function pathToKey (path: string): string {
  return path.split('/').filter(Boolean).join(SEP)
}

export function keyToPath (key: string): string {
  return key.split(SEP).filter(Boolean).join('/')
}

export async function beeShallowList (bee: Hyperbee, path: string[]): Promise<ItoIndexLogEntry[]> {
  const arr: ItoIndexLogEntry[] = []
  const pathlen = path && path.length > 0 ? path.length : 0
  let bot = pathlen > 0 ? `${path.join(SEP)}${SEP}${MIN}` : MIN
  const top = pathlen > 0 ? `${path.join(SEP)}${SEP}${MAX}` : MAX

  let lastItem: ItoIndexLogEntry|undefined = undefined
  do {
    const item = await bee.peek({gt: bot, lt: top})
    if (!item) return arr

    const itemPath = item.key.split(SEP).filter(Boolean)
    if (itemPath.length > pathlen + 1) {
      const containerPath = itemPath.slice(0, pathlen + 1)
      const containerPathStr = `/${containerPath.join('/')}`
      if (lastItem && lastItem.path === containerPathStr) {
        lastItem.container = true
      } else {
        arr.push({
          container: true,
          seq: undefined,
          key: containerPath[containerPath.length - 1],
          path: containerPathStr,
          value: undefined
        })
      }
      bot = `${containerPath.join(SEP)}${SEP}${MAX}`
    } else {
      arr.push({
        container: false,
        seq: item.seq,
        key: itemPath[itemPath.length - 1],
        path: `/${itemPath.join('/')}`,
        value: item.value
      })
      lastItem = arr[arr.length - 1]
      bot = itemPath.join(SEP)
    }
  } while (true)
}