import {
  assertCompleteBundle,
  findForbiddenMarkers,
  findSeedSentinels,
  resolveExitCode,
  SEED_SENTINELS_BLOCK_BUNDLE,
} from './check-bundle'

const DEFAULT_BUNDLE_DIRECTORY = 'out'

function main(): number {
  const directory = process.argv[2] ?? DEFAULT_BUNDLE_DIRECTORY
  try {
    assertCompleteBundle(directory)
    const forbiddenHits = findForbiddenMarkers(directory)
    const seedHits = findSeedSentinels(directory)
    forbiddenHits.forEach(({ file, marker }) => console.error(`${marker} en ${file}`))
    const report = SEED_SENTINELS_BLOCK_BUNDLE ? console.error : console.log
    seedHits.forEach(({ file, marker }) => report(`aviso: centinela del seed ${marker} en ${file}`))
    return resolveExitCode({ forbiddenHits, seedHits, seedBlocking: SEED_SENTINELS_BLOCK_BUNDLE })
  } catch (caught: unknown) {
    console.error(`no se pudo inspeccionar ${directory}: ${caught instanceof Error ? caught.message : String(caught)}`)
    return 1
  }
}

process.exit(main())
