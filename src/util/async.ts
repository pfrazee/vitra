export async function timeout (n: number, p: Promise<any>): Promise<any> {
  const to = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('Timed out')), n)
  })
  return await Promise.race([p, to])
}