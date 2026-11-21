import { assertCompleteBundle, findForbiddenMarkers } from './check-bundle'

const DEFAULT_BUNDLE_DIRECTORY = 'out'

function main(): number {
  const directory = process.argv[2] ?? DEFAULT_BUNDLE_DIRECTORY
  try {
    assertCompleteBundle(directory)
    const hits = findForbiddenMarkers(directory)
    hits.forEach(({ file, marker }) => console.error(`${marker} en ${file}`))
    return hits.length === 0 ? 0 : 1
  } catch (caught: unknown) {
    console.error(`no se pudo inspeccionar ${directory}: ${caught instanceof Error ? caught.message : String(caught)}`)
    return 1
  }
}

process.exit(main())
