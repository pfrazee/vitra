import { parse } from '@babel/parser'

export interface ExportedMethod {
  name: string
  args: string|undefined
}

export function listExportedMethods (source: string) {
  const parsed = parse(source, {
    sourceType: 'module',
    attachComment: false
  })
  const methods: ExportedMethod[] = []
  for (const node of parsed.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration?.type !== 'FunctionDeclaration') continue

    let args = undefined
    const arg0 = node.declaration.params[0]
    if (arg0?.type === 'ObjectPattern') {
      args = `{${arg0.properties.map((node: any) => node.key.name).join(', ')}}`
    } else if (arg0?.type === 'Identifier') {
      args = arg0.name
    }
    methods.push({
      name: node.declaration.id.name,
      args
    })
  }
  return methods
}