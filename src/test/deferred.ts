export type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
}>

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}
