export type SharedRows<T> = Readonly<{
  read: () => readonly T[]
  write: (rows: readonly T[]) => void
}>

export function createSharedRows<T>(initial: readonly T[] = []): SharedRows<T> {
  let current = initial
  return {
    read: () => current,
    write: (rows) => {
      current = rows
    },
  }
}
