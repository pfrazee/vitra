import Hyperbee from 'hyperbee'
// @ts-ignore no types available -prf
import { Node } from 'hyperbee/lib/messages.js'
import * as msgpackr from 'msgpackr'
import { IndexLogEntry } from '../../types.js'

const SEP = `\x00`
const MIN = `\x00`
const MAX = `\xff`

export function pathToBeekey (path: string): string {
  return path.split('/').filter(Boolean).join(SEP)
}

export function beekeyToPath (key: string): string {
  return key.split(SEP).filter(Boolean).join('/')
}

export async function beeShallowList (bee: Hyperbee, path: string[]): Promise<IndexLogEntry[]> {
  const arr: IndexLogEntry[] = []
  const pathlen = path && path.length > 0 ? path.length : 0
  let bot = pathlen > 0 ? `${path.join(SEP)}${SEP}${MIN}` : MIN
  const top = pathlen > 0 ? `${path.join(SEP)}${SEP}${MAX}` : MAX

  let lastItem: IndexLogEntry|undefined = undefined
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
          name: containerPath[containerPath.length - 1],
          path: containerPathStr,
          value: undefined
        })
      }
      bot = `${containerPath.join(SEP)}${SEP}${MAX}`
    } else {
      arr.push({
        container: false,
        seq: item.seq,
        name: itemPath[itemPath.length - 1],
        path: `/${itemPath.join('/')}`,
        value: item.value
      })
      lastItem = arr[arr.length - 1]
      bot = itemPath.join(SEP)
    }
  } while (true)
}
