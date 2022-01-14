// @ts-ignore no types available
import HyperDHT from '@hyperswarm/dht'

const bootstrappers: any = []
const bootstrap: any = []
const nodes: any = []

export async function getOrCreateLocalDHT () {
  while (bootstrappers.length < 3) {
    bootstrappers.push(new HyperDHT({ ephemeral: true, bootstrap: [] }))
  }

  for (const node of bootstrappers) {
    await node.ready()
    bootstrap.push({ host: '127.0.0.1', port: node.address().port })
  }

  while (nodes.length < 3) {
    const node = new HyperDHT({ ephemeral: false, bootstrap })
    await node.ready()
    nodes.push(node)
  }

  return {bootstrap}
}